/**
 * Turns the raw CSV text of the Google Sheet into validated dashboard items.
 *
 * - Columns are found by header name (case-insensitive), never by position.
 * - Quoted cells with commas, blank cells, extra whitespace, a UTF-8 BOM and
 *   Chinese text are all handled by csv-parse.
 * - Completely empty rows are skipped.
 * - Nothing is invented: a missing or broken optional range simply hides that
 *   card, and every problem is reported in `issues` so it can be logged.
 */
import { parse } from 'csv-parse/sync';
import type { DashboardItem, NumericRange, RowIssue, SheetParseResult } from './types.js';

export const COLUMNS = {
  imageName: 'Image_Name',
  imageLink: 'Image_Link',
  playUrl: 'Play_Url',
  titleEn: 'Title_EN',
  titleCn: 'Title_CN',
  dataSource: 'Data_Source',
  region: 'Region',
  lastUpdated: 'Last_Updated',
  nextUpdate: 'Next_Update',
  currentMin: 'Current_Value_Min',
  currentMax: 'Current_Value_Max',
  current: 'Current_Value',
  baselineMin: 'Baseline_Value_Min',
  baselineMax: 'Baseline_Value_Max',
  volumeMin: 'Volume_24H_Min',
  volumeMax: 'Volume_24H_Max',
  outputMin: 'Output_24H_Min',
  outputMax: 'Output_24H_Max',
  eventMin: 'Event_Count_24H_Min',
  eventMax: 'Event_Count_24H_Max',
  limitMin: 'Low_Limit_24H_Min',
  limitMax: 'High_Limit_24H_Max',
  timeSince: 'Time_Since_Last_Update',
  timer: 'Random_Timer_Seconds',
} as const;

/** Other header names accepted for the picture column (matched case-insensitively). */
export const IMAGE_LINK_ALIASES = [COLUMNS.imageLink, 'Link', 'Image_URL', 'Image_Url', 'Image', 'Picture', 'Picture_Link', 'Game_Image', 'Game_Image_URL', 'Thumbnail', 'Thumbnail_URL'] as const;
export const PLAY_URL_ALIASES = [COLUMNS.playUrl, 'Game_Url', 'Game_URL', 'Game_Link', 'Play_Link', 'Play_URL', 'URL'] as const;

const REQUIRED_HEADERS = [COLUMNS.currentMin, COLUMNS.currentMax];

/** Words that mean "no real value here" for the text fields. */
const PLACEHOLDER_WORDS = new Set(['static', '-', '--', 'n/a', 'na', 'none', 'null', 'tbd', 'undefined', 'nan']);

export class SheetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetFormatError';
  }
}

const normHeader = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase();

/** Parses "1,234.5", " 96.7 ", "97%" → number. Returns undefined for blank, NaN for junk. */
export function parseNumberCell(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === '') return undefined;
  const cleaned = t.replace(/[,\s]/g, '').replace(/%$/, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return Number.NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

function textCell(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.replace(/\s+/g, ' ').trim();
  return t === '' ? undefined : t;
}

function meaningfulText(raw: string | undefined): string | undefined {
  const t = textCell(raw);
  if (t === undefined) return undefined;
  return PLACEHOLDER_WORDS.has(t.toLowerCase()) ? undefined : t;
}

function slug(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Turns a Google Drive share link into a direct image download link.
 * Accepts …/file/d/ID/view, …/open?id=ID and …/uc?id=ID. Other links are returned unchanged.
 * The Drive file must be shared as "Anyone with the link can view".
 */
export function toDirectImageUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url;
  }
  if (!/(^|\.)drive\.google\.com$|^docs\.google\.com$/.test(u.hostname)) return url;
  const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return url;
  return `https://drive.usercontent.google.com/download?id=${id}&export=view`;
}

/** Picture link: Image_Link if given, otherwise Image_Name when it is a link. */
function imageUrlFor(link: string | undefined, name: string | undefined): string | undefined {
  for (const v of [link, name]) if (v && isHttpUrl(v)) return toDirectImageUrl(v);
  return undefined;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function parseSheetCsv(csvText: string): SheetParseResult {
  if (/^\s*<(!doctype|html)/i.test(csvText)) {
    throw new SheetFormatError('Received a web page instead of CSV. Is the sheet shared as "Anyone with the link can view"?');
  }
  let records: string[][];
  try {
    records = parse(csvText, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      trim: true, // also allows spaces around quoted cells
    }) as string[][];
  } catch (e) {
    throw new SheetFormatError(`The sheet is not valid CSV: ${(e as Error).message}`);
  }

  if (records.length === 0) throw new SheetFormatError('The sheet is empty (no header row found).');

  const header = records[0]!.map(normHeader);
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (h && !index.has(h)) index.set(h, i);
  });

  const missing: string[] = REQUIRED_HEADERS.filter((h) => !index.has(h.toLowerCase()));
  if (!index.has(COLUMNS.titleEn.toLowerCase()) && !index.has(COLUMNS.titleCn.toLowerCase())) missing.push(`${COLUMNS.titleEn} or ${COLUMNS.titleCn}`);
  if (missing.length) {
    throw new SheetFormatError(`The sheet is missing required column(s): ${missing.join(', ')}. Found: ${records[0]!.map((h) => h.trim()).filter(Boolean).join(', ')}`);
  }

  const issues: RowIssue[] = [];
  const items: DashboardItem[] = [];
  const usedIds = new Map<string, number>();
  let totalRows = 0;

  for (let r = 1; r < records.length; r++) {
    const row = records[r]!;
    const rowNumber = r + 1;
    if (row.every((c) => c.trim() === '')) continue; // completely empty row
    totalRows++;

    const cell = (col: string): string | undefined => {
      const i = index.get(col.toLowerCase());
      return i === undefined ? undefined : row[i];
    };
    /** First non-blank cell among the accepted picture-column names. */
    const imageLinkCell = (): string | undefined => {
      for (const name of IMAGE_LINK_ALIASES) {
        const v = textCell(cell(name));
        if (v) return v;
      }
      return undefined;
    };
    /** First non-blank cell among the accepted play-link column names. */
    const playUrlCell = (): string | undefined => {
      for (const name of PLAY_URL_ALIASES) {
        const v = textCell(cell(name));
        if (v) return v;
      }
      return undefined;
    };
    const rowIssues: RowIssue[] = [];
    const warn = (message: string) => rowIssues.push({ rowNumber, severity: 'warning', message });
    const fail = (message: string) => rowIssues.push({ rowNumber, severity: 'error', message });

    /** Reads a min/max pair. Required pairs fail the row; optional pairs only hide the card. */
    const readRange = (label: string, minCol: string, maxCol: string, opts: { required: boolean; integer?: boolean }): NumericRange | undefined => {
      const min = parseNumberCell(cell(minCol));
      const max = parseNumberCell(cell(maxCol));
      const report = opts.required ? fail : warn;
      const hidden = opts.required ? '' : ' – this card will be hidden';
      if (min === undefined && max === undefined) {
        if (opts.required) fail(`${label}: ${minCol} and ${maxCol} are blank`);
        return undefined;
      }
      if (min === undefined || max === undefined) {
        report(`${label}: ${min === undefined ? minCol : maxCol} is blank${hidden}`);
        return undefined;
      }
      if (Number.isNaN(min) || Number.isNaN(max)) {
        report(`${label}: ${Number.isNaN(min) ? minCol : maxCol} is not a number${hidden}`);
        return undefined;
      }
      if (min > max) {
        report(`${label}: minimum ${min} is greater than maximum ${max}${hidden}`);
        return undefined;
      }
      if (opts.integer && Math.ceil(min) > Math.floor(max)) {
        report(`${label}: no whole number lies between ${min} and ${max}${hidden}`);
        return undefined;
      }
      if (opts.integer && (min < 0 || max < 0)) {
        report(`${label}: counts cannot be negative${hidden}`);
        return undefined;
      }
      return { min, max };
    };

    const titleEn = textCell(cell(COLUMNS.titleEn));
    const titleCn = textCell(cell(COLUMNS.titleCn));
    if (!titleEn && !titleCn) fail('Title_EN and Title_CN are both blank');

    const current = readRange('Current Value', COLUMNS.currentMin, COLUMNS.currentMax, { required: true });
    const baseline = readRange('Baseline Value', COLUMNS.baselineMin, COLUMNS.baselineMax, { required: false });
    const volume24h = readRange('Volume (24H)', COLUMNS.volumeMin, COLUMNS.volumeMax, { required: false });
    const output24h = readRange('Output (24H)', COLUMNS.outputMin, COLUMNS.outputMax, { required: false });
    const eventCount24h = readRange('Event Count (24H)', COLUMNS.eventMin, COLUMNS.eventMax, { required: false, integer: true });
    const limit24h = readRange('Limit (24H)', COLUMNS.limitMin, COLUMNS.limitMax, { required: false });

    let currentSheetValue: number | undefined;
    const cv = parseNumberCell(cell(COLUMNS.current));
    if (cv !== undefined) {
      if (Number.isNaN(cv)) warn('Current_Value is not a number – ignored');
      else if (current && (cv < current.min || cv > current.max)) warn(`Current_Value ${cv} is outside ${current.min}–${current.max} – ignored`);
      else currentSheetValue = cv;
    }

    let timeSinceUpdateMinutes: number | undefined;
    let timeSinceUpdateText: string | undefined;
    const tsRaw = meaningfulText(cell(COLUMNS.timeSince));
    if (tsRaw !== undefined) {
      const n = parseNumberCell(tsRaw);
      if (n !== undefined && !Number.isNaN(n)) {
        if (n >= 0) timeSinceUpdateMinutes = n;
        else warn('Time_Since_Last_Update is negative – a simulated value will be used');
      } else if (tsRaw.length <= 24) {
        timeSinceUpdateText = tsRaw;
      } else {
        warn('Time_Since_Last_Update text is too long – a simulated value will be used');
      }
    }

    let randomTimerSeconds: number | undefined;
    const timer = parseNumberCell(cell(COLUMNS.timer));
    if (timer !== undefined) {
      if (Number.isNaN(timer) || timer <= 0 || timer > 86400) warn('Random_Timer_Seconds must be between 1 and 86400 – timer hidden');
      else randomTimerSeconds = Math.round(timer);
    }

    if (rowIssues.some((i) => i.severity === 'error') || !current) {
      issues.push(...rowIssues);
      continue;
    }
    issues.push(...rowIssues);

    const imageName = textCell(cell(COLUMNS.imageName));
    const baseId = slug(`${imageName ?? `row${rowNumber}`}-${titleEn ?? titleCn ?? ''}`) || `row-${rowNumber}`;
    const seen = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, seen + 1);
    const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;
    if (seen > 0) issues.push({ rowNumber, severity: 'warning', message: `Duplicate item "${baseId}" – using id "${id}"` });

    const rawImageLink = imageLinkCell();
    if (rawImageLink) {
      if (!isHttpUrl(rawImageLink)) issues.push({ rowNumber, severity: 'warning', message: 'Picture link is not a web link (must start with https://) – no picture' });
      else if (/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//.test(rawImageLink)) issues.push({ rowNumber, severity: 'warning', message: 'Picture link points to a Drive folder, not a file – open the image and use its own share link' });
    }

    const rawPlayUrl = playUrlCell();
    // Allow the common www.example.com form while rejecting unsafe or malformed links.
    const normalizedPlayUrl = rawPlayUrl && /^(?:www\.)[a-z0-9.-]+(?:[/?#:]|$)/i.test(rawPlayUrl)
      ? `https://${rawPlayUrl}` : rawPlayUrl;
    const playUrl = normalizedPlayUrl && isHttpUrl(normalizedPlayUrl) ? normalizedPlayUrl : undefined;
    if (rawPlayUrl && !playUrl) issues.push({ rowNumber, severity: 'warning', message: 'Play link must be an HTTP(S) URL – caption link hidden' });

    items.push({
      id,
      rowNumber,
      imageName,
      imageUrl: imageUrlFor(imageLinkCell(), imageName),
      playUrl,
      titleEn,
      titleCn,
      dataSource: meaningfulText(cell(COLUMNS.dataSource)),
      region: meaningfulText(cell(COLUMNS.region)),
      lastUpdated: meaningfulText(cell(COLUMNS.lastUpdated)),
      nextUpdate: meaningfulText(cell(COLUMNS.nextUpdate)),
      current,
      currentSheetValue,
      baseline,
      volume24h,
      output24h,
      eventCount24h,
      limit24h,
      timeSinceUpdateMinutes,
      timeSinceUpdateText,
      randomTimerSeconds,
    });
  }

  return { items, issues, totalRows };
}
