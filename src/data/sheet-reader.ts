/**
 * Downloads the public Google Sheet as CSV (no Google login needed) or reads a
 * local CSV file, then validates it with the parser.
 */
import { readFile } from 'node:fs/promises';
import type { AppConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { parseSheetCsv } from './sheet-parser.js';
import type { SheetParseResult } from './types.js';

export class SheetFetchError extends Error {
  constructor(message: string, public readonly temporary: boolean) {
    super(message);
    this.name = 'SheetFetchError';
  }
}

const SHEET_URL_RE = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;

/** Works out which CSV address to download from the configuration. */
export function resolveCsvUrl(sheet: AppConfig['sheet']): string | undefined {
  if (sheet.csvUrl) {
    // Accept a normal "…/edit#gid=0" link pasted by mistake and convert it.
    const m = SHEET_URL_RE.exec(sheet.csvUrl);
    if (m && !/\/(export|gviz)\b/.test(sheet.csvUrl) && !/output=csv/.test(sheet.csvUrl)) {
      const gid = /[?#&]gid=(\d+)/.exec(sheet.csvUrl)?.[1];
      return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
    }
    return sheet.csvUrl;
  }
  if (sheet.id) {
    const id = SHEET_URL_RE.exec(sheet.id)?.[1] ?? sheet.id;
    if (sheet.gid !== undefined) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(sheet.gid)}`;
    if (sheet.tab) return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet.tab)}`;
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  }
  return undefined;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'text/csv' } });
  } catch (e) {
    throw new SheetFetchError(`Could not reach the Google Sheet: ${(e as Error).message}`, true);
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new SheetFetchError(`Google returned HTTP ${res.status}. Check the sheet ID/tab and that sharing is "Anyone with the link can view".`, false);
  }
  if (!res.ok) throw new SheetFetchError(`Google returned HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder('utf-8').decode(buf);
}

export async function loadSheetText(config: AppConfig): Promise<{ text: string; source: string }> {
  const url = resolveCsvUrl(config.sheet);
  if (url) {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return { text: await fetchOnce(url, config.sheet.fetchTimeoutMs), source: 'google-sheet' };
      } catch (e) {
        lastErr = e;
        if (!(e instanceof SheetFetchError) || !e.temporary || attempt === 3) break;
        log.warn(`Sheet download failed (attempt ${attempt}/3), retrying`, { error: (e as Error).message });
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    throw lastErr;
  }
  if (config.sheet.localCsvPath) {
    const text = await readFile(config.sheet.localCsvPath, 'utf8');
    return { text, source: `local file ${config.sheet.localCsvPath}` };
  }
  throw new SheetFetchError('No sheet is configured (set GOOGLE_SHEET_CSV_URL or GOOGLE_SHEET_ID).', false);
}

/** Downloads, parses, validates and logs problems. Throws if no valid row exists. */
export async function readSheet(config: AppConfig): Promise<SheetParseResult & { source: string }> {
  const { text, source } = await loadSheetText(config);
  const result = parseSheetCsv(text);
  for (const issue of result.issues) {
    const line = `Sheet row ${issue.rowNumber}: ${issue.message}`;
    if (issue.severity === 'error') log.warn(`${line} (row skipped)`);
    else log.info(line);
  }
  log.info(`Sheet loaded from ${source}: ${result.items.length} valid of ${result.totalRows} rows`);
  if (result.items.length === 0) throw new SheetFetchError('The sheet has no valid dashboard rows. See the row errors above.', false);
  return { ...result, source };
}
