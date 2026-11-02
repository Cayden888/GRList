/**
 * Runs one claimed daily job: sheet → simulation → PNG → Telegram → database.
 *
 * Safety rules:
 *  - The caller must already own the job (atomic claim).
 *  - `markSendStarted` is written BEFORE talking to Telegram. If the worker
 *    dies after that point, recovery marks the day "uncertain" instead of
 *    sending again.
 *  - An uncertain Telegram outcome is never retried automatically.
 */
import path from 'node:path';
import type { AppConfig } from '../config/env.js';
import type { DashboardItem } from '../data/types.js';
import type { ScheduleRepository, ScheduleRow } from '../database/repository.js';
import { generateDashboard, type GeneratedDashboard } from '../dashboard/generate.js';
import { summarizeValues } from '../simulation/metrics.js';
import { buildCaption, TelegramError, type TelegramSender } from '../telegram/client.js';
import { loadCaptionTexts } from '../database/labels.js';
import { captionValues } from '../dashboard/caption-values.js';
import { log } from '../utils/logger.js';
import { formatMalaysiaDisplay, formatMalaysiaDateTime, startOfNextMalaysiaDay } from '../utils/time.js';

export interface JobDeps {
  config: AppConfig;
  repo: ScheduleRepository;
  /** null in DRY_RUN mode. */
  sender: TelegramSender | null;
  loadItems: () => Promise<DashboardItem[]>;
  now: () => Date;
  workerId: string;
  /** Tests skip real PNG rendering by injecting a generator. */
  generate?: typeof generateDashboard;
}

export type JobOutcome = 'sent' | 'retry' | 'failed' | 'uncertain' | 'skipped' | 'lost-claim';

/** When to try again, or null when we should give up. */
export function nextRetryTime(config: AppConfig, job: ScheduleRow, now: Date, retryAfterSeconds?: number): Date | null {
  if (job.attempt_count >= config.retry.maxAttempts) return null;
  const delays = config.retry.delaysMinutes;
  const minutes = delays[Math.min(job.attempt_count - 1, delays.length - 1)] ?? delays[delays.length - 1] ?? 5;
  const waitMs = Math.max(minutes * 60_000, (retryAfterSeconds ?? 0) * 1000 + 1000);
  const at = new Date(now.getTime() + waitMs);
  // Never spill into the next Malaysia day: that day has its own job.
  if (at.getTime() >= startOfNextMalaysiaDay(now).getTime()) return null;
  return at;
}

function imageMeta(g: GeneratedDashboard, config: AppConfig): Record<string, unknown> {
  return { file: path.basename(g.pngPath), bytes: g.bytes, width: config.dashboard.width, height: config.dashboard.height };
}

export async function runDailyJob(deps: JobDeps, job: ScheduleRow): Promise<JobOutcome> {
  const { config, repo, workerId } = deps;
  const tag = `[job ${job.malaysia_date} attempt ${job.attempt_count}/${config.retry.maxAttempts}]`;
  log.info(`${tag} Started`, { scheduledAt: formatMalaysiaDateTime(new Date(job.scheduled_at)), attemptAt: formatMalaysiaDateTime(deps.now()) });

  // ---- Steps that cannot cause a duplicate post: safe to retry on failure ----
  let generated: GeneratedDashboard;
  try {
    const items = await deps.loadItems();
    generated = await (deps.generate ?? generateDashboard)(config, {
      malaysiaDate: job.malaysia_date,
      items,
      itemId: job.dashboard_item_id ?? undefined,
      seed: job.random_seed ?? undefined,
      timestamp: deps.now(),
    });
  } catch (e) {
    return failBeforeSend(deps, job, tag, `Preparing image failed: ${(e as Error).message}`);
  }

  const values = summarizeValues(generated.sim);
  const history = {
    schedule_id: job.id,
    malaysia_date: job.malaysia_date,
    dashboard_item_id: generated.item.id,
    random_seed: generated.seed,
    generated_values: values,
    image_meta: imageMeta(generated, config),
  };
  const safeHistory = async (h: Parameters<ScheduleRepository['recordHistory']>[0]) => {
    try {
      await repo.recordHistory(h);
    } catch (e) {
      log.warn(`${tag} Could not save history (the post itself is unaffected)`, { error: (e as Error).message });
    }
  };

  if (!deps.sender) {
    await repo.finish(job.id, workerId, 'skipped', 'DRY_RUN=true: image rendered, nothing sent to Telegram', null, generated.item.id, generated.seed);
    await safeHistory({ ...history, kind: 'dry_run', posting_status: 'skipped' });
    log.info(`${tag} DRY_RUN – image rendered but not sent. Job marked skipped.`, { item: generated.item.id });
    return 'skipped';
  }

  // ---- Point of no return: record that sending is starting ----
  const stillOurs = await repo.markSendStarted(job.id, workerId, generated.item.id, generated.seed);
  if (!stillOurs) {
    log.warn(`${tag} Lost ownership of the job before sending (lease expired?). Not sending.`);
    return 'lost-claim';
  }

  const caption = config.telegram.captionEnabled ? buildCaption({ timestampText: formatMalaysiaDisplay(deps.now()), texts: await loadCaptionTexts(config), values: captionValues(generated.item, generated.sim, job.malaysia_date) }) : undefined;
  try {
    const { messageId } = await deps.sender.sendPhoto(generated.pngPath, caption);
    const saved = await repo.complete(job.id, workerId, messageId);
    if (!saved) log.error(`${tag} Photo was sent (message ${messageId}) but the database row could not be updated. Do NOT resend; run: resolve --date ${job.malaysia_date} --as sent --message-id ${messageId}`);
    await safeHistory({ ...history, kind: 'scheduled', posting_status: 'sent', telegram_message_id: messageId });
    log.info(`${tag} Sent to Telegram`, { messageId, item: generated.item.id });
    return 'sent';
  } catch (e) {
    const err = e instanceof TelegramError ? e : new TelegramError((e as Error).message, 'uncertain');
    if (err.kind === 'uncertain') {
      const msg = `Uncertain Telegram result: ${err.message}. The photo may or may not have been posted. Check the group, then run: resolve --date ${job.malaysia_date} --as sent|retry`;
      await repo.finish(job.id, workerId, 'uncertain', msg, null, generated.item.id, generated.seed);
      await safeHistory({ ...history, kind: 'scheduled', posting_status: 'uncertain', error: err.message });
      log.error(`${tag} ${msg}`);
      return 'uncertain';
    }
    if (err.kind === 'not_sent_permanent') {
      await repo.finish(job.id, workerId, 'failed', err.message, null, generated.item.id, generated.seed);
      await safeHistory({ ...history, kind: 'scheduled', posting_status: 'failed', error: err.message });
      log.error(`${tag} Telegram refused; not retrying: ${err.message}`);
      return 'failed';
    }
    await safeHistory({ ...history, kind: 'scheduled', posting_status: 'failed', error: err.message });
    return failBeforeSend(deps, job, tag, err.message, err.retryAfterSeconds, generated);
  }
}

async function failBeforeSend(deps: JobDeps, job: ScheduleRow, tag: string, message: string, retryAfterSeconds?: number, generated?: GeneratedDashboard): Promise<JobOutcome> {
  const at = nextRetryTime(deps.config, job, deps.now(), retryAfterSeconds);
  const item = generated?.item.id ?? null;
  const seed = generated?.seed ?? null;
  if (at) {
    await deps.repo.finish(job.id, deps.workerId, 'retry', message, at, item, seed);
    log.warn(`${tag} Failed, will retry at ${formatMalaysiaDateTime(at)} MYT: ${message}`);
    return 'retry';
  }
  await deps.repo.finish(job.id, deps.workerId, 'failed', `Gave up after ${job.attempt_count} attempt(s): ${message}`, null, item, seed);
  log.error(`${tag} Failed permanently for today: ${message}`);
  return 'failed';
}
