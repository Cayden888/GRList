import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNumberCell, parseSheetCsv, SheetFormatError, toDirectImageUrl } from '../src/data/sheet-parser.js';
import { resolveCsvUrl } from '../src/data/sheet-reader.js';

const HEADER =
  'Image_Name,Title_EN,Title_CN,Data_Source,Region,Last_Updated,Next_Update,Current_Value_Min,Current_Value_Max,Current_Value,Baseline_Value_Min,Baseline_Value_Max,Volume_24H_Min,Volume_24H_Max,Output_24H_Min,Output_24H_Max,Event_Count_24H_Min,Event_Count_24H_Max,Time_Since_Last_Update,Random_Timer_Seconds';

describe('Google Sheet CSV parsing', () => {
  it('keeps the selected game linked to its own Play_Url', () => {
    const csv = 'Image_Name,Title_EN,Data_Source,Current_Value_Min,Current_Value_Max,Play_Url\n'
      + 'MajongW2,Majong Ways 2,Lucky365,95,99.5,www.google.com\n'
      + 'WildWalker,Wild Walker,Pragmatic Play,95,99.5,https://example.com/walker\n';
    const rows = parseSheetCsv(csv).items;
    expect(rows[0]!.playUrl).toBe('https://www.google.com');
    expect(rows[0]!.titleEn).toBe('Majong Ways 2');
    expect(rows[1]!.playUrl).toBe('https://example.com/walker');
    expect(rows[1]!.titleEn).toBe('Wild Walker');
  });

  it('parses the real sheet sample (short rows, missing optional columns)', () => {
    const csv = readFileSync('tests/fixtures/sheet-sample.csv', 'utf8');
    const r = parseSheetCsv(csv);
    expect(r.totalRows).toBe(21);
    expect(r.items).toHaveLength(21);
    const first = r.items[0]!;
    expect(first.titleEn).toBe('A');
    expect(first.titleCn).toBeUndefined();
    expect(first.dataSource).toBe('LU');
    expect(first.region).toBe('Malaysia');
    expect(first.lastUpdated).toBeUndefined(); // "Static" is a placeholder, not a value
    expect(first.current).toEqual({ min: 95, max: 99.5 });
    expect(first.currentSheetValue).toBe(96.7);
    expect(first.baseline).toEqual({ min: 92, max: 97 });
    expect(first.volume24h).toBeUndefined();
    expect(first.eventCount24h).toBeUndefined();
    // Image_Name "3" appears twice – ids must still be unique.
    expect(new Set(r.items.map((i) => i.id)).size).toBe(21);
    expect(first.imageUrl).toBeUndefined();
  });

  it('reads the picture from a column simply called "Link" (Drive file link)', () => {
    const csv =
      'Image_Name,Title_EN,Current_Value_Min,Current_Value_Max,Link\n' +
      '1,A,95,99.5,https://drive.google.com/file/d/1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO/view?usp=drive_link\n' +
      '2,B,95,99.5,\n';
    const r = parseSheetCsv(csv);
    expect(r.items[0]!.imageUrl).toBe('https://drive.usercontent.google.com/download?id=1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO&export=view');
    expect(r.items[0]!.imageName).toBe('1');
    expect(r.items[1]!.imageUrl).toBeUndefined();
    expect(r.issues).toHaveLength(0);
  });

  it('warns when the picture link is a Drive folder or not a web link', () => {
    const csv =
      'Title_EN,Current_Value_Min,Current_Value_Max,Image_Link\n' +
      'A,1,2,https://drive.google.com/drive/u/0/folders/1Xaro4-wS-LTeZ97xhGg5QWv6JSSINM5r\n' +
      'B,1,2,my-picture.png\n';
    const r = parseSheetCsv(csv);
    expect(r.items).toHaveLength(2);
    expect(r.issues.map((i) => i.message).join(' ')).toMatch(/folder/);
    expect(r.issues.map((i) => i.message).join(' ')).toMatch(/not a web link/);
    expect(r.items[1]!.imageUrl).toBeUndefined();
  });

  it('reads columns by header name, in any order, ignoring case and extra columns', () => {
    const csv = 'extra,current_value_max,TITLE_EN,Current_Value_Min\nx,10,Hello,1\n';
    const r = parseSheetCsv(csv);
    expect(r.items[0]!.titleEn).toBe('Hello');
    expect(r.items[0]!.current).toEqual({ min: 1, max: 10 });
  });

  it('handles quoted commas, whitespace, a UTF-8 BOM and Chinese text', () => {
    const csv = `﻿${HEADER}\n"https://example.com/a.png", "  Big, Item  ",大型项目 ,"Source, Inc.",吉隆坡,,,"1,000","2,500.5",,,,,,,,,,,\n`;
    const r = parseSheetCsv(csv);
    const it0 = r.items[0]!;
    expect(it0.titleEn).toBe('Big, Item');
    expect(it0.titleCn).toBe('大型项目');
    expect(it0.dataSource).toBe('Source, Inc.');
    expect(it0.region).toBe('吉隆坡');
    expect(it0.current).toEqual({ min: 1000, max: 2500.5 });
    expect(it0.imageUrl).toBe('https://example.com/a.png');
  });

  it('ignores completely empty rows', () => {
    const csv = `${HEADER}\n,,,,,,,,,,,,,,,,,,,\n\n1,A,,,,,,1,2\n , , \n`;
    const r = parseSheetCsv(csv);
    expect(r.totalRows).toBe(1);
    expect(r.items).toHaveLength(1);
  });

  it('rejects a row whose required range has minimum above maximum', () => {
    const r = parseSheetCsv(`${HEADER}\n1,A,,,,,,99,95\n2,B,,,,,,95,99\n`);
    expect(r.items.map((i) => i.titleEn)).toEqual(['B']);
    expect(r.issues.some((i) => i.severity === 'error' && i.rowNumber === 2 && /greater than/.test(i.message))).toBe(true);
  });

  it('never invents missing required values', () => {
    const r = parseSheetCsv(`${HEADER}\n1,A,,,,,,95,\n2,,,,,,,1,2\n3,C,,,,,,abc,5\n`);
    expect(r.items).toHaveLength(0);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(3);
  });

  it('hides an optional card (with a warning) when its range is incomplete or invalid', () => {
    const r = parseSheetCsv(`${HEADER}\n1,A,,,,,,95,99,,97,92,10,,,,1.2,1.8\n`);
    const item = r.items[0]!;
    expect(item.baseline).toBeUndefined();
    expect(item.volume24h).toBeUndefined();
    expect(item.eventCount24h).toBeUndefined(); // no whole number between 1.2 and 1.8
    expect(r.issues.filter((i) => i.severity === 'warning').length).toBeGreaterThanOrEqual(3);
  });

  it('ignores a Current_Value outside its range', () => {
    const r = parseSheetCsv(`${HEADER}\n1,A,,,,,,95,99,120\n`);
    expect(r.items[0]!.currentSheetValue).toBeUndefined();
    expect(r.issues.some((i) => /outside/.test(i.message))).toBe(true);
  });

  it('parses Time_Since_Last_Update as minutes or short text', () => {
    const r = parseSheetCsv(`${HEADER}\n1,A,,,,,,1,2,,,,,,,,,,15,\n2,B,,,,,,1,2,,,,,,,,,,about 1 hour,30\n3,C,,,,,,1,2,,,,,,,,,,Static,-5\n`);
    expect(r.items[0]!.timeSinceUpdateMinutes).toBe(15);
    expect(r.items[1]!.timeSinceUpdateText).toBe('about 1 hour');
    expect(r.items[1]!.randomTimerSeconds).toBe(30);
    expect(r.items[2]!.timeSinceUpdateMinutes).toBeUndefined();
    expect(r.items[2]!.timeSinceUpdateText).toBeUndefined();
    expect(r.items[2]!.randomTimerSeconds).toBeUndefined();
  });

  it('fails clearly when required columns are missing', () => {
    expect(() => parseSheetCsv('Title_EN,Region\nA,MY\n')).toThrow(SheetFormatError);
    expect(() => parseSheetCsv('Title_EN,Region\nA,MY\n')).toThrow(/Current_Value_Min/);
  });

  it('detects an HTML login page instead of CSV', () => {
    expect(() => parseSheetCsv('<!DOCTYPE html><html><body>Sign in</body></html>')).toThrow(/web page/);
  });

  it('parses number cells strictly', () => {
    expect(parseNumberCell(' 1,234.5 ')).toBe(1234.5);
    expect(parseNumberCell('97%')).toBe(97);
    expect(parseNumberCell('')).toBeUndefined();
    expect(parseNumberCell('abc')).toBeNaN();
    expect(parseNumberCell('1.2.3')).toBeNaN();
    expect(parseNumberCell('Infinity')).toBeNaN();
  });
});

describe('sheet URL building', () => {
  const base = { fetchTimeoutMs: 1000 };
  it('uses the CSV URL as given', () => {
    expect(resolveCsvUrl({ ...base, csvUrl: 'https://example.com/x.csv' })).toBe('https://example.com/x.csv');
  });
  it('converts a normal sheet link into a CSV export link', () => {
    expect(resolveCsvUrl({ ...base, csvUrl: 'https://docs.google.com/spreadsheets/d/ABC_123/edit?gid=0#gid=0' })).toBe(
      'https://docs.google.com/spreadsheets/d/ABC_123/export?format=csv&gid=0',
    );
  });
  it('builds from sheet id + gid, or sheet id + tab name', () => {
    expect(resolveCsvUrl({ ...base, id: 'ABC', gid: '0' })).toBe('https://docs.google.com/spreadsheets/d/ABC/export?format=csv&gid=0');
    expect(resolveCsvUrl({ ...base, id: 'ABC', tab: 'Game List' })).toBe('https://docs.google.com/spreadsheets/d/ABC/gviz/tq?tqx=out:csv&sheet=Game%20List');
  });
  it('returns undefined when nothing is configured', () => {
    expect(resolveCsvUrl(base)).toBeUndefined();
  });
});

describe('Limit (24H) columns', () => {
  it('reads Low_Limit_24H_Min / High_Limit_24H_Max with thousands separators', () => {
    const csv = 'Title_EN,Current_Value_Min,Current_Value_Max,Low_Limit_24H_Min,High_Limit_24H_Max\nA,95,99.5,"54,925","62,150"\nB,95,99.5,,\n';
    const r = parseSheetCsv(csv);
    expect(r.items[0]!.limit24h).toEqual({ min: 54925, max: 62150 });
    expect(r.items[1]!.limit24h).toBeUndefined();
  });
});

describe('pictures', () => {
  it('converts Google Drive share links to direct image links', () => {
    const direct = 'https://drive.usercontent.google.com/download?id=1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO&export=view';
    expect(toDirectImageUrl('https://drive.google.com/file/d/1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO/view?usp=drive_link')).toBe(direct);
    expect(toDirectImageUrl('https://drive.google.com/open?id=1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO')).toBe(direct);
    expect(toDirectImageUrl('https://i.imgur.com/AbC123x.png')).toBe('https://i.imgur.com/AbC123x.png');
  });

  it('uses Image_Link when present, keeping Image_Name as a plain name', () => {
    const csv = 'Image_Name,Image_Link,Title_EN,Current_Value_Min,Current_Value_Max\n1,https://drive.google.com/file/d/1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO/view,A,1,2\n2,,B,1,2\nhttps://i.imgur.com/x1.png,,C,1,2\n';
    const r = parseSheetCsv(csv);
    expect(r.items[0]!.imageName).toBe('1');
    expect(r.items[0]!.imageUrl).toContain('drive.usercontent.google.com');
    expect(r.items[1]!.imageUrl).toBeUndefined();
    expect(r.items[2]!.imageUrl).toBe('https://i.imgur.com/x1.png');
  });
});

import { imageUrlCandidates } from '../src/dashboard/render.js';
describe('Drive picture addresses', () => {
  it('tries backup public addresses for Drive pictures only', () => {
    const c = imageUrlCandidates('https://drive.usercontent.google.com/download?id=1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO&export=view');
    expect(c).toHaveLength(3);
    expect(c[1]).toContain('lh3.googleusercontent.com/d/1CF-tp_cWZy8JFf1byZ0YNtmBZKALhdhO');
    expect(imageUrlCandidates('https://example.com/a.png')).toEqual(['https://example.com/a.png']);
  });
});
