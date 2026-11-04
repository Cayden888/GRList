import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCaption, CAPTION_LIMIT, TelegramClient, TelegramError, truncateCaption } from '../src/telegram/client.js';
import { redact, registerSecret } from '../src/utils/logger.js';

const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop';
const PNG = 'output/test/telegram-fake.png';

async function png() {
  await mkdir('output/test', { recursive: true });
  await writeFile(PNG, Buffer.alloc(2048, 1));
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function failureKind(client: TelegramClient): Promise<string> {
  try {
    await client.sendPhoto(PNG, 'hi');
    return 'no-error';
  } catch (e) {
    return (e as TelegramError).kind;
  }
}

describe('Telegram client (fully mocked – no real requests)', () => {
  it('sends a photo with sendPhoto and returns the message id', async () => {
    await png();
    let seen: { url: string; body?: FormData } | undefined;
    const client = new TelegramClient(TOKEN, '-1001234567890', 5000, fakeFetch((url, init) => {
      seen = { url, body: init?.body as FormData };
      return json(200, { ok: true, result: { message_id: 77 } });
    }));
    expect(await client.sendPhoto(PNG, 'caption')).toEqual({ messageId: 77 });
    expect(seen!.url.endsWith('/sendPhoto')).toBe(true);
    expect(seen!.body!.get('chat_id')).toBe('-1001234567890');
    expect(seen!.body!.get('caption')).toBe('caption');
    expect(seen!.body!.get('photo')).toBeInstanceOf(Blob);
  });

  it('treats timeouts and dropped connections as uncertain (no automatic resend)', async () => {
    await png();
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(await failureKind(new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => Promise.reject(timeout))))).toBe('uncertain');
    const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(await failureKind(new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => Promise.reject(reset))))).toBe('uncertain');
    expect(await failureKind(new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => json(502, { ok: false, description: 'Bad Gateway' }))))).toBe('uncertain');
  });

  it('treats DNS/connection-refused and rate limits as safe to retry', async () => {
    await png();
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    expect(await failureKind(new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => Promise.reject(dns))))).toBe('not_sent_temporary');
    const client = new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => json(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 12 } })));
    await expect(client.sendPhoto(PNG)).rejects.toMatchObject({ kind: 'not_sent_temporary', retryAfterSeconds: 12 });
  });

  it('treats refusals (bad chat, no permission) as permanent with a helpful hint', async () => {
    await png();
    const client = new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => json(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })));
    await expect(client.sendPhoto(PNG)).rejects.toMatchObject({ kind: 'not_sent_permanent' });
    await expect(client.sendPhoto(PNG)).rejects.toThrow(/TELEGRAM_CHAT_ID/);
  });

  it('checks that the PNG exists before sending', async () => {
    let called = false;
    const client = new TelegramClient(TOKEN, '-1', 5000, fakeFetch(() => {
      called = true;
      return json(200, { ok: true, result: { message_id: 1 } });
    }));
    await expect(client.sendPhoto('output/test/does-not-exist.png')).rejects.toThrow(/not found/);
    expect(called).toBe(false);
  });

  it('rejects a malformed token without making a request', () => {
    expect(() => new TelegramClient('not-a-token', '-1')).toThrow(TelegramError);
  });

  it('builds a short caption within Telegram limits', () => {
    const c = buildCaption({ timestampText: '9 Oct 2026, 2:47 PM MYT' });
    expect(c).toBe('📊 Daily Dashboard\nSimulated data for demonstration purposes.\nUpdated: 9 Oct 2026, 2:47 PM MYT');
    expect(buildCaption({ timestampText: 'x', test: true })).toMatch(/^🧪 Test post/);
    expect([...truncateCaption('a'.repeat(5000))].length).toBe(CAPTION_LIMIT);
  });

  it('never prints the bot token in logs', () => {
    registerSecret(TOKEN);
    expect(redact(`calling https://api.telegram.org/bot${TOKEN}/sendPhoto`)).not.toContain(TOKEN);
    expect(redact('other 987654321:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ token')).not.toContain('ZZZZ');
  });
});

import { applyCaptionRows } from '../src/database/labels.js';
describe('caption from Supabase', () => {
  it('uses edited lines, {time}, blank = default and "-" = hidden', () => {
    const texts = applyCaptionRows([
      { line: '1_title', text: '🔥 Today' },
      { line: '3_message', text: '-' },
      { line: '4_updated', text: 'As of {time}' },
      { line: '2_test_title', text: '' },
    ]);
    expect(buildCaption({ timestampText: 'T', texts })).toBe('🔥 Today\nAs of T');
    expect(buildCaption({ timestampText: 'T', test: true, texts })).toBe('🧪 Test post – Daily Dashboard\nAs of T');
  });
});

describe('caption placeholders', () => {
  it('fills values, drops lines with missing values, supports multi-line cells', () => {
    const c = buildCaption({
      timestampText: 'T',
      texts: { title: '🎮 {title}', message: 'Current: {current}\nLimit: {limit}\nBaseline: {baseline}', footer: 'Join us!' },
      values: { title: 'Ways of the Qilin', current: '97.99', baseline: '95.43' },
    });
    expect(c).toBe('🎮 Ways of the Qilin\nCurrent: 97.99\nBaseline: 95.43\nUpdated: T\nJoin us!');
  });
});
