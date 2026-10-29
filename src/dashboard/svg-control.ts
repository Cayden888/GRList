/**
 * "Control" theme — PLANT PULSE · Precision Control Room.
 *
 *  ┌ header: PLANT PULSE | DAILY STATS | item | SOURCE | REGION ……… UPDATED | status ┐
 *  ┌ LimitMonitor (main metric + precision gauge) ┐ ┌ ValueComparison ───────────┐
 *  │                                             │ │ CURRENT / BASELINE / DIFF  │
 *  └─────────────────────────────────────────────┘ └────────────────────────────┘
 *  ┌ 24H ACTIVITY MONITOR (range view) ──────────┐ ┌ SYSTEM INFORMATION ────────┐
 *  ┌ OperationalMetrics: VOLUME | OUTPUT | EVENT COUNT ─────────────────────────┐
 *  disclosure
 *
 * No invented history is drawn: the activity monitor places the current and
 * baseline readings on a common scale against their configured ranges.
 * Every block hides itself when its value is missing.
 */
import type { NumericRange } from '../data/types.js';
import type { SimulatedValue } from '../simulation/metrics.js';
import { formatMalaysiaDisplay } from '../utils/time.js';
import { escapeXml as x, estimateTextWidth, fitText, formatDuration, formatNumber, formatSigned, formatValue } from './format.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';

// ---------------------------------------------------------------- tokens
const C = {
  bg: '#0B1118',
  bg2: '#111A23',
  panel: '#17222D',
  raised: '#1D2B36',
  text: '#E9F0F5',
  muted: '#8C9CAA',
  faint: '#5F7080',
  accent: '#6EAEB8',
  accent2: '#A7BED0',
  good: '#75B39D',
  warn: '#D8AE68',
  bad: '#C77C78',
  border: '#293A46',
  grid: '#223140',
};
const SANS = `'IBM Plex Sans',${FONT_STACK}`;
const MONO = `'IBM Plex Mono','Noto Sans Mono CJK SC',monospace`;
const R = 6; // panel corner radius
const PAD = 24;

// ---------------------------------------------------------------- primitives
type Anchor = 'start' | 'middle' | 'end';
interface TextOpts { color?: string; weight?: number; anchor?: Anchor; spacing?: number; mono?: boolean }

const n1 = (v: number) => Math.round(v * 10) / 10;

function t(px: number, py: number, s: string, size: number, o: TextOpts = {}): string {
  const fam = o.mono ? ` font-family="${MONO}"` : '';
  return `<text x="${n1(px)}" y="${n1(py)}" font-size="${size}" font-weight="${o.weight ?? 400}" fill="${o.color ?? C.text}"${fam}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}>${x(s)}</text>`;
}
/** Plex Mono advance width is exactly 0.6 em. */
const monoW = (s: string, size: number) => [...s].length * 0.6 * size;
const labelW = (s: string, size: number, spacing: number) => estimateTextWidth(s, size) * 0.9 + s.length * spacing;

/** Small uppercase technical label. */
const label = (px: number, py: number, s: string, o: { color?: string; anchor?: Anchor; size?: number } = {}) =>
  t(px, py, s, o.size ?? 12, { color: o.color ?? C.muted, weight: 600, spacing: 1.6, anchor: o.anchor });

function panel(px: number, py: number, w: number, h: number, title?: string, note?: string): string {
  let s = `<rect x="${px}" y="${py}" width="${w}" height="${h}" rx="${R}" fill="${C.panel}" stroke="${C.border}" stroke-width="1"/>`;
  if (title) {
    s += `<rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="43" rx="${R - 1}" fill="${C.raised}" fill-opacity="0.45"/>`;
    s += `<rect x="${px}" y="${py + 44}" width="${w}" height="1" fill="${C.border}"/>`;
    s += `<rect x="${px + PAD}" y="${py + 18}" width="3" height="10" fill="${C.accent}"/>`;
    s += label(px + PAD + 12, py + 28, title, { color: C.text });
    if (note) s += label(px + w - PAD, py + 28, note, { anchor: 'end', size: 11, color: C.faint });
  }
  return s;
}

const vline = (px: number, y1: number, y2: number, color = C.border) => `<rect x="${n1(px)}" y="${n1(y1)}" width="1" height="${n1(y2 - y1)}" fill="${color}"/>`;
const hline = (x1: number, x2: number, py: number, color = C.border) => `<rect x="${n1(x1)}" y="${n1(py)}" width="${n1(x2 - x1)}" height="1" fill="${color}"/>`;

const frac = (v: number, r: NumericRange) => (r.max > r.min ? Math.min(1, Math.max(0, (v - r.min) / (r.max - r.min))) : 1);

/** Compact position bar: thin track, filled to the reading, 2px marker. */
function miniBar(px: number, py: number, w: number, v: SimulatedValue, r: NumericRange, color: string): string {
  const mx = px + frac(v.value, r) * w;
  return `<rect x="${n1(px)}" y="${n1(py)}" width="${n1(w)}" height="2" fill="${C.grid}"/>` +
    `<rect x="${n1(px)}" y="${n1(py)}" width="${n1(mx - px)}" height="2" fill="${color}" fill-opacity="0.7"/>` +
    `<rect x="${n1(mx - 1)}" y="${n1(py - 5)}" width="2" height="12" fill="${color}"/>`;
}

/** Precision range gauge: scale with minor/major ticks, value markers, current position. */
function gauge(px: number, py: number, w: number, v: SimulatedValue, r: NumericRange): string {
  const out: string[] = [];
  const minor = 40;
  for (let i = 0; i <= minor; i++) {
    const tx = px + (i / minor) * w;
    const major = i % 10 === 0;
    const mid = i % 5 === 0;
    out.push(`<rect x="${n1(tx - 0.5)}" y="${n1(py + 8)}" width="1" height="${major ? 14 : mid ? 9 : 5}" fill="${major ? C.muted : C.border}"/>`);
    if (major) {
      const val = r.min + (i / minor) * (r.max - r.min);
      out.push(t(tx, py + 42, formatNumber(val, v.decimals), 12, { mono: true, color: i === 0 || i === minor ? C.muted : C.faint, anchor: i === 0 ? 'start' : i === minor ? 'end' : 'middle' }));
    }
  }
  // track + filled segment
  out.push(`<rect x="${px}" y="${py}" width="${w}" height="4" fill="${C.raised}"/>`);
  const cx = px + frac(v.value, r) * w;
  out.push(`<rect x="${px}" y="${py}" width="${n1(cx - px)}" height="4" fill="${C.accent}" fill-opacity="0.55"/>`);
  // end stops
  out.push(`<rect x="${px - 1}" y="${py - 10}" width="2" height="24" fill="${C.muted}"/>`);
  out.push(`<rect x="${px + w - 1}" y="${py - 10}" width="2" height="24" fill="${C.muted}"/>`);
  out.push(label(px, py - 18, 'MIN', { size: 11, color: C.faint }));
  out.push(label(px + w, py - 18, 'MAX', { size: 11, color: C.faint, anchor: 'end' }));
  // current marker
  out.push(`<rect x="${n1(cx - 1)}" y="${py - 22}" width="2" height="34" fill="${C.text}"/>`);
  out.push(`<path d="M${n1(cx - 6)},${py - 30} H${n1(cx + 6)} L${n1(cx)},${py - 22} Z" fill="${C.text}"/>`);
  return out.join('');
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (hi <= lo) return [lo];
  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}
const stepDecimals = (ticks: number[]) => (ticks.length < 2 || Math.abs(ticks[1]! - ticks[0]!) >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(Math.abs(ticks[1]! - ticks[0]!)) - 1e-9)));

// ---------------------------------------------------------------- build
export function buildControlSvg(input: RenderInput): string {
  const { item, sim } = input;
  const W = DESIGN_WIDTH;
  const M = 24;
  const GAP = 16;
  const RIGHT = W - M;
  const out: string[] = [];

  // ============ SystemHeader ============
  const HH = 64;
  out.push(`<rect x="0" y="0" width="${W}" height="${HH}" fill="${C.bg2}"/>`);
  out.push(hline(0, W, HH, C.border));
  // product mark: small square with a pulse trace
  out.push(`<rect x="${M}" y="18" width="28" height="28" rx="4" fill="none" stroke="${C.accent}" stroke-width="1.5"/>`);
  out.push(`<path d="M${M + 5},33 H${M + 10} L${M + 13},25 L${M + 17},40 L${M + 20},31 H${M + 23}" fill="none" stroke="${C.accent}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`);
  let hx = M + 42;
  out.push(t(hx, 38, 'PLANT PULSE', 15, { weight: 600, spacing: 2.2 }));
  hx += labelW('PLANT PULSE', 15, 2.2) + 20;
  out.push(vline(hx, 20, 44));
  hx += 20;
  out.push(t(hx, 38, 'DAILY STATS', 13, { weight: 600, spacing: 1.8, color: C.accent }));
  hx += labelW('DAILY STATS', 13, 1.8) + 20;
  out.push(vline(hx, 20, 44));
  hx += 20;

  // right side first, so the left side knows its limit
  const updated = formatMalaysiaDisplay(input.timestamp);
  const statusText = input.simulatedLabel.toUpperCase();
  const pillW = Math.round(labelW(statusText, 12, 1.6) + 40);
  const pillX = RIGHT - pillW;
  out.push(`<rect x="${pillX}" y="17" width="${pillW}" height="30" rx="4" fill="${C.warn}" fill-opacity="0.08" stroke="${C.warn}" stroke-opacity="0.6" stroke-width="1"/>`);
  out.push(`<circle cx="${pillX + 15}" cy="32" r="3.5" fill="${C.warn}"/>`);
  out.push(label(pillX + 26, 36.5, statusText, { color: C.warn }));
  let rx = pillX - 24;
  if (input.demo) {
    const dt = 'DEMO CONFIGURATION';
    const dw = Math.round(labelW(dt, 12, 1.6) + 28);
    out.push(`<rect x="${rx - dw}" y="17" width="${dw}" height="30" rx="4" fill="none" stroke="${C.accent2}" stroke-opacity="0.6" stroke-width="1"/>`);
    out.push(label(rx - dw / 2, 36.5, dt, { color: C.accent2, anchor: 'middle' }));
    rx -= dw + 24;
  }
  out.push(t(rx, 38, updated, 14, { mono: true, anchor: 'end' }));
  rx -= monoW(updated, 14) + 12;
  out.push(label(rx, 37, 'UPDATED', { anchor: 'end', size: 11, color: C.faint }));
  rx -= labelW('UPDATED', 11, 1.6) + 24;
  out.push(vline(rx, 20, 44));
  const leftLimit = rx - 24;

  // item identity
  const primary = item.titleEn ?? item.titleCn ?? 'Dashboard';
  out.push(`<clipPath id="imgClip"><rect x="${hx}" y="16" width="32" height="32" rx="4"/></clipPath>`);
  if (input.thumbnailDataUri) {
    out.push(`<image x="${hx}" y="16" width="32" height="32" href="${x(input.thumbnailDataUri)}" clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    out.push(`<rect x="${hx}" y="16" width="32" height="32" rx="4" fill="url(#tile)"/>`);
    out.push(t(hx + 16, 38, [...primary.trim()][0]?.toUpperCase() ?? '•', 15, { weight: 600, anchor: 'middle', color: C.text }));
  }
  out.push(`<rect x="${hx}" y="16" width="32" height="32" rx="4" fill="none" stroke="${C.border}" stroke-width="1"/>`);
  hx += 44;

  const meta: Array<[string, string]> = [];
  if (item.dataSource) meta.push(['SOURCE', item.dataSource]);
  if (item.region) meta.push(['REGION', item.region]);
  const metaW = meta.reduce((a, [l, v]) => a + labelW(l, 11, 1.6) + 8 + estimateTextWidth(v, 14) * 1.05 + 20, 0);
  const titleBudget = Math.max(120, leftLimit - hx - metaW - 24);
  const tt = fitText(primary, titleBudget * (item.titleEn && item.titleCn ? 0.6 : 1) / 1.08, 17, 12);
  out.push(t(hx, 39, tt.text, tt.size, { weight: 600 }));
  hx += estimateTextWidth(tt.text, tt.size) * 1.08 + 10;
  if (item.titleEn && item.titleCn) {
    const cn = fitText(item.titleCn, Math.max(40, leftLimit - metaW - 24 - hx), 15, 11);
    out.push(t(hx, 39, cn.text, cn.size, { color: C.muted }));
    hx += estimateTextWidth(cn.text, cn.size) + 10;
  }
  hx += 14;
  for (const [l, v] of meta) {
    out.push(vline(hx, 20, 44));
    hx += 16;
    out.push(label(hx, 37, l, { size: 11, color: C.faint }));
    hx += labelW(l, 11, 1.6) + 8;
    out.push(t(hx, 38, v, 14, { color: C.text }));
    hx += estimateTextWidth(v, 14) * 1.05 + 12;
  }

  // ============ Grid ============
  const top = HH + 20;
  const ops: Array<{ lab: string; v: SimulatedValue; r?: NumericRange; unit: string }> = [];
  if (sim.volume24h) ops.push({ lab: 'VOLUME (24H)', v: sim.volume24h, r: item.volume24h, unit: 'Total over the reporting window' });
  if (sim.output24h) ops.push({ lab: 'OUTPUT (24H)', v: sim.output24h, r: item.output24h, unit: 'Total over the reporting window' });
  if (sim.eventCount24h) ops.push({ lab: 'EVENT COUNT (24H)', v: sim.eventCount24h, r: item.eventCount24h, unit: 'Recorded events, whole count' });
  const opsH = ops.length ? 140 : 0;
  const footerY = 846;
  const bottom = footerY - 22;
  const row3Y = bottom - opsH;
  const row2H = 210;
  const row2Y = (ops.length ? row3Y - GAP : bottom) - row2H;
  const row1H = row2Y - GAP - top;
  const leftW = 960;
  const rightX = M + leftW + GAP;
  const rightW = RIGHT - rightX;

  // main metric: LIMIT (24H) when configured, otherwise CURRENT VALUE
  const limitMain = sim.limit24h && item.limit24h ? { lab: 'LIMIT (24H)', v: sim.limit24h, r: item.limit24h } : undefined;
  const main = limitMain ?? { lab: 'CURRENT VALUE', v: sim.current, r: item.current };

  // ============ LimitMonitor ============
  const hasRight = Boolean(limitMain || (sim.baseline && item.baseline));
  const mainW = hasRight ? leftW : RIGHT - M;
  {
    const px = M;
    const py = top;
    out.push(panel(px, py, mainW, row1H, main.lab, `REFERENCE RANGE  ${formatNumber(main.r.min, main.v.decimals)} – ${formatNumber(main.r.max, main.v.decimals)}`));
    const val = formatValue(main.v);
    const big = Math.min(104, Math.floor((mainW * 0.44) / (0.6 * Math.max(4, val.length))));
    const gaugeY = py + row1H - 74;
    const numY = py + 44 + (gaugeY - 40 - (py + 44)) / 2 + big * 0.36;
    out.push(t(px + PAD - 3, numY, val, big, { mono: true, weight: 500 }));
    // derived readouts (all from the reading and its configured range)
    const span = main.r.max - main.r.min;
    const readouts: Array<[string, string]> = [];
    if (span > 0) {
      readouts.push(['POSITION IN RANGE', `${formatNumber(frac(main.v.value, main.r) * 100, 1)}%`]);
      readouts.push(['ABOVE MIN', formatNumber(main.v.value - main.r.min, main.v.decimals)]);
      readouts.push(['BELOW MAX', formatNumber(main.r.max - main.v.value, main.v.decimals)]);
    }
    const colWs = [184, 140, 140];
    let rx2 = px + mainW - PAD - colWs.slice(0, readouts.length).reduce((a, b) => a + b, 0);
    if (rx2 > px + PAD + monoW(val, big) + 24) {
      for (const [ri, [l, v]] of readouts.entries()) {
        const colW = colWs[ri]!;
        out.push(vline(rx2, numY - 58, numY));
        out.push(label(rx2 + 16, numY - 40, l, { size: 11, color: C.faint }));
        out.push(t(rx2 + 16, numY - 4, v, 24, { mono: true, weight: 500 }));
        rx2 += colW;
      }
    }
    out.push(gauge(px + PAD + 8, gaugeY, mainW - PAD * 2 - 16, main.v, main.r));
  }

  // ============ ValueComparison ============
  if (hasRight) {
    const px = rightX;
    const py = top;
    out.push(panel(px, py, rightW, row1H));
    const mods: Array<{ lab: string; v: SimulatedValue; r: NumericRange; color: string }> = [];
    if (limitMain) mods.push({ lab: 'CURRENT VALUE', v: sim.current, r: item.current, color: C.accent });
    if (sim.baseline && item.baseline) mods.push({ lab: 'BASELINE VALUE', v: sim.baseline, r: item.baseline, color: C.accent2 });
    const diffH = sim.difference ? 92 : 0;
    const modH = (row1H - diffH) / mods.length;
    mods.forEach((m, i) => {
      const my = py + i * modH;
      if (i > 0) out.push(hline(px, px + rightW, my));
      out.push(`<rect x="${px + PAD}" y="${n1(my + 22)}" width="3" height="10" fill="${m.color}"/>`);
      out.push(label(px + PAD + 12, my + 32, m.lab, { color: C.text }));
      out.push(label(px + rightW - PAD, my + 32, `RANGE  ${formatNumber(m.r.min, m.v.decimals)} – ${formatNumber(m.r.max, m.v.decimals)}`, { anchor: 'end', size: 11, color: C.faint }));
      const size = Math.min(54, Math.max(30, modH - 72));
      out.push(t(px + PAD - 2, my + 44 + size * 0.95, formatValue(m.v), size, { mono: true, weight: 500 }));
      const bw = 200;
      out.push(miniBar(px + rightW - PAD - bw, my + 44 + size * 0.62, bw, m.v, m.r, m.color));
      out.push(label(px + rightW - PAD - bw, my + 44 + size * 0.62 + 24, 'POSITION', { size: 10, color: C.faint }));
      out.push(t(px + rightW - PAD, my + 44 + size * 0.62 + 24, `${formatNumber(frac(m.v.value, m.r) * 100, 1)}%`, 12, { mono: true, color: C.muted, anchor: 'end' }));
    });
    if (sim.difference) {
      const dy = py + row1H - diffH;
      out.push(`<rect x="${px + 1}" y="${dy}" width="${rightW - 2}" height="${diffH - 1}" fill="${C.raised}" fill-opacity="0.5"/>`);
      out.push(hline(px, px + rightW, dy));
      const d = sim.difference.value;
      const col = d > 0 ? C.good : d < 0 ? C.bad : C.muted;
      out.push(label(px + PAD, dy + 38, 'DIFFERENCE', { color: C.text }));
      out.push(t(px + PAD, dy + 62, 'Current value − baseline value', 12, { color: C.faint }));
      const ds = formatSigned(sim.difference);
      out.push(t(px + rightW - PAD, dy + 58, ds, 32, { mono: true, weight: 500, color: col, anchor: 'end' }));
      const ax = px + rightW - PAD - monoW(ds, 32) - 22;
      out.push(d > 0 ? `<path d="M${ax - 7},${dy + 52} H${ax + 7} L${ax},${dy + 40} Z" fill="${col}"/>` : d < 0 ? `<path d="M${ax - 7},${dy + 40} H${ax + 7} L${ax},${dy + 52} Z" fill="${col}"/>` : '');
    }
  }

  // ============ ActivityMonitor (range view — no invented history) ============
  const showActivity = Boolean(limitMain || sim.difference);
  if (showActivity) {
    const px = M;
    const py = row2Y;
    const w = leftW;
    out.push(panel(px, py, w, row2H, '24H ACTIVITY MONITOR', 'RANGE VIEW · NO HISTORICAL SERIES'));
    const lanes: Array<{ lab: string; v: SimulatedValue; r: NumericRange; color: string }> = [{ lab: 'CURRENT VALUE', v: sim.current, r: item.current, color: C.accent }];
    const comparable = Boolean(sim.difference && sim.baseline && item.baseline);
    if (comparable) lanes.push({ lab: 'BASELINE VALUE', v: sim.baseline!, r: item.baseline!, color: C.accent2 });
    let lo = Math.min(...lanes.map((l) => Math.min(l.r.min, l.v.value)));
    let hi = Math.max(...lanes.map((l) => Math.max(l.r.max, l.v.value)));
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const padV = (hi - lo) * 0.06;
    lo -= padV;
    hi += padV;
    const tx0 = px + 200;
    const tx1 = px + w - PAD - 8;
    const X = (v: number) => tx0 + ((v - lo) / (hi - lo)) * (tx1 - tx0);
    const axisY = py + row2H - 40;
    const ticks = niceTicks(lo, hi, 7).filter((v) => v >= lo && v <= hi);
    const td = Math.max(stepDecimals(ticks), 0);
    for (const tv of ticks) {
      const xx = X(tv);
      out.push(vline(xx, py + 62, axisY, C.grid));
      out.push(`<rect x="${n1(xx - 0.5)}" y="${axisY}" width="1" height="6" fill="${C.muted}"/>`);
      out.push(t(xx, axisY + 24, formatNumber(tv, td), 12, { mono: true, color: C.faint, anchor: 'middle' }));
    }
    out.push(hline(tx0, tx1, axisY, C.muted));
    const laneGap = lanes.length === 1 ? 0 : 46;
    const firstY = lanes.length === 1 ? py + 100 : py + 84;
    const markers: number[] = [];
    lanes.forEach((l, i) => {
      const ly = firstY + i * laneGap;
      out.push(label(px + PAD, ly + 5, l.lab, { size: 11 }));
      const bx0 = X(l.r.min);
      const bx1 = X(l.r.max);
      out.push(`<rect x="${n1(bx0)}" y="${ly - 7}" width="${n1(Math.max(2, bx1 - bx0))}" height="14" fill="${l.color}" fill-opacity="0.14" stroke="${l.color}" stroke-opacity="0.45" stroke-width="1"/>`);
      const mx = X(l.v.value);
      markers.push(mx);
      out.push(`<rect x="${n1(mx - 1)}" y="${ly - 13}" width="2" height="26" fill="${l.color}"/>`);
      const vs = formatValue(l.v);
      const anchorEnd = mx + monoW(vs, 13) + 12 > tx1;
      out.push(t(anchorEnd ? mx - 8 : mx + 8, ly - 12, vs, 13, { mono: true, color: C.text, anchor: anchorEnd ? 'end' : 'start' }));
    });
    if (comparable && sim.difference) {
      const [a, b] = [Math.min(markers[0]!, markers[1]!), Math.max(markers[0]!, markers[1]!)];
      const by = firstY + laneGap + 26;
      out.push(`<path d="M${n1(a)},${by - 6} V${by} H${n1(b)} V${by - 6}" fill="none" stroke="${C.muted}" stroke-width="1"/>`);
      const ds = `Δ ${formatSigned(sim.difference)}`;
      const midX = (a + b) / 2;
      const bw = monoW(ds, 12) + 14;
      out.push(`<rect x="${n1(midX - bw / 2)}" y="${by - 8}" width="${n1(bw)}" height="18" rx="3" fill="${C.panel}"/>`);
      out.push(t(midX, by + 5, ds, 12, { mono: true, color: C.muted, anchor: 'middle' }));
    }
  }

  // ============ SystemInformation ============
  {
    const px = showActivity ? rightX : M;
    const py = row2Y;
    const w = showActivity ? rightW : RIGHT - M;
    out.push(panel(px, py, w, row2H, 'SYSTEM INFORMATION'));
    const ts = sim.timeSinceUpdate;
    const since = ts.text ?? (ts.minutes !== undefined ? `${formatDuration(ts.minutes)} ago` : undefined);
    const cells: Array<{ l: string; v: string; span?: boolean; color?: string }> = [];
    if (item.dataSource) cells.push({ l: 'SOURCE', v: item.dataSource });
    if (item.region) cells.push({ l: 'REGION', v: item.region });
    cells.push({ l: 'UPDATED', v: updated, span: true });
    if (since) cells.push({ l: 'TIME SINCE UPDATE', v: since });
    if (sim.difference) {
      const d = sim.difference.value;
      cells.push({ l: 'DIFFERENCE', v: formatSigned(sim.difference), color: d > 0 ? C.good : d < 0 ? C.bad : C.text });
    }
    if (limitMain) {
      cells.push({ l: '24H MINIMUM', v: formatNumber(limitMain.r.min, limitMain.v.decimals) });
      cells.push({ l: '24H MAXIMUM', v: formatNumber(limitMain.r.max, limitMain.v.decimals) });
    }
    const colW = (w - PAD * 2 - 32) / 2;
    const rows: Array<typeof cells> = [];
    for (const c of cells) {
      const last = rows[rows.length - 1];
      if (!c.span && last && last.length === 1 && !last[0]!.span) last.push(c);
      else rows.push([c]);
    }
    for (const row of rows) if (row.length === 1) row[0] = { ...row[0]!, span: true };
    const rowH = Math.min(40, (row2H - 52 - 10) / Math.max(1, rows.length));
    rows.forEach((row, ri) => {
      const cy = py + 52 + ri * rowH;
      if (ri > 0) out.push(hline(px + PAD, px + w - PAD, cy, C.grid));
      row.forEach((c, ci) => {
        const cx = px + PAD + ci * (colW + 32);
        const cw = c.span ? w - PAD * 2 : colW;
        if (ci === 1) out.push(vline(cx - 16, cy + 8, cy + rowH - 8, C.grid));
        out.push(label(cx, cy + rowH / 2 + 4, c.l, { size: 10, color: C.faint }));
        const fv = fitText(c.v, cw - labelW(c.l, 10, 1.6) - 16, 14, 11);
        out.push(t(cx + cw, cy + rowH / 2 + 5, fv.text, fv.size, { mono: true, color: c.color ?? C.text, anchor: 'end' }));
      });
    });
  }

  // ============ OperationalMetrics ============
  if (ops.length) {
    const px = M;
    const py = row3Y;
    const w = RIGHT - M;
    out.push(panel(px, py, w, opsH));
    const sw = w / 3;
    ops.forEach((o, i) => {
      const sx = px + i * sw;
      if (i > 0) out.push(vline(sx, py + 18, py + opsH - 18));
      const ix = sx + PAD + (i > 0 ? 8 : 0);
      const iw = sw - PAD * 2 - (i > 0 ? 8 : 0);
      out.push(`<rect x="${n1(ix)}" y="${py + 22}" width="6" height="6" fill="${C.accent}" fill-opacity="${0.5 + i * 0.2}"/>`);
      out.push(label(ix + 14, py + 30, o.lab, { color: C.text }));
      out.push(label(ix + iw, py + 30, o.unit.toUpperCase(), { size: 9, color: C.faint, anchor: 'end' }));
      const vs = formatValue(o.v);
      const fs = Math.min(42, Math.floor(iw / (0.6 * Math.max(6, vs.length))));
      out.push(t(ix - 2, py + 82, vs, fs, { mono: true, weight: 500 }));
      if (o.r) {
        out.push(t(ix, py + 108, `REF ${formatNumber(o.r.min, o.v.decimals)} – ${formatNumber(o.r.max, o.v.decimals)}`, 12, { mono: true, color: C.faint }));
        out.push(miniBar(ix, py + 122, iw, o.v, o.r, C.accent));
      }
    });
  }

  // ============ Footer ============
  out.push(hline(M, RIGHT, footerY - 6, C.grid));
  out.push(`<circle cx="${M + 4}" cy="${footerY + 15}" r="3" fill="${C.warn}"/>`);
  out.push(t(M + 16, footerY + 20, `${statusText} · For demonstration only. Values are generated within configured ranges and are not real measurements or forecasts.`, 13, { color: C.muted }));
  out.push(t(RIGHT, footerY + 20, `ID ${item.id.toUpperCase()}`, 12, { mono: true, color: C.faint, anchor: 'end' }));

  const ow = input.width ?? DESIGN_WIDTH;
  const oh = input.height ?? DESIGN_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}" font-family="${SANS}">
<defs>
  <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.raised}"/>
    <stop offset="1" stop-color="${C.panel}"/>
  </linearGradient>
</defs>
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="${C.bg}"/>
${out.join('\n')}
</svg>`;
}
