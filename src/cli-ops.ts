/** Commands that need Supabase or Telegram. See cli.ts for the list. */
import path from 'node:path';
import type { Args } from './cli.js';
import { hasDatabase, requireMode, type AppConfig } from './config/env.js';
import { readSheet } from './data/sheet-reader.js';
import { SupabaseScheduleRepository } from './database/supabase-repository.js';
import type { ResolveAction } from './database/repository.js';
import { generateDashboard } from './dashboard/generate.js';
import { summarizeValues } from './simulation/metrics.js';
import { buildCaption, TelegramClient } from './telegram/client.js';
import { log } from './utils/logger.js';
import { formatMalaysiaDateTime, formatMalaysiaDisplay, isValidDateString, malaysiaDateString } from './utils/time.js';

const str = (args: Args, k: string) => (typeof args.flags[k] === 'string' ? (args.flags[k] as string) : undefined);

function repoFor(config: AppConfig): SupabaseScheduleRepository {
  requireMode(config, 'database');
  return new SupabaseScheduleRepository(config.supabase.url!, config.supabase.serviceRoleKey!);
}

async function status(config: AppConfig, args: Args): Promise<number> {
  const rows = await repoFor(config).listRecent(Number(str(args, 'limit') ?? 10));
  if (rows.length === 0) {
    console.log('No schedule rows yet. They are created when the worker runs with ENABLE_SCHEDULER=true.');
    return 0;
  }
  console.log('Date        Scheduled (MYT)      Status      Attempts  Message  Note');
  for (const r of rows) {
    console.log(
      `${r.malaysia_date}  ${formatMalaysiaDateTime(new Date(r.scheduled_at))}  ${r.status.padEnd(10)}  ${String(r.attempt_count).padEnd(8)}  ${String(r.telegram_message_id ?? '-').padEnd(7)}  ${r.last_error ?? ''}`,
    );
  }
  return 0;
}

async function telegramChatId(config: AppConfig): Promise<number> {
  if (!config.telegram.botToken) {
    console.error('Set TELEGRAM_BOT_TOKEN first (from @BotFather).');
    return 2;
  }
  const tg = new TelegramClient(config.telegram.botToken, config.telegram.chatId ?? '0', config.telegram.timeoutMs);
  const me = await tg.getMe();
  console.log(`Bot: @${me.username ?? me.first_name}`);
  const updates = await tg.getUpdates();
  const chats = new Map<string, string>();
  for (const u of updates) {
    for (const key of ['message', 'my_chat_member', 'channel_post']) {
      const chat = (u[key] as { chat?: { id: number; title?: string; type?: string; username?: string } } | undefined)?.chat;
      if (chat) chats.set(String(chat.id), `${chat.title ?? chat.username ?? '(private chat)'} [${chat.type}]`);
    }
  }
  if (chats.size === 0) {
    console.log('No chats found yet. Add the bot to your group, send a message in the group such as /start@' + (me.username ?? 'yourbot') + ', then run this again.');
    return 0;
  }
  console.log('Chats this bot has seen (use the group\'s number as TELEGRAM_CHAT_ID):');
  for (const [id, label] of chats) console.log(`  ${id}   ${label}`);
  console.log('Nothing was sent.');
  return 0;
}

async function postTest(config: AppConfig, args: Args): Promise<number> {
  if (args.flags.confirm !== true) {
    console.log('This sends ONE test image to your Telegram group. Run again with --confirm to do it:');
    console.log('  npm run post:test -- --confirm        (local)');
    console.log('  node dist/cli.js post-test --confirm  (Railway)');
    return 1;
  }
  requireMode(config, 'telegram');
  requireMode(config, 'sheet');
  const tg = new TelegramClient(config.telegram.botToken!, config.telegram.chatId!, config.telegram.timeoutMs);
  const date = malaysiaDateString(new Date());
  const sheet = await readSheet(config);
  const g = await generateDashboard(config, { malaysiaDate: date, items: sheet.items, itemId: str(args, 'item'), timestamp: new Date(), fileTag: '-test' });
  const caption = config.telegram.captionEnabled ? buildCaption({ timestampText: formatMalaysiaDisplay(new Date()), test: true }) : undefined;
  log.info('Sending test image to Telegram (explicit --confirm given)');
  const { messageId } = await tg.sendPhoto(g.pngPath, caption);
  console.log(`Test image sent. Telegram message id: ${messageId}. File: ${path.relative(process.cwd(), g.pngPath)}`);
  console.log('This test does not count as the daily post and does not change the schedule.');
  if (hasDatabase(config)) {
    try {
      await repoFor(config).recordHistory({
        kind: 'test',
        malaysia_date: date,
        dashboard_item_id: g.item.id,
        random_seed: g.seed,
        generated_values: summarizeValues(g.sim),
        image_meta: { file: path.basename(g.pngPath), bytes: g.bytes },
        posting_status: 'sent',
        telegram_message_id: messageId,
      });
    } catch (e) {
      log.warn('Test post history not saved', { error: (e as Error).message });
    }
  }
  return 0;
}

async function resolve(config: AppConfig, args: Args): Promise<number> {
  const date = str(args, 'date');
  const action = str(args, 'as') as ResolveAction | undefined;
  if (!date || !isValidDateString(date) || !action || !['sent', 'retry', 'failed'].includes(action)) {
    console.log('Usage: resolve --date YYYY-MM-DD --as sent|retry|failed [--message-id N]');
    console.log('  --as sent    the photo DID arrive in the group (it will not be sent again today)');
    console.log('  --as retry   the photo did NOT arrive (the worker sends it at its next check)');
    console.log('  --as failed  give up for that day');
    return 1;
  }
  const mid = str(args, 'message-id');
  const row = await repoFor(config).resolve(date, action, mid ? Number(mid) : null);
  if (!row) {
    console.log(`Nothing changed: ${date} is not in an uncertain/failed/missed/skipped state (check with the status command).`);
    return 1;
  }
  console.log(`${date} is now "${row.status}".`);
  return 0;
}

export const commands: Record<string, (config: AppConfig, args: Args) => Promise<number>> = {
  status,
  'telegram-chat-id': telegramChatId,
  'post-test': postTest,
  resolve,
};
