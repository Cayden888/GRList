/**
 * Minimal Telegram Bot API client (official HTTPS API, no extra library).
 *
 * The most important job here is classifying failures honestly:
 *
 *   not_sent_temporary – Telegram definitely did not post (e.g. DNS failure, 429). Safe to retry.
 *   not_sent_permanent – Telegram refused (bad chat id, bot not in group). Retrying won't help.
 *   uncertain          – the request may have been accepted (timeout, connection cut, 5xx).
 *                        We must NOT resend automatically or the group could get a duplicate.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type TelegramFailureKind = 'not_sent_temporary' | 'not_sent_permanent' | 'uncertain';

export class TelegramError extends Error {
  constructor(message: string, public readonly kind: TelegramFailureKind, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'TelegramError';
  }
}

export interface SendResult {
  messageId: number;
}

export interface TelegramSender {
  sendPhoto(pngPath: string, caption?: string): Promise<SendResult>;
}

export const CAPTION_LIMIT = 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Network errors that happen before any byte reaches Telegram. */
const PRE_CONNECT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

function errorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
}

export function truncateCaption(caption: string): string {
  const chars = [...caption];
  return chars.length <= CAPTION_LIMIT ? caption : chars.slice(0, CAPTION_LIMIT - 1).join('') + '…';
}

/** Caption wording. Each part can be changed in the Supabase "dashboard_caption" table. */
export interface CaptionTexts { title: string; testTitle: string; message: string; updated: string; footer: string }
export const DEFAULT_CAPTION: CaptionTexts = {
  title: '📊 Daily Dashboard',
  testTitle: '🧪 Test post – Daily Dashboard',
  message: 'Simulated data for demonstration purposes.',
  updated: 'Updated: {time}',
  footer: '-',
};

/**
 * Fills {placeholders}: {time} plus anything in `values` (e.g. {title}, {current}).
 * A line whose placeholder has no value today (e.g. {limit} when the sheet leaves
 * it blank) is dropped, so the caption never shows "{limit}" or an empty number.
 */
export function buildCaption(opts: { timestampText: string; test?: boolean; texts?: Partial<CaptionTexts>; values?: Record<string, string> }): string {
  const t = { ...DEFAULT_CAPTION, ...opts.texts };
  const values: Record<string, string> = { ...opts.values, time: opts.timestampText };
  const blocks = [opts.test ? t.testTitle : t.title, t.message, t.updated, t.footer]
    .map((b) => b.trim())
    .filter((b) => b !== '' && b !== '-');
  const lines: string[] = [];
  for (const block of blocks) {
    for (const raw of block.split('\n')) {
      let missing = false;
      const filled = raw.replace(/\{([a-z_]+)\}/gi, (whole, key: string) => {
        const v = values[key.toLowerCase()];
        if (v === undefined) { missing = true; return whole; }
        return v;
      });
      if (!missing) lines.push(filled.trimEnd());
    }
  }
  // collapse runs of empty lines left by removed lines
  return truncateCaption(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

type FetchLike = typeof fetch;

export class TelegramClient implements TelegramSender {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly timeoutMs = 30_000,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new TelegramError('TELEGRAM_BOT_TOKEN does not look like a bot token (expected 123456789:ABC…)', 'not_sent_permanent');
  }

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private async call<T>(method: string, init: RequestInit, sending: boolean): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(method), { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const code = errorCode(e);
      const name = (e as Error)?.name;
      if (code && PRE_CONNECT_CODES.has(code)) {
        throw new TelegramError(`Could not connect to Telegram (${code}); nothing was sent`, 'not_sent_temporary');
      }
      const what = name === 'TimeoutError' || name === 'AbortError' ? `no reply within ${Math.round(this.timeoutMs / 1000)}s` : `connection error${code ? ` (${code})` : ''}`;
      throw new TelegramError(`Telegram ${method}: ${what}`, sending ? 'uncertain' : 'not_sent_temporary');
    }

    let body: { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number; migrate_to_chat_id?: number } } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // fall through with an empty body
    }
    if (res.ok && body.ok) return body.result as T;

    const desc = body.description ?? `HTTP ${res.status}`;
    if (res.status === 429) {
      throw new TelegramError(`Telegram rate limit: ${desc}`, 'not_sent_temporary', body.parameters?.retry_after);
    }
    if (res.status >= 500) {
      throw new TelegramError(`Telegram server error: ${desc}`, sending ? 'uncertain' : 'not_sent_temporary');
    }
    let hint = '';
    if (body.parameters?.migrate_to_chat_id) hint = ` – the group was upgraded; set TELEGRAM_CHAT_ID=${body.parameters.migrate_to_chat_id}`;
    else if (/chat not found/i.test(desc)) hint = ' – check TELEGRAM_CHAT_ID and that the bot was added to the group';
    else if (/not enough rights|have no rights|CHAT_SEND_PHOTOS_FORBIDDEN/i.test(desc)) hint = ' – give the bot permission to send photos in the group';
    else if (res.status === 401) hint = ' – TELEGRAM_BOT_TOKEN is wrong or was revoked';
    throw new TelegramError(`Telegram refused the request: ${desc}${hint}`, 'not_sent_permanent');
  }

  async getMe(): Promise<{ id: number; username?: string; first_name: string }> {
    return this.call('getMe', { method: 'GET' }, false);
  }

  async getUpdates(): Promise<Array<Record<string, unknown>>> {
    return this.call('getUpdates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeout: 0, allowed_updates: ['message', 'my_chat_member', 'channel_post'] }) }, false);
  }

  async sendPhoto(pngPath: string, caption?: string): Promise<SendResult> {
    let size: number;
    try {
      size = (await stat(pngPath)).size;
    } catch {
      throw new TelegramError(`Image file not found: ${pngPath}`, 'not_sent_temporary');
    }
    if (size === 0) throw new TelegramError('Image file is empty', 'not_sent_temporary');
    if (size > MAX_PHOTO_BYTES) throw new TelegramError('Image is larger than Telegram allows for photos (10 MB)', 'not_sent_permanent');

    const bytes = await readFile(pngPath);
    const form = new FormData();
    form.append('chat_id', this.chatId);
    form.append('photo', new Blob([bytes], { type: 'image/png' }), path.basename(pngPath));
    if (caption) form.append('caption', truncateCaption(caption));

    const result = await this.call<{ message_id: number }>('sendPhoto', { method: 'POST', body: form }, true);
    if (typeof result?.message_id !== 'number') {
      throw new TelegramError('Telegram replied without a message id', 'uncertain');
    }
    return { messageId: result.message_id };
  }
}
