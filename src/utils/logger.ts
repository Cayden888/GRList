/**
 * Tiny structured logger.
 *
 * Every line starts with a Malaysia-time timestamp. Any value registered with
 * `registerSecret` (bot token, Supabase key, ...) is replaced with "***" before
 * the line is printed, so secrets cannot leak into Railway logs by accident.
 */
import { formatMalaysiaDateTime } from './time.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const secrets = new Set<string>();
let minLevel: Level = (process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : 'info';
let silent = false;

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) secrets.add(value);
}

export function setLogLevel(level: Level): void {
  minLevel = level;
}

/** Used by tests to keep output quiet. */
export function setSilent(value: boolean): void {
  silent = value;
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  // Belt and braces: mask anything that looks like a Telegram bot token.
  out = out.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '***');
  return out;
}

function serialize(meta: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) return ` ${meta.name}: ${meta.message}`;
  try {
    return ' ' + JSON.stringify(meta, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v));
  } catch {
    return ' [unserializable meta]';
  }
}

function write(level: Level, msg: string, meta?: unknown): void {
  if (silent || ORDER[level] < ORDER[minLevel]) return;
  const line = redact(`${formatMalaysiaDateTime(new Date())} MYT [${level.toUpperCase()}] ${msg}${serialize(meta)}`);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: unknown) => write('debug', msg, meta),
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
};
