/**
 * Manual commands. Run with `npm run <script> -- [options]` locally, or
 * `node dist/cli.js <command> [options]` on Railway.
 *
 *   preview            Render a PNG into the output folder. Never posts anything.
 *   check-sheet        Download + validate the sheet and list problems.
 *   status             Show recent daily schedule rows from Supabase.
 *   telegram-chat-id   List chats the bot has seen (to find TELEGRAM_CHAT_ID). Sends nothing.
 *   post-test          Send ONE test image to Telegram. Requires --confirm.
 *   resolve            Settle an "uncertain" job after checking the group by hand.
 */
import path from 'node:path';
import { ConfigError, hasSheetSource, loadConfig, loadDotEnv, requireMode, safeSummary, type AppConfig } from './config/env.js';
import { DEMO_ITEMS } from './data/demo.js';
import { readSheet } from './data/sheet-reader.js';
import type { DashboardItem } from './data/types.js';
import { generateDashboard } from './dashboard/generate.js';
import { summarizeValues } from './simulation/metrics.js';
import { isValidDateString, malaysiaDateString } from './utils/time.js';
import { log } from './utils/logger.js';

type Args = { _: string[]; flags: Record<string, string | true> };

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined];
      if (v !== undefined) args.flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) args.flags[k] = argv[++i]!;
      else args.flags[k] = true;
    } else args._.push(a);
  }
  return args;
}

function flagStr(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

async function loadItems(config: AppConfig, forceDemo: boolean): Promise<{ items: DashboardItem[]; demo: boolean }> {
  if (forceDemo || !hasSheetSource(config)) {
    log.warn('No sheet configured (or --demo given): using built-in DEMO configuration. The image will be marked as demo.');
    return { items: DEMO_ITEMS, demo: true };
  }
  const sheet = await readSheet(config);
  return { items: sheet.items, demo: false };
}

async function cmdPreview(config: AppConfig, args: Args): Promise<void> {
  const date = flagStr(args, 'date') ?? malaysiaDateString(new Date());
  if (!isValidDateString(date)) throw new Error(`--date must be YYYY-MM-DD (got "${date}")`);
  const { items, demo } = await loadItems(config, args.flags.demo === true);
  const targets = args.flags.all === true ? items : [undefined];
  for (const t of targets) {
    const itemId = t?.id ?? flagStr(args, 'item');
    const result = await generateDashboard(config, {
      malaysiaDate: date,
      items,
      itemId,
      timestamp: new Date(),
      demo,
      fileTag: '-preview',
    });
    console.log(`\nPreview saved: ${path.relative(process.cwd(), result.pngPath)}`);
    console.log(`  Item:  ${result.item.id} (sheet row ${result.item.rowNumber || 'demo'})`);
    console.log(`  Seed:  ${result.seed}`);
    console.log(`  Values (simulated): ${JSON.stringify(summarizeValues(result.sim))}`);
  }
  console.log('\nNothing was sent to Telegram and nothing was written to the database.');
}

async function cmdCheckSheet(config: AppConfig): Promise<void> {
  requireMode(config, 'sheet');
  const sheet = await readSheet(config);
  console.log(`\nSource: ${sheet.source}`);
  console.log(`Valid rows: ${sheet.items.length} of ${sheet.totalRows}`);
  for (const i of sheet.items) {
    const cards = [i.baseline && 'baseline', i.volume24h && 'volume', i.output24h && 'output', i.eventCount24h && 'events'].filter(Boolean).join(', ') || 'none';
    console.log(`  row ${i.rowNumber}: id=${i.id}  current=${i.current.min}–${i.current.max}  optional cards: ${cards}`);
  }
  const errors = sheet.issues.filter((i) => i.severity === 'error');
  const warnings = sheet.issues.filter((i) => i.severity === 'warning');
  console.log(`Errors (rows skipped): ${errors.length}   Warnings: ${warnings.length}`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadDotEnv();
  const args = parseArgs(argv);
  const command = args._[0];
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
  log.debug('Config', safeSummary(config));

  switch (command) {
    case 'preview':
      await cmdPreview(config, args);
      return 0;
    case 'check-sheet':
      await cmdCheckSheet(config);
      return 0;
    default: {
      const ext = await import('./cli-ops.js');
      if (ext.commands[command ?? '']) return ext.commands[command!]!(config, args);
      console.log('Commands: preview, check-sheet, status, telegram-chat-id, post-test, resolve');
      return command ? 1 : 0;
    }
  }
}

const isDirectRun = process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      if (e instanceof ConfigError) console.error(e.message);
      else log.error('Command failed', e);
      process.exit(1);
    });
}

export type { Args };
export { flagStr };
