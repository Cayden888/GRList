/**
 * Configuration loading and validation.
 *
 * All settings come from environment variables (or a local .env file during
 * development). Three levels of configuration exist:
 *
 *   preview   – nothing is mandatory. Without a sheet it uses demo data.
 *   database  – also needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   telegram  – also needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
 *
 * The scheduler (worker) needs a sheet + database, plus Telegram unless DRY_RUN=true.
 */
import dotenv from 'dotenv';
import { hostname } from 'node:os';
import { parseHHMM } from '../utils/time.js';
import { registerSecret } from '../utils/logger.js';

export type SelectionStrategy = 'random' | 'sequential' | 'fixed';
export type CurrentValueSource = 'generate' | 'sheet';

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  sheet: {
    id?: string;
    tab?: string;
    gid?: string;
    csvUrl?: string;
    localCsvPath?: string;
    fetchTimeoutMs: number;
  };
  selection: { strategy: SelectionStrategy; fixedItemId?: string };
  currentValueSource: CurrentValueSource;
  supabase: { url?: string; serviceRoleKey?: string };
  telegram: { botToken?: string; chatId?: string; timeoutMs: number; captionEnabled: boolean };
  enableScheduler: boolean;
  dryRun: boolean;
  dashboard: { outputDir: string; width: number; height: number; simulatedLabel: string; theme: 'gamer' | 'clean' };
  window: { startMinutes: number; endMinutes: number; startText: string; endText: string };
  retry: { maxAttempts: number; delaysMinutes: number[]; missedJobGraceMinutes: number };
  worker: { checkIntervalMinutes: number; instanceId: string; leaseSeconds: number };
  simulation: { timeSinceUpdateMinMinutes: number; timeSinceUpdateMaxMinutes: number };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuration problems:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Loads a local .env file if present. Real environment variables win (Railway). */
export function loadDotEnv(): void {
  dotenv.config({ quiet: true });
}

function str(env: Env, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function bool(env: Env, key: string, def: boolean, problems: string[]): boolean {
  const v = str(env, key);
  if (v === undefined) return def;
  if (/^(true|1|yes|on)$/i.test(v)) return true;
  if (/^(false|0|no|off)$/i.test(v)) return false;
  problems.push(`${key} must be true or false (got "${v}")`);
  return def;
}

function num(env: Env, key: string, def: number, problems: string[], opts: { min?: number; max?: number; int?: boolean } = {}): number {
  const v = str(env, key);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n)) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    problems.push(`${key} must be a${opts.int ? 'n integer' : ' number'}${opts.min !== undefined ? ` >= ${opts.min}` : ''}${opts.max !== undefined ? ` <= ${opts.max}` : ''} (got "${v}")`);
    return def;
  }
  return n;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];

  const strategyRaw = (str(env, 'SELECTION_STRATEGY') ?? 'random').toLowerCase();
  if (!['random', 'sequential', 'fixed'].includes(strategyRaw)) problems.push(`SELECTION_STRATEGY must be random, sequential or fixed (got "${strategyRaw}")`);
  const fixedItemId = str(env, 'SELECTION_ITEM_ID');
  if (strategyRaw === 'fixed' && !fixedItemId) problems.push('SELECTION_STRATEGY=fixed needs SELECTION_ITEM_ID');

  const cvRaw = (str(env, 'CURRENT_VALUE_SOURCE') ?? 'generate').toLowerCase();
  if (!['generate', 'sheet'].includes(cvRaw)) problems.push(`CURRENT_VALUE_SOURCE must be generate or sheet (got "${cvRaw}")`);

  const startText = str(env, 'POST_WINDOW_START') ?? '10:30';
  const endText = str(env, 'POST_WINDOW_END') ?? '17:00';
  let startMinutes = 630;
  let endMinutes = 1020;
  try { startMinutes = parseHHMM(startText); } catch (e) { problems.push(`POST_WINDOW_START: ${(e as Error).message}`); }
  try { endMinutes = parseHHMM(endText); } catch (e) { problems.push(`POST_WINDOW_END: ${(e as Error).message}`); }
  if (startMinutes >= endMinutes) problems.push('POST_WINDOW_START must be earlier than POST_WINDOW_END');

  const delaysText = str(env, 'RETRY_DELAYS_MINUTES') ?? '2,10,30';
  const delaysMinutes = delaysText.split(',').map((s) => Number(s.trim()));
  if (delaysMinutes.some((d) => !Number.isFinite(d) || d <= 0)) problems.push(`RETRY_DELAYS_MINUTES must be positive numbers separated by commas (got "${delaysText}")`);

  const simulatedLabel = str(env, 'SIMULATED_DATA_LABEL') ?? 'SIMULATED DATA';
  // The disclosure is mandatory: it can be translated or restyled, but it must stay clear.
  if (!/simulated|模拟|模擬|simulasi/i.test(simulatedLabel)) {
    problems.push('SIMULATED_DATA_LABEL must clearly say the data is simulated (it must contain "SIMULATED")');
  }

  const themeRaw = (str(env, 'DASHBOARD_THEME') ?? 'gamer').toLowerCase();
  if (!['gamer', 'clean'].includes(themeRaw)) problems.push(`DASHBOARD_THEME must be gamer or clean (got "${themeRaw}")`);

  const tsMin = num(env, 'SIM_TIME_SINCE_UPDATE_MIN_MINUTES', 3, problems, { min: 0, int: true });
  const tsMax = num(env, 'SIM_TIME_SINCE_UPDATE_MAX_MINUTES', 45, problems, { min: 0, int: true });
  if (tsMin > tsMax) problems.push('SIM_TIME_SINCE_UPDATE_MIN_MINUTES must not exceed SIM_TIME_SINCE_UPDATE_MAX_MINUTES');

  // Accept common paste mistakes: trailing slash or the /rest/v1 API path.
  const supabaseUrl = str(env, 'SUPABASE_URL')?.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  if (supabaseUrl && !/^https:\/\/.+/.test(supabaseUrl)) problems.push('SUPABASE_URL must start with https://');
  else if (supabaseUrl && /supabase\.com\/dashboard/.test(supabaseUrl)) {
    problems.push('SUPABASE_URL is the dashboard page address. Use the Project URL from Project Settings → Data API, like https://abcd1234.supabase.co');
  }
  const chatId = str(env, 'TELEGRAM_CHAT_ID');
  if (chatId && !/^(-?\d+|@[A-Za-z0-9_]{5,})$/.test(chatId)) problems.push('TELEGRAM_CHAT_ID should be a number like -1001234567890 (or @channelusername)');
  const csvUrl = str(env, 'GOOGLE_SHEET_CSV_URL');
  if (csvUrl && !/^https?:\/\//.test(csvUrl)) problems.push('GOOGLE_SHEET_CSV_URL must be a full http(s) URL');

  const config: AppConfig = {
    nodeEnv: str(env, 'NODE_ENV') ?? 'development',
    logLevel: str(env, 'LOG_LEVEL') ?? 'info',
    sheet: {
      id: str(env, 'GOOGLE_SHEET_ID'),
      tab: str(env, 'GOOGLE_SHEET_TAB'),
      gid: str(env, 'GOOGLE_SHEET_GID'),
      csvUrl,
      localCsvPath: str(env, 'LOCAL_SHEET_CSV_PATH'),
      fetchTimeoutMs: num(env, 'SHEET_FETCH_TIMEOUT_MS', 15000, problems, { min: 1000, int: true }),
    },
    selection: { strategy: strategyRaw as SelectionStrategy, fixedItemId },
    currentValueSource: cvRaw as CurrentValueSource,
    supabase: { url: supabaseUrl, serviceRoleKey: str(env, 'SUPABASE_SERVICE_ROLE_KEY') },
    telegram: {
      botToken: str(env, 'TELEGRAM_BOT_TOKEN'),
      chatId,
      timeoutMs: num(env, 'TELEGRAM_TIMEOUT_MS', 30000, problems, { min: 5000, int: true }),
      captionEnabled: bool(env, 'TELEGRAM_CAPTION_ENABLED', true, problems),
    },
    enableScheduler: bool(env, 'ENABLE_SCHEDULER', false, problems),
    dryRun: bool(env, 'DRY_RUN', true, problems),
    dashboard: {
      outputDir: str(env, 'DASHBOARD_OUTPUT_DIR') ?? 'output',
      width: num(env, 'DASHBOARD_WIDTH', 1600, problems, { min: 800, max: 4000, int: true }),
      height: num(env, 'DASHBOARD_HEIGHT', 900, problems, { min: 450, max: 2250, int: true }),
      simulatedLabel,
      theme: themeRaw as 'gamer' | 'clean',
    },
    window: { startMinutes, endMinutes, startText, endText },
    retry: {
      maxAttempts: num(env, 'MAX_ATTEMPTS', 4, problems, { min: 1, max: 10, int: true }),
      delaysMinutes,
      missedJobGraceMinutes: num(env, 'MISSED_JOB_GRACE_MINUTES', 90, problems, { min: 0, int: true }),
    },
    worker: {
      checkIntervalMinutes: num(env, 'WORKER_CHECK_INTERVAL_MINUTES', 15, problems, { min: 1, max: 120 }),
      instanceId: str(env, 'INSTANCE_ID') ?? str(env, 'RAILWAY_REPLICA_ID') ?? `${hostname()}-${process.pid}`,
      leaseSeconds: num(env, 'JOB_LEASE_SECONDS', 300, problems, { min: 60, int: true }),
    },
    simulation: { timeSinceUpdateMinMinutes: tsMin, timeSinceUpdateMaxMinutes: tsMax },
  };

  registerSecret(config.telegram.botToken);
  registerSecret(config.supabase.serviceRoleKey);

  if (problems.length) throw new ConfigError(problems);
  return config;
}

export function hasSheetSource(c: AppConfig): boolean {
  return Boolean(c.sheet.csvUrl || c.sheet.id || c.sheet.localCsvPath);
}
export function hasDatabase(c: AppConfig): boolean {
  return Boolean(c.supabase.url && c.supabase.serviceRoleKey);
}
export function hasTelegram(c: AppConfig): boolean {
  return Boolean(c.telegram.botToken && c.telegram.chatId);
}

/** Checks that the settings needed for one mode are present. */
export function requireMode(c: AppConfig, mode: 'database' | 'telegram' | 'scheduler' | 'sheet'): void {
  const missing: string[] = [];
  const needSheet = () => { if (!hasSheetSource(c)) missing.push('GOOGLE_SHEET_CSV_URL or GOOGLE_SHEET_ID (or LOCAL_SHEET_CSV_PATH)'); };
  const needDb = () => {
    if (!c.supabase.url) missing.push('SUPABASE_URL');
    if (!c.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  };
  const needTg = () => {
    if (!c.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN');
    if (!c.telegram.chatId) missing.push('TELEGRAM_CHAT_ID');
  };
  if (mode === 'sheet') needSheet();
  if (mode === 'database') needDb();
  if (mode === 'telegram') needTg();
  if (mode === 'scheduler') {
    needSheet();
    needDb();
    if (!c.dryRun) needTg();
  }
  if (missing.length) throw new ConfigError(missing.map((m) => `${m} is required for ${mode} mode`));
}

/** Startup summary that never contains secret values. */
export function safeSummary(c: AppConfig): Record<string, unknown> {
  const sheetSource = c.sheet.csvUrl ? 'csv-url' : c.sheet.id ? `sheet-id (${c.sheet.gid !== undefined ? `gid ${c.sheet.gid}` : `tab "${c.sheet.tab ?? 'first'}"`})` : c.sheet.localCsvPath ? 'local-file' : 'none (demo data)';
  return {
    nodeEnv: c.nodeEnv,
    instance: c.worker.instanceId,
    sheetSource,
    selection: c.selection.strategy,
    currentValueSource: c.currentValueSource,
    database: hasDatabase(c) ? 'configured' : 'not configured',
    telegram: hasTelegram(c) ? 'configured' : 'not configured',
    enableScheduler: c.enableScheduler,
    dryRun: c.dryRun,
    postingWindow: `${c.window.startText}-${c.window.endText} Asia/Kuala_Lumpur`,
    maxAttempts: c.retry.maxAttempts,
    retryDelaysMinutes: c.retry.delaysMinutes,
    image: `${c.dashboard.width}x${c.dashboard.height} ${c.dashboard.theme}`,
  };
}
