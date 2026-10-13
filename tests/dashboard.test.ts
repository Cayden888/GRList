import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { generateDashboard } from '../src/dashboard/generate.js';
import { escapeXml, fitText, formatDuration, formatSigned } from '../src/dashboard/format.js';
import { buildDashboardSvg, FONT_STACK } from '../src/dashboard/svg.js';
import { simulateDashboard } from '../src/simulation/metrics.js';
import { sampleItem, testConfig } from './helpers.js';

const OPTS = { currentValueSource: 'generate' as const, timeSinceUpdateMinMinutes: 3, timeSinceUpdateMaxMinutes: 45 };
const TS = new Date('2026-10-09T06:47:00Z'); // 2:47 PM MYT

function svgFor(overrides = {}, extra = {}) {
  const item = sampleItem(overrides);
  const sim = simulateDashboard(item, 'svg-test', OPTS);
  return { svg: buildDashboardSvg({ item, sim, timestamp: TS, simulatedLabel: 'SIMULATED DATA', ...extra }), sim, item };
}

const BANNED = /\b(rtp|bet|bets|betting|payout|jackpot|explode|slot|slots|gamble|gambling|casino|win rate|prediction|predict|guaranteed|live data|verified)\b/i;

afterAll(async () => {
  await rm('output/test', { recursive: true, force: true });
});

describe('dashboard SVG', () => {
  it('shows the simulated-data disclosure, the trend label and Malaysia time', () => {
    const { svg } = svgFor();
    expect(svg).toContain('SIMULATED DATA');
    expect(svg).toContain('9 Oct 2026, 2:47 PM MYT');
    expect(svg).toContain('not real measurements');
  });

  it('shows English and Chinese titles', () => {
    const { svg } = svgFor();
    expect(svg).toContain('Sample Item');
    expect(svg).toContain('示例项目');
    expect(svg).toContain(FONT_STACK.split(',')[0]);
  });

  it('shows all labels when every field is configured, with readable names', () => {
    const { svg } = svgFor({ limit24h: { min: 54925, max: 62150 } });
    for (const label of ['CURRENT VALUE', 'BASELINE VALUE', 'LIMIT (24H)', 'VOLUME (24H)', 'OUTPUT (24H)', 'EVENT COUNT (24H)', 'SOURCE', 'REGION']) {
      expect(svg).toContain(label);
    }
    expect(svg).not.toMatch(/[A-Za-z]+_[A-Za-z]+_?(Min|Max)/); // no raw column names
  });

  it('hides blocks for missing optional fields and never prints undefined/NaN', () => {
    const { svg } = svgFor({ baseline: undefined, volume24h: undefined, output24h: undefined, eventCount24h: undefined, limit24h: undefined, dataSource: undefined, titleCn: undefined });
    for (const gone of ['BASELINE VALUE', 'LIMIT', 'VOLUME', 'OUTPUT', 'EVENT COUNT', 'SOURCE']) expect(svg).not.toContain(gone);
    expect(svg).toContain('CURRENT VALUE');
    expect(svg).toContain('REGION');
    expect(svg).not.toMatch(/undefined|NaN|Infinity|null/);
  });

  it('shows a lettered tile when there is no picture, and the picture when there is one', () => {
    expect(svgFor().svg).toContain('url(#tile)');
    const withPic = svgFor({}, { thumbnailDataUri: 'data:image/png;base64,AAAA' }).svg;
    expect(withPic).toContain('<image');
    expect(withPic).not.toContain('fill="url(#tile)"');
  });

  it('formats the main value and contains no gambling or prediction wording', () => {
    const { svg, sim } = svgFor({ volume24h: { min: 100000, max: 900000 } });
    expect(svg).toContain(sim.current.value.toFixed(2));
    expect(svg).toMatch(/\d{3},\d{3}/); // thousands separator
    const visibleText = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
    expect(visibleText).not.toMatch(BANNED);
  });

  it('adds a demo badge in demo mode', () => {
    expect(svgFor({}, { demo: true }).svg).toContain('DEMO CONFIGURATION');
  });

  it('escapes special characters from the sheet', () => {
    const { svg } = svgFor({ titleEn: 'A & B <script>' });
    expect(svg).toContain('A &amp; B &lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});

describe('formatting helpers', () => {
  it('formats signed differences, durations and escapes XML', () => {
    expect(formatSigned({ value: 2.5, decimals: 2 })).toBe('+2.50');
    expect(formatSigned({ value: -1.2, decimals: 2 })).toBe('−1.20');
    expect(formatSigned({ value: 0, decimals: 2 })).toBe('0.00');
    expect(formatDuration(37)).toBe('37 min');
    expect(formatDuration(125)).toBe('2 h 5 min');
    expect(escapeXml(`"'<>&`)).toBe('&quot;&apos;&lt;&gt;&amp;');
  });

  it('shrinks or truncates long text to fit', () => {
    const r = fitText('A very very very long dashboard title that will not fit', 300, 50, 30);
    expect(r.size).toBe(30);
    expect(r.text.endsWith('…')).toBe(true);
    expect(fitText('Short', 300, 50, 30)).toEqual({ text: 'Short', size: 50 });
  });
});

describe('PNG rendering', () => {
  it('renders a 1600×900 PNG', async () => {
    const config = testConfig();
    const g = await generateDashboard(config, { malaysiaDate: '2026-10-09', items: [sampleItem()], timestamp: TS, skipThumbnail: true });
    const meta = await sharp(g.pngPath).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(900);
  });

  it('has a font that really draws Chinese characters (no missing-glyph boxes)', async () => {
    // Render a real Chinese character and a character that no font has.
    // If Chinese were missing, both would come out as the same "tofu" box.
    const render = (ch: string) =>
      sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#fff"/><text x="10" y="95" font-size="90" font-family="${FONT_STACK}" fill="#000">${ch}</text></svg>`))
        .greyscale()
        .raw()
        .toBuffer();
    const [cn1, cn2, tofu] = await Promise.all([render('演'), render('板'), render('')]);
    expect(cn1.equals(tofu)).toBe(false);
    expect(cn2.equals(tofu)).toBe(false);
    expect(cn1.equals(cn2)).toBe(false);
    const ink = [...cn1].filter((v) => v < 128).length;
    expect(ink).toBeGreaterThan(300);
  });

  it('renders the same image bytes for the same day and item (retries)', async () => {
    const config = testConfig();
    const a = await generateDashboard(config, { malaysiaDate: '2026-10-09', items: [sampleItem()], timestamp: TS, skipThumbnail: true, fileTag: '-a' });
    const b = await generateDashboard(config, { malaysiaDate: '2026-10-09', items: [sampleItem()], timestamp: TS, skipThumbnail: true, fileTag: '-b' });
    expect(a.svg).toBe(b.svg);
  });
});
