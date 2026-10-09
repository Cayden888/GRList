/**
 * Worker entry point (what Railway runs: `npm start` → node dist/index.js).
 *
 * With ENABLE_SCHEDULER=false (the default) it only prints its configuration
 * and a periodic "idle" line – it never posts. Turn the scheduler on only
 * after the preview and test post look right.
 */
import { ConfigError, hasSheetSource, loadConfig, loadDotEnv, requireMode, safeSummary, type AppConfig } from './config/env.js';
import { readSheet } from './data/sheet-reader.js';
import { SupabaseScheduleRepository } from './database/supabase-repository.js';
import { DailyScheduler } from './scheduler/worker.js';
import { TelegramClient, TelegramError } from './telegram/client.js';
import { log } from './utils/logger.js';

const IDLE_HEARTBEAT_MS = 6 * 60 * 60 * 1000;

async function startScheduler(config: AppConfig): Promise<DailyScheduler> {
  requireMode(config, 'scheduler');
  const repo = new SupabaseScheduleRepository(config.supabase.url!, config.supabase.serviceRoleKey!);
  const sender = config.dryRun ? null : new TelegramClient(config.telegram.botToken!, config.telegram.chatId!, config.telegram.timeoutMs);

  if (sender) {
    try {
      const me = await sender.getMe();
      log.info(`Telegram bot OK: @${me.username ?? me.first_name}`);
    } catch (e) {
      // A wrong token is fatal; a temporary network problem is not.
      if (e instanceof TelegramError && e.kind === 'not_sent_permanent') throw e;
      log.warn('Could not check the Telegram bot right now (will try again when posting)', { error: (e as Error).message });
    }
  } else {
    log.warn('DRY_RUN=true: the scheduler will render the image at the scheduled time but will NOT send it (the day is marked "skipped").');
  }
  // Check the sheet now so problems show in the logs early (not fatal: it is re-read at posting time).
  try {
    await readSheet(config);
  } catch (e) {
    log.warn('Sheet check at startup failed – fix it before the scheduled time', { error: (e as Error).message });
  }

  const scheduler = new DailyScheduler({
    config,
    repo,
    sender,
    loadItems: async () => (await readSheet(config)).items,
    now: () => new Date(),
    workerId: config.worker.instanceId,
  });
  void scheduler.run();
  return scheduler;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  log.info('Starting telegram-dashboard worker', safeSummary(config));

  let scheduler: DailyScheduler | null = null;
  let idleTimer: NodeJS.Timeout | null = null;

  if (config.enableScheduler) {
    scheduler = await startScheduler(config);
  } else {
    const msg = 'Scheduler is DISABLED (ENABLE_SCHEDULER=false). Nothing will be posted. Use the preview / post-test commands, then set ENABLE_SCHEDULER=true.';
    log.info(msg);
    if (!hasSheetSource(config)) log.info('No Google Sheet configured yet (GOOGLE_SHEET_CSV_URL or GOOGLE_SHEET_ID).');
    idleTimer = setInterval(() => log.info(`Idle heartbeat. ${msg}`), IDLE_HEARTBEAT_MS);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down gracefully`);
    if (idleTimer) clearInterval(idleTimer);
    if (scheduler) await scheduler.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled error – exiting so Railway restarts the worker', reason instanceof Error ? reason : { reason: String(reason) });
  process.exit(1);
});

main().catch((e) => {
  if (e instanceof ConfigError) log.error(e.message);
  else log.error('Worker failed to start', e);
  // Exit with an error so Railway's restart policy brings it back (after you fix the config).
  process.exit(1);
});
