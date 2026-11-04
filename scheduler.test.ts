import { describe, expect, it, vi } from 'vitest';
import type { GeneratedDashboard } from '../src/dashboard/generate.js';
import { MemoryScheduleRepository } from '../src/database/memory-repository.js';
import { nextRetryTime, type JobDeps } from '../src/scheduler/job-runner.js';
import { planDailyTime } from '../src/scheduler/planner.js';
import { DailyScheduler } from '../src/scheduler/worker.js';
import { simulateDashboard } from '../src/simulation/metrics.js';
import { TelegramError, type TelegramSender } from '../src/telegram/client.js';
import { addDays, malaysiaDateString, malaysiaMinutesOfDay, malaysiaWallTimeToDate, startOfNextMalaysiaDay } from '../src/utils/time.js';
import { sampleItem, testConfig } from './helpers.js';

const WINDOW = { startMinutes: 630, endMinutes: 1020 }; // 10:30–17:00

/** Malaysia wall-clock helper: myt('2026-10-09', '14:00'). */
function myt(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return malaysiaWallTimeToDate(date, h! * 60 + m!);
}

describe('Malaysia date handling', () => {
  it('uses the Malaysia calendar day, not UTC', () => {
    expect(malaysiaDateString(new Date('2026-10-09T15:59:59Z'))).toBe('2026-10-09'); // 23:59:59 MYT
    expect(malaysiaDateString(new Date('2026-10-09T16:00:00Z'))).toBe('2026-10-10'); // 00:00 MYT next day
    expect(malaysiaDateString(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });

  it('converts wall-clock times and finds the next midnight', () => {
    expect(myt('2026-10-09', '10:30').toISOString()).toBe('2026-10-09T02:30:00.000Z');
    expect(startOfNextMalaysiaDay(new Date('2026-10-09T05:00:00Z')).toISOString()).toBe('2026-10-09T16:00:00.000Z');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('daily random time', () => {
  it('always falls between 10:30 AM and 5:00 PM Malaysia time', () => {
    const times = new Set<number>();
    for (let d = 0; d < 500; d++) {
      const date = addDays('2026-01-01', d);
      const plan = planDailyTime(date, WINDOW, myt(date, '00:05'));
      expect(plan.status).toBe('pending');
      expect(malaysiaDateString(plan.scheduledAt)).toBe(date);
      const mins = malaysiaMinutesOfDay(plan.scheduledAt);
      expect(mins).toBeGreaterThanOrEqual(630);
      expect(mins).toBeLessThanOrEqual(1020);
      times.add(Math.floor(mins));
    }
    expect(times.size).toBeGreaterThan(200); // genuinely varies day to day
  });

  it('is the same pick for the same day (two workers agree)', () => {
    const now = myt('2026-10-09', '08:00');
    expect(planDailyTime('2026-10-09', WINDOW, now).scheduledAt).toEqual(planDailyTime('2026-10-09', WINDOW, now).scheduledAt);
  });

  it('never schedules "right now" when started mid-window, and stays in the window', () => {
    const now = myt('2026-10-09', '16:00');
    const plan = planDailyTime('2026-10-09', WINDOW, now);
    expect(plan.status).toBe('pending');
    expect(plan.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 5 * 60_000);
    expect(plan.scheduledAt.getTime()).toBeLessThanOrEqual(myt('2026-10-09', '17:00').getTime());
  });

  it('marks the day missed when started after the window', () => {
    expect(planDailyTime('2026-10-09', WINDOW, myt('2026-10-09', '16:58')).status).toBe('missed');
    expect(planDailyTime('2026-10-09', WINDOW, myt('2026-10-09', '20:00')).status).toBe('missed');
  });
});

// ---------------------------------------------------------------------------
// Worker tests with a fake clock, in-memory database and fake Telegram.
// ---------------------------------------------------------------------------

class Clock {
  constructor(public t: Date) {}
  now = () => new Date(this.t);
  set(d: Date) {
    this.t = d;
  }
}

function fakeGenerate(): JobDeps['generate'] {
  return vi.fn(async (_config, opts) => {
    const item = opts.items.find((i) => i.id === opts.itemId) ?? opts.items[0]!;
    const seed = opts.seed ?? `seed|${opts.malaysiaDate}|${item.id}`;
    const sim = simulateDashboard(item, seed, { currentValueSource: 'generate', timeSinceUpdateMinMinutes: 1, timeSinceUpdateMaxMinutes: 9 });
    return { item, sim, seed, svg: '<svg/>', pngPath: '/tmp/fake.png', bytes: 1234 } satisfies GeneratedDashboard;
  });
}

function fakeSender(behaviour: Array<'ok' | TelegramError> = ['ok']): TelegramSender & { calls: number } {
  let n = 0;
  const s = {
    calls: 0,
    async sendPhoto() {
      s.calls++;
      const b = behaviour[Math.min(n++, behaviour.length - 1)]!;
      if (b === 'ok') return { messageId: 1000 + s.calls };
      throw b;
    },
  };
  return s;
}

function setup(opts: { start: Date; sender?: TelegramSender | null; env?: Record<string, string>; repo?: MemoryScheduleRepository; clock?: Clock; workerId?: string }) {
  const clock = opts.clock ?? new Clock(opts.start);
  const repo = opts.repo ?? new MemoryScheduleRepository(clock.now);
  const config = testConfig({ RETRY_DELAYS_MINUTES: '2,10,30', MAX_ATTEMPTS: '4', ...(opts.env ?? {}) });
  const deps: JobDeps = {
    config,
    repo,
    sender: opts.sender === undefined ? fakeSender() : opts.sender,
    loadItems: async () => [sampleItem()],
    now: clock.now,
    workerId: opts.workerId ?? 'worker-1',
    generate: fakeGenerate(),
  };
  return { clock, repo, config, deps, scheduler: new DailyScheduler(deps) };
}

const DAY = '2026-10-09';

describe('daily scheduler', () => {
  it('creates one schedule for today and reuses it after a restart (time never changes)', async () => {
    const a = setup({ start: myt(DAY, '09:00') });
    const r1 = await a.scheduler.tick();
    expect(r1.job.status).toBe('pending');
    const firstTime = r1.job.scheduled_at;

    // "Restart": a brand-new scheduler on the same database, later in the morning.
    a.clock.set(myt(DAY, '10:00'));
    const b = new DailyScheduler(a.deps);
    const r2 = await b.tick();
    expect(r2.job.id).toBe(r1.job.id);
    expect(r2.job.scheduled_at).toBe(firstTime);
    expect(a.repo.rows.size).toBe(1);
  });

  it('does not post at startup before the scheduled time and sleeps until it', async () => {
    const s = setup({ start: myt(DAY, '09:00') });
    const sender = s.deps.sender as ReturnType<typeof fakeSender>;
    const r = await s.scheduler.tick();
    expect(r.ran).toBeUndefined();
    expect(sender.calls).toBe(0);
    expect(r.sleepMs).toBeLessThanOrEqual(15 * 60_000); // regular check interval
    expect(r.sleepMs).toBeGreaterThan(0);
  });

  it('posts exactly once when the time arrives, then never again that day', async () => {
    const s = setup({ start: myt(DAY, '09:00') });
    const sender = s.deps.sender as ReturnType<typeof fakeSender>;
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    const r = await s.scheduler.tick();
    expect(r.ran).toBe('sent');
    expect(r.job.status).toBe('sent');
    expect(r.job.telegram_message_id).toBe(1001);
    expect(r.job.dashboard_item_id).toBe('item-a');
    expect(r.job.random_seed).toBeTruthy();

    for (const t of ['17:30', '23:59']) {
      s.clock.set(myt(DAY, t));
      expect((await s.scheduler.tick()).ran).toBeUndefined();
    }
    expect(sender.calls).toBe(1);
    expect(s.repo.history.filter((h) => h.posting_status === 'sent')).toHaveLength(1);

    // Next day gets its own new schedule.
    s.clock.set(myt(addDays(DAY, 1), '00:01'));
    const next = await s.scheduler.tick();
    expect(next.job.malaysia_date).toBe(addDays(DAY, 1));
    expect(next.job.status).toBe('pending');
  });

  it('prevents duplicate claims when two workers run at the same moment', async () => {
    const clock = new Clock(myt(DAY, '09:00'));
    const repo = new MemoryScheduleRepository(clock.now);
    const sender = fakeSender();
    const w1 = setup({ start: clock.t, clock, repo, sender, workerId: 'w1' });
    const w2 = setup({ start: clock.t, clock, repo, sender, workerId: 'w2' });
    const { job } = await w1.scheduler.tick();
    clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    const results = await Promise.all([w1.scheduler.tick(), w2.scheduler.tick(), w1.scheduler.tick(), w2.scheduler.tick()]);
    expect(results.filter((r) => r.ran === 'sent')).toHaveLength(1);
    expect(sender.calls).toBe(1);
    expect(repo.rows.size).toBe(1);
  });

  it('a losing worker cannot complete or finish a job it does not own', async () => {
    const clock = new Clock(myt(DAY, '12:00'));
    const repo = new MemoryScheduleRepository(clock.now);
    const job = await repo.ensureDaily(DAY, myt(DAY, '11:00'));
    expect(await repo.claim(job.id, 'w1', 300, 4)).not.toBeNull();
    expect(await repo.claim(job.id, 'w2', 300, 4)).toBeNull();
    expect(await repo.complete(job.id, 'w2', 5)).toBe(false);
    expect(await repo.markSendStarted(job.id, 'w2', 'x', 'y')).toBe(false);
  });

  it('retries temporary failures with increasing delays, then succeeds', async () => {
    const temp = new TelegramError('could not connect', 'not_sent_temporary');
    const sender = fakeSender([temp, temp, 'ok']);
    const s = setup({ start: myt(DAY, '09:00'), sender });
    const { job } = await s.scheduler.tick();
    const t0 = Date.parse(job.scheduled_at) + 1000;
    s.clock.set(new Date(t0));

    let r = await s.scheduler.tick();
    expect(r.ran).toBe('retry');
    expect(r.job.status).toBe('retry');
    expect(Date.parse(r.job.next_attempt_at!) - t0).toBe(2 * 60_000);

    // Not yet due → nothing happens.
    s.clock.set(new Date(t0 + 60_000));
    expect((await s.scheduler.tick()).ran).toBeUndefined();

    s.clock.set(new Date(t0 + 2 * 60_000));
    r = await s.scheduler.tick();
    expect(r.ran).toBe('retry');
    const second = Date.parse(r.job.next_attempt_at!) - (t0 + 2 * 60_000);
    expect(second).toBe(10 * 60_000);

    s.clock.set(new Date(Date.parse(r.job.next_attempt_at!)));
    r = await s.scheduler.tick();
    expect(r.ran).toBe('sent');
    expect(r.job.attempt_count).toBe(3);
    expect(sender.calls).toBe(3);
  });

  it('retries a job whose image preparation failed (e.g. sheet unreachable) using the same item and seed', async () => {
    const s = setup({ start: myt(DAY, '09:00') });
    let failSheet = true;
    s.deps.loadItems = async () => {
      if (failSheet) throw new Error('sheet down');
      return [sampleItem()];
    };
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    expect((await s.scheduler.tick()).ran).toBe('retry');
    failSheet = false;
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 3 * 60_000));
    const r = await s.scheduler.tick();
    expect(r.ran).toBe('sent');
  });

  it('gives up after the maximum number of attempts', async () => {
    const temp = new TelegramError('down', 'not_sent_temporary');
    const sender = fakeSender([temp]);
    const s = setup({ start: myt(DAY, '09:00'), sender, env: { MAX_ATTEMPTS: '2', RETRY_DELAYS_MINUTES: '1' } });
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    expect((await s.scheduler.tick()).ran).toBe('retry');
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 2 * 60_000));
    const r = await s.scheduler.tick();
    expect(r.ran).toBe('failed');
    expect(r.job.status).toBe('failed');
    s.clock.set(myt(DAY, '23:00'));
    await s.scheduler.tick();
    expect(sender.calls).toBe(2);
  });

  it('never automatically resends after an uncertain Telegram result (e.g. timeout)', async () => {
    const sender = fakeSender([new TelegramError('no reply within 30s', 'uncertain'), 'ok']);
    const s = setup({ start: myt(DAY, '09:00'), sender });
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    const r = await s.scheduler.tick();
    expect(r.ran).toBe('uncertain');
    expect(r.job.status).toBe('uncertain');
    expect(r.job.last_error).toMatch(/resolve/);
    s.clock.set(myt(DAY, '22:00'));
    await s.scheduler.tick();
    expect(sender.calls).toBe(1);

    // A human checks the group and says it did not arrive → retry once more.
    await s.repo.resolve(DAY, 'retry');
    s.clock.set(myt(DAY, '22:01'));
    const again = await s.scheduler.tick();
    expect(again.ran).toBe('sent');
    expect(sender.calls).toBe(2);
  });

  it('does not retry when Telegram permanently refuses (bad chat id)', async () => {
    const sender = fakeSender([new TelegramError('chat not found', 'not_sent_permanent')]);
    const s = setup({ start: myt(DAY, '09:00'), sender });
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    expect((await s.scheduler.tick()).job.status).toBe('failed');
  });

  it('recovers a job left behind by a crashed worker', async () => {
    const clock = new Clock(myt(DAY, '12:00'));
    const repo = new MemoryScheduleRepository(clock.now);
    // Crash BEFORE sending → retried and sent.
    const job = await repo.ensureDaily(DAY, myt(DAY, '11:00'));
    await repo.claim(job.id, 'dead-worker', 300, 4);
    clock.set(myt(DAY, '12:06'));
    const s = setup({ start: clock.t, clock, repo });
    const r = await s.scheduler.tick();
    expect(r.ran).toBe('sent');
    expect(r.job.status).toBe('sent');
  });

  it('marks a crash DURING sending as uncertain instead of sending again', async () => {
    const clock = new Clock(myt(DAY, '12:00'));
    const repo = new MemoryScheduleRepository(clock.now);
    const job = await repo.ensureDaily(DAY, myt(DAY, '11:00'));
    await repo.claim(job.id, 'dead-worker', 300, 4);
    await repo.markSendStarted(job.id, 'dead-worker', 'item-a', 'seed');
    clock.set(myt(DAY, '12:06'));
    const sender = fakeSender();
    const s = setup({ start: clock.t, clock, repo, sender });
    const r = await s.scheduler.tick();
    expect(r.job.status).toBe('uncertain');
    expect(sender.calls).toBe(0);
  });

  it('marks the day missed when the worker comes back long after the scheduled time', async () => {
    const clock = new Clock(myt(DAY, '09:00'));
    const repo = new MemoryScheduleRepository(clock.now);
    await repo.ensureDaily(DAY, myt(DAY, '11:00'));
    clock.set(myt(DAY, '15:00')); // 4 hours late, grace is 90 min
    const sender = fakeSender();
    const s = setup({ start: clock.t, clock, repo, sender });
    const r = await s.scheduler.tick();
    expect(r.job.status).toBe('missed');
    expect(sender.calls).toBe(0);
  });

  it('catches up when the worker was down only briefly', async () => {
    const clock = new Clock(myt(DAY, '09:00'));
    const repo = new MemoryScheduleRepository(clock.now);
    await repo.ensureDaily(DAY, myt(DAY, '11:00'));
    clock.set(myt(DAY, '11:20'));
    const s = setup({ start: clock.t, clock, repo });
    expect((await s.scheduler.tick()).ran).toBe('sent');
  });

  it('in DRY_RUN renders but sends nothing and marks the day skipped', async () => {
    const s = setup({ start: myt(DAY, '09:00'), sender: null });
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) + 1000));
    const r = await s.scheduler.tick();
    expect(r.ran).toBe('skipped');
    expect(r.job.status).toBe('skipped');
    expect(s.repo.history[0]!.kind).toBe('dry_run');
  });

  it('never schedules a retry after Malaysia midnight', () => {
    const config = testConfig({ RETRY_DELAYS_MINUTES: '30' });
    const job = { attempt_count: 1 } as Parameters<typeof nextRetryTime>[1];
    expect(nextRetryTime(config, job, myt(DAY, '23:50'))).toBeNull();
    expect(nextRetryTime(config, job, myt(DAY, '12:00'))!.toISOString()).toBe(myt(DAY, '12:30').toISOString());
    // Telegram's retry_after is respected when longer than our delay.
    expect(nextRetryTime(config, job, myt(DAY, '12:00'), 3600)!.getTime()).toBe(myt(DAY, '13:00').getTime() + 1000);
  });

  it('sleeps until the due time when it is sooner than the check interval', async () => {
    const s = setup({ start: myt(DAY, '09:00') });
    const { job } = await s.scheduler.tick();
    s.clock.set(new Date(Date.parse(job.scheduled_at) - 30_000));
    expect(s.scheduler.computeSleep(job)).toBe(30_000);
  });
});
