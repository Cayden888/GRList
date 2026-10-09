/**
 * Builds the dashboard as an SVG string (1600 × 900 design grid).
 *
 * The SVG is plain text, so tests can inspect exactly what will be drawn.
 * Cards for missing values are left out entirely – the layout reflows – so
 * the image never shows "undefined", "NaN" or invented placeholders.
 */
import type { DashboardItem } from '../data/types.js';
import type { SimulatedDashboard } from '../simulation/metrics.js';
import { formatMalaysiaDisplay } from '../utils/time.js';
import { escapeXml as x, estimateTextWidth, fitText, formatDuration, formatNumber, formatSigned, formatValue } from './format.js';

export const DESIGN_WIDTH = 1600;
export const DESIGN_HEIGHT = 900;

export const FONT_STACK = "'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','Noto Sans CJK','Microsoft YaHei','PingFang SC',sans-serif";

const C = {
  bg: '#0A1020',
  bg2: '#111A2E',
  card: '#131D33',
  cardBorder: '#24324F',
  text: '#F1F5F9',
  muted: '#93A3BD',
  faint: '#5B6B86',
  grid: '#22304B',
  yellow: '#FACC15',
  cyan: '#22D3EE',
  pink: '#F472B6',
};

export interface RenderInput {
  item: DashboardItem;
  sim: SimulatedDashboard;
  /** Timestamp printed on the image (scheduled or generated time). */
  timestamp: Date;
  simulatedLabel: string;
  /** Adds a "DEMO CONFIGURATION" badge (preview without a sheet). */
  demo?: boolean;
  /** Optional thumbnail as a data: URI (only when Image_Name is an image URL). */
  thumbnailDataUri?: string;
  width?: number;
  height?: number;
}

interface Card {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  accent: string;
}

function rect(px: number, py: number, w: number, h: number, extra = ''): string {
  return `<rect x="${px}" y="${py}" width="${w}" height="${h}" rx="22" ry="22" fill="${C.card}" stroke="${C.cardBorder}" stroke-width="1.5" filter="url(#shadow)" ${extra}/>`;
}

function text(px: number, py: number, content: string, size: number, opts: { color?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; spacing?: number } = {}): string {
  return `<text x="${px}" y="${py}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.color ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''}>${x(content)}</text>`;
}

/** Catmull-Rom spline through the points, as cubic Bézier path commands. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const k = 1 / 6;
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C${c1[0]!.toFixed(1)},${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)},${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function pill(rightX: number, y: number, label: string, color: string): { svg: string; width: number } {
  const size = 18;
  const w = Math.round(estimateTextWidth(label, size) + label.length * 2 + 40);
  const left = rightX - w;
  const svg =
    `<rect x="${left}" y="${y}" width="${w}" height="40" rx="20" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.75" stroke-width="1.5"/>` +
    text(left + w / 2, y + 27, label, size, { color, weight: 700, anchor: 'middle', spacing: 2 });
  return { svg, width: w };
}

export function buildDashboardSvg(input: RenderInput): string {
  const { item, sim } = input;
  const out: string[] = [];
  const M = 64; // outer margin
  const right = DESIGN_WIDTH - M;

  // ---------- Header ----------
  let titleX = M;
  if (input.thumbnailDataUri) {
    out.push(`<clipPath id="thumbClip"><rect x="${M}" y="44" width="92" height="92" rx="18"/></clipPath>`);
    out.push(`<image x="${M}" y="44" width="92" height="92" href="${x(input.thumbnailDataUri)}" clip-path="url(#thumbClip)" preserveAspectRatio="xMidYMid slice"/>`);
    out.push(`<rect x="${M}" y="44" width="92" height="92" rx="18" fill="none" stroke="${C.cardBorder}" stroke-width="1.5"/>`);
    titleX = M + 116;
  }

  const badges: string[] = [];
  const sim1 = pill(right, 46, input.simulatedLabel.toUpperCase(), C.yellow);
  badges.push(sim1.svg);
  if (input.demo) badges.push(pill(right - sim1.width - 14, 46, 'DEMO CONFIGURATION', C.pink).svg);
  out.push(...badges);
  out.push(text(right, 120, `Generated ${formatMalaysiaDisplay(input.timestamp)}`, 18, { color: C.muted, anchor: 'end' }));

  const titleMaxWidth = right - titleX - (input.demo ? 620 : 400);
  const primary = item.titleEn ?? item.titleCn ?? 'Dashboard';
  const secondary = item.titleEn && item.titleCn ? item.titleCn : undefined;
  const t1 = fitText(primary, titleMaxWidth, 50, 30);
  out.push(text(titleX, secondary ? 90 : 106, t1.text, t1.size, { weight: 700 }));
  if (secondary) {
    const t2 = fitText(secondary, titleMaxWidth, 30, 20);
    out.push(text(titleX, 134, t2.text, t2.size, { color: C.muted, weight: 500 }));
  }

  // ---------- Meta chips ----------
  const chips: Array<[string, string]> = [];
  if (item.dataSource) chips.push(['DATA SOURCE', item.dataSource]);
  if (item.region) chips.push(['REGION', item.region]);
  if (item.lastUpdated) chips.push(['LAST UPDATED', item.lastUpdated]);
  if (item.nextUpdate) chips.push(['NEXT UPDATE', item.nextUpdate]);
  let cx = M;
  for (const [label, rawValue] of chips) {
    const value = fitText(rawValue, 260, 18, 18).text;
    const lw = estimateTextWidth(label, 13) + label.length * 1.5;
    const vw = estimateTextWidth(value, 18);
    const w = Math.round(lw + vw + 46);
    if (cx + w > right) break;
    out.push(`<rect x="${cx}" y="164" width="${w}" height="38" rx="19" fill="${C.bg2}" stroke="${C.cardBorder}" stroke-width="1.2"/>`);
    out.push(text(cx + 18, 188, label, 13, { color: C.faint, weight: 700, spacing: 1.5 }));
    out.push(text(cx + 18 + lw + 10, 189, value, 18, { color: C.text, weight: 500 }));
    cx += w + 12;
  }

  // ---------- Bottom cards (built first so we know if the row exists) ----------
  const accents = [C.cyan, C.pink, C.yellow];
  const cards: Card[] = [];
  const push = (c: Omit<Card, 'accent'>) => cards.push({ ...c, accent: accents[cards.length % accents.length]! });
  if (sim.baseline) push({ label: 'BASELINE VALUE', value: formatValue(sim.baseline), sub: 'Simulated' });
  if (sim.difference) {
    const v = sim.difference.value;
    push({ label: 'DIFFERENCE FROM BASELINE', value: formatSigned(sim.difference), sub: 'Current − Baseline', color: v > 0 ? C.cyan : v < 0 ? C.pink : C.text });
  }
  if (sim.volume24h) push({ label: 'VOLUME (24H)', value: formatValue(sim.volume24h), sub: 'Simulated' });
  if (sim.output24h) push({ label: 'OUTPUT (24H)', value: formatValue(sim.output24h), sub: 'Simulated' });
  if (sim.eventCount24h) push({ label: 'EVENT COUNT (24H)', value: formatValue(sim.eventCount24h), sub: 'Simulated' });
  {
    const ts = sim.timeSinceUpdate;
    const value = ts.text ?? (ts.minutes !== undefined ? formatDuration(ts.minutes) : undefined);
    if (value) push({ label: 'TIME SINCE LAST UPDATE', value, sub: ts.simulated ? 'Simulated' : 'From configuration' });
  }

  const topY = 232;
  const hasCards = cards.length > 0;
  const topH = hasCards ? 384 : 590;
  const cardsY = topY + topH + 24;
  const cardsH = 822 - cardsY;

  // ---------- Main value card ----------
  const mainW = 500;
  out.push(rect(M, topY, mainW, topH));
  out.push(`<rect x="${M}" y="${topY + 28}" width="5" height="40" rx="2.5" fill="${C.yellow}"/>`);
  out.push(text(M + 32, topY + 56, 'CURRENT VALUE', 18, { color: C.muted, weight: 700, spacing: 2.5 }));
  const mainValue = formatValue(sim.current);
  const mv = fitText(mainValue, mainW - 64, 132, 60);
  const mainBaseline = topY + (hasCards ? 214 : 300);
  out.push(text(M + 32, mainBaseline, mv.text, mv.size, { color: C.yellow, weight: 800 }));
  if (sim.difference) {
    const color = sim.difference.value > 0 ? C.cyan : sim.difference.value < 0 ? C.pink : C.muted;
    const label = `${formatSigned(sim.difference)} vs baseline`;
    const w = Math.round(estimateTextWidth(label, 20) + 36);
    out.push(`<rect x="${M + 32}" y="${mainBaseline + 34}" width="${w}" height="40" rx="20" fill="${color}" fill-opacity="0.12"/>`);
    out.push(text(M + 32 + 18, mainBaseline + 61, label, 20, { color, weight: 700 }));
  }
  out.push(text(M + 32, topY + topH - 32, 'Simulated value within the configured range', 16, { color: C.faint }));

  // ---------- Trend card ----------
  const gx = M + mainW + 24;
  const gw = right - gx;
  out.push(rect(gx, topY, gw, topH));
  out.push(`<rect x="${gx}" y="${topY + 28}" width="5" height="40" rx="2.5" fill="${C.cyan}"/>`);
  out.push(text(gx + 32, topY + 56, 'Simulated 24-Hour Trend', 24, { weight: 700 }));
  out.push(text(gx + gw - 32, topY + 56, 'Hourly simulated points · not historical data', 15, { color: C.faint, anchor: 'end' }));

  const plotL = gx + 104;
  const plotR = gx + gw - 44;
  const plotT = topY + 100;
  const plotB = topY + topH - 64;
  let lo = item.current.min;
  let hi = item.current.max;
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.01 || 1;
    lo -= pad;
    hi += pad;
  }
  const yOf = (v: number) => plotB - ((v - lo) / (hi - lo)) * (plotB - plotT);
  const xOf = (h: number) => plotL + ((h + 24) / 24) * (plotR - plotL);
  const dec = sim.current.decimals;
  for (const v of [item.current.min, (item.current.min + item.current.max) / 2, item.current.max]) {
    const yy = yOf(v).toFixed(1);
    out.push(`<line x1="${plotL}" y1="${yy}" x2="${plotR}" y2="${yy}" stroke="${C.grid}" stroke-width="1.2" stroke-dasharray="${v === item.current.min ? '0' : '5 7'}"/>`);
    out.push(text(plotL - 16, Number(yy) + 6, formatNumber(v, dec), 16, { color: C.faint, anchor: 'end' }));
    if (item.current.min === item.current.max) break;
  }
  for (const h of [-24, -18, -12, -6, 0]) {
    out.push(text(xOf(h), plotB + 34, h === 0 ? '0h' : `−${Math.abs(h)}h`, 16, { color: C.faint, anchor: 'middle' }));
  }

  const pts: Array<[number, number]> = sim.trend.map((p) => [xOf(p.hourOffset), yOf(p.value)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1]!;
  out.push(`<path d="${line} L${last[0].toFixed(1)},${plotB} L${pts[0]![0].toFixed(1)},${plotB} Z" fill="url(#area)"/>`);
  out.push(`<path d="${line}" fill="none" stroke="${C.cyan}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  out.push(`<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="14" fill="${C.yellow}" fill-opacity="0.18"/>`);
  out.push(`<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="7" fill="${C.yellow}" stroke="${C.bg}" stroke-width="2.5"/>`);
  // Value tag on a dark chip, placed above the dot (or below when near the top).
  const tagW = Math.round(estimateTextWidth(mainValue, 18) + 24);
  const tagTop = last[1] < plotT + 50 ? last[1] + 18 : last[1] - 50;
  const tagLeft = last[0] - tagW - 2;
  out.push(`<rect x="${tagLeft.toFixed(1)}" y="${tagTop.toFixed(1)}" width="${tagW}" height="32" rx="10" fill="${C.bg}" fill-opacity="0.92" stroke="${C.yellow}" stroke-opacity="0.5" stroke-width="1.2"/>`);
  out.push(text(tagLeft + tagW / 2, tagTop + 22, mainValue, 18, { color: C.yellow, weight: 700, anchor: 'middle' }));

  // ---------- Bottom metric cards ----------
  if (hasCards) {
    const gap = 24;
    const totalW = right - M;
    const cw = (totalW - gap * (cards.length - 1)) / cards.length;
    cards.forEach((c, i) => {
      const px = Math.round(M + i * (cw + gap));
      const w = Math.round(cw);
      out.push(rect(px, cardsY, w, cardsH));
      out.push(`<rect x="${px}" y="${cardsY + 24}" width="4" height="30" rx="2" fill="${c.accent}"/>`);
      const lbl = fitText(c.label, w - 52, 15, 11);
      out.push(text(px + 26, cardsY + 46, lbl.text, lbl.size, { color: C.muted, weight: 700, spacing: 1.5 }));
      const val = fitText(c.value, w - 52, 46, 24);
      out.push(text(px + 26, cardsY + 108, val.text, val.size, { color: c.color ?? C.text, weight: 700 }));
      if (c.sub) out.push(text(px + 26, cardsY + cardsH - 24, c.sub, 15, { color: C.faint }));
    });
  }

  // ---------- Footer ----------
  out.push(text(M, 866, `${input.simulatedLabel.toUpperCase()} · For demonstration only. Values are generated within configured ranges and are not real measurements or forecasts.`, 15, { color: C.faint }));

  const w = input.width ?? DESIGN_WIDTH;
  const h = input.height ?? DESIGN_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}" font-family="${FONT_STACK}">
<defs>
  <radialGradient id="bgGlow" cx="0.82" cy="0.05" r="0.9">
    <stop offset="0" stop-color="#16244A"/>
    <stop offset="1" stop-color="${C.bg}"/>
  </radialGradient>
  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.cyan}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
  </linearGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
    <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.35"/>
  </filter>
</defs>
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#bgGlow)"/>
${out.join('\n')}
</svg>`;
}
