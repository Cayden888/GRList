/**
 * The long-running scheduler loop.
 *
 * Each "tick":
 *   1. Recover jobs left half-done by a crashed worker.
 *   2. Make sure today's row exists (reuse it if it does – never re-pick the time).
 *   3. If the job is due, claim it atomically and run it.
 *   4. Sleep until the next interesting moment (the due time, midnight MYT,
 *      or the regular check interval – whichever comes first).
 *
 * The database is the source of truth; the in-memory timer is only an alarm
 * clock. A restart simply runs step 1–4 again, so nothing is lost or doubled.
 */
import type { ScheduleRow } from '../database/repository.js';
import { log } from '../utils/logger.js';
import { formatMalaysiaDateTime, malaysiaDateString, startOfNextMalaysiaDay } from '../utils/time.js';
import { runDailyJob, type JobDeps, type JobOutcome } from './job-runner.js';
import { planDailyTime } from './planner.js';

export interface TickResult {
  job: ScheduleRow;
  ran?: JobOutcome;
  /** Milliseconds until the next tick should run. */
  sleepMs: number;
}

export class DailyScheduler {
  private stopped = false;
  private sleepAbort: AbortController | null = null;
  private current: Promise<unknown> | null = null;

  constructor(private readonly deps: JobDeps) {}

  private due(job: ScheduleRow): number {
    return Date.parse(job.next_attempt_at ?? job.scheduled_at);
  }

  async ensureToday(): Promise<ScheduleRow> {
    const { repo, config } = this.deps;
    const now = this.deps.now();
    const today = malaysiaDateString(now);
    const existing = await repo.getByDate(today);
    if (existing) return existing;
    const plan = planDailyTime(today, config.window, now);
    const job = await repo.ensureDaily(today, plan.scheduledAt, plan.status, plan.status === 'missed' ? plan.note : undefined);
    if (job.status === 'missed') log.warn(`[${today}] ${job.last_error ?? 'No post today'}`);
    else log.info(`[${today}] Today's post is scheduled for ${formatMalaysiaDateTime(new Date(job.scheduled_at))} MYT`);
    return job;
  }

  async tick(): Promise<TickResult> {
    const { repo, config, workerId } = this.deps;

    for (const r of await repo.recoverStale()) {
      log.warn(`[${r.malaysia_date}] Recovered an unfinished job → ${r.status}`, { reason: r.last_error });
    }

    let job = await this.ensureToday();
    let ran: JobOutcome | undefined;
    const now = this.deps.now();

    if ((job.status === 'pending' || job.status === 'retry') && now.getTime() >= this.due(job)) {
      const claimed = await repo.claim(job.id, workerId, config.worker.leaseSeconds, config.retry.maxAttempts);
      if (!claimed) {
        log.info(`[${job.malaysia_date}] Job is being handled by another worker (or not claimable); skipping`);
      } else {
        const lateMinutes = (now.getTime() - Date.parse(claimed.scheduled_at)) / 60_000;
        if (claimed.attempt_count === 1 && claimed.status === 'processing' && job.status === 'pending' && lateMinutes > config.retry.missedJobGraceMinutes) {
          await repo.finish(claimed.id, workerId, 'missed', `Worker was offline at the scheduled time and came back ${Math.round(lateMinutes)} minutes late (limit ${config.retry.missedJobGraceMinutes}); no post today`);
          log.warn(`[${job.malaysia_date}] Scheduled time passed ${Math.round(lateMinutes)} min ago (over the ${config.retry.missedJobGraceMinutes} min grace period). Marked missed.`);
          ran = 'failed';
        } else {
          if (lateMinutes > 1 && claimed.attempt_count === 1) log.info(`[${job.malaysia_date}] Catching up on a post that was due ${Math.round(lateMinutes)} min ago`);
          ran = await runDailyJob(this.deps, claimed);
        }
      }
      job = (await repo.getByDate(job.malaysia_date)) ?? job;
    }

    return { job, ran, sleepMs: this.computeSleep(job) };
  }

  computeSleep(job: ScheduleRow): number {
    const now = this.deps.now().getTime();
    const interval = this.deps.config.worker.checkIntervalMinutes * 60_000;
    const midnight = startOfNextMalaysiaDay(this.deps.now()).getTime() + 2_000;
    let target = midnight;
    if (job.status === 'pending' || job.status === 'retry') target = Math.min(target, this.due(job));
    if (job.status === 'processing' && job.lease_until) target = Math.min(target, Date.parse(job.lease_until) + 1_000);
    return Math.max(1_000, Math.min(interval, target - now));
  }

  private sleep(ms: number): Promise<void> {
    this.sleepAbort = new AbortController();
    const signal = this.sleepAbort.signal;
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Runs until stop() is called. Errors are logged and retried after a pause. */
  async run(): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      let sleepMs: number;
      try {
        const p = this.tick();
        this.current = p;
        const res = await p;
        failures = 0;
        sleepMs = res.sleepMs;
        const due = res.job.status === 'pending' || res.job.status === 'retry' ? ` next attempt ${formatMalaysiaDateTime(new Date(res.job.next_attempt_at ?? res.job.scheduled_at))} MYT,` : '';
        log.info(`Heartbeat: today (${res.job.malaysia_date}) status=${res.job.status},${due} next check in ${Math.round(sleepMs / 60_000)} min`);
      } catch (e) {
        failures++;
        sleepMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5));
        log.error(`Scheduler tick failed (${failures} in a row); trying again in ${Math.round(sleepMs / 1000)}s`, { error: (e as Error).message });
      } finally {
        this.current = null;
      }
      if (!this.stopped) await this.sleep(sleepMs);
    }
    log.info('Scheduler stopped');
  }

  /** Stops the loop; waits (up to timeoutMs) for a running job to finish. */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopped = true;
    this.sleepAbort?.abort();
    if (this.current) {
      log.info('Waiting for the current job to finish before shutting down…');
      await Promise.race([this.current.catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs))]);
    }
  }
}
