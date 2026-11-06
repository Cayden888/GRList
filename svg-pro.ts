/**
 * "Pro" theme: a calm, finance-terminal style report.
 *
 *   [pic] Title · 标题                                   [SIMULATED DATA]
 *         SOURCE LU · REGION Malaysia · time · last update
 *   ┌──────────── CURRENT VALUE · 24H ───────────┐  ┌ BASELINE VALUE ┐
 *   │ 97.84  +1.07 vs baseline   HIGH  LOW  AVG  │  ├ LIMIT (24H) ───┤
 *   │ ~~~~~~ simulated 24-hour line chart ~~~~~~ │  ├ LAST UPDATE ───┤
 *   └────────────────────────────────────────────┘  └────────────────┘
 *   [ VOLUME (24H) ]   [ OUTPUT (24H) ]   [ EVENT COUNT (24H) ]
 *   disclosure line
 *
 * Every block hides itself when its value is missing. The 24H high / low /
 * average are computed from the drawn line, so they always match the chart.
 */
import type { NumericRange } from '../data/types.js';
import type { SimulatedValue } from '../simulation/metrics.js';
import { formatMalaysiaDisplay } from '../utils/time.js';
import { escapeXml as x, estimateTextWidth, fitText, formatDuration, formatNumber, formatSigned, formatValue } from './format.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';
import { DEFAULT_LABELS } from '../config/env.js';

const C = {
  bg: '#0A0D13',
  bg2: '#0F131C',
  panel: '#121722',
  panel2: '#161C29',
  border: '#232B3A',
  grid: '#1E2533',
  text: '#E8EBF1',
  muted: '#8B94A7',
  faint: '#5A6377',
  accent: '#3FD0A4', // line / positive
  accentDim: '#1F6F5A',
  gold: '#D6B25E', // baseline + brand
  red: '#F06A76',
  amber: '#F2B84B',
  blue: '#6EA8FE',
};

type Anchor = 'start' | 'middle' | 'end';

function t(px: number, py: number, content: string, size: number, o: { color?: string; weight?: number; anchor?: Anchor; spacing?: number; opacity?: number } = {}): string {
  return `<text x="${r(px)}" y="${r(py)}" font-size="${size}" font-weight="${o.weight ?? 400}" fill="${o.color ?? C.text}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''}>${x(content)}</text>`;
}

const r = (n: number) => Math.round(n * 10) / 10;

function card(px: number, py: number, w: number, h: number): string {
  return `<rect x="${r(px)}" y="${r(py)}" width="${r(w)}" height="${r(h)}" rx="14" fill="url(#panel)" stroke="${C.border}" stroke-width="1.5"/>`;
}

function cardLabel(px: number, py: number, content: string, maxW: number, dot?: string): string {
  const f = fitText(content, maxW - (dot ? 18 : 0), 14, 10);
  return (dot ? `<circle cx="${r(px + 4)}" cy="${r(py - 5)}" r="4" fill="${dot}"/>` : '') + t(px + (dot ? 16 : 0), py, f.text, f.size, { color: C.muted, weight: 700, spacing: 2 });
}

/** Thin bar showing where a value sits inside its configured min–max. */
function rangeBar(px: number, py: number, w: number, value: SimulatedValue, range: NumericRange, color: string, showMinMax = true): string {
  const span = range.max - range.min;
  const frac = span > 0 ? Math.min(1, Math.max(0, (value.value - range.min) / span)) : 1;
  const mx = px + frac * w;
  return (
    `<rect x="${r(px)}" y="${r(py)}" width="${r(w)}" height="6" rx="3" fill="${C.grid}"/>` +
    `<rect x="${r(px)}" y="${r(py)}" width="${r(Math.max(6, frac * w))}" height="6" rx="3" fill="${color}" fill-opacity="0.85"/>` +
    `<circle cx="${r(mx)}" cy="${r(py + 3)}" r="7" fill="${C.bg}" stroke="${color}" stroke-width="3"/>` +
    (!showMinMax ? '' :
    t(px, py + 30, `MIN ${formatNumber(range.min, value.decimals)}`, 13, { color: C.faint, weight: 600, spacing: 1 }) +
    t(px + w, py + 30, `MAX ${formatNumber(range.max, value.decimals)}`, 13, { color: C.faint, weight: 600, spacing: 1, anchor: 'end' }))
  );
}

/** "Nice" axis ticks (1, 2, 2.5, 5 × 10ⁿ steps). */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo];
  const raw = (hi - lo) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function decimalsForStep(ticks: number[]): number {
  if (ticks.length < 2) return 2;
  const step = Math.abs(ticks[1]! - ticks[0]!);
  return step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) + 1e-9));
}

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smoothPath(pts: Array<[number, number]>): string {
  let d = `M${r(pts[0]![0])},${r(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r(c1[0]!)},${r(c1[1]!)} ${r(c2[0]!)},${r(c2[1]!)} ${r(p2[0])},${r(p2[1])}`;
  }
  return d;
}

export function buildProSvg(input: RenderInput): string {
  const { item, sim } = input;
  const L = { ...DEFAULT_LABELS, ...input.labels };
  const out: string[] = [];
  const M = 48;
  const RIGHT = DESIGN_WIDTH - M;
  const GAP = 18;

  // ================= Header =================
  const PIC = 84;
  const picY = 38;
  const primary = item.titleEn ?? item.titleCn ?? 'Dashboard';
  out.push(`<clipPath id="imgClip"><rect x="${M}" y="${picY}" width="${PIC}" height="${PIC}" rx="16"/></clipPath>`);
  if (input.thumbnailDataUri) {
    out.push(`<image x="${M}" y="${picY}" width="${PIC}" height="${PIC}" href="${x(input.thumbnailDataUri)}" clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    const initial = [...primary.trim()][0]?.toUpperCase() ?? '•';
    out.push(`<rect x="${M}" y="${picY}" width="${PIC}" height="${PIC}" rx="16" fill="url(#tile)"/>`);
    out.push(t(M + PIC / 2, picY + PIC / 2 + 16, initial, 44, { anchor: 'middle', weight: 700, color: C.bg }));
  }
  out.push(`<rect x="${M}" y="${picY}" width="${PIC}" height="${PIC}" rx="16" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1.5"/>`);

  // Disclosure badge (top right) – measured first so the title never runs into it.
  const badgeText = input.simulatedLabel.toUpperCase();
  const badgeW = Math.round(estimateTextWidth(badgeText, 15) + badgeText.length * 2 + 48);
  const badgeX = RIGHT - badgeW;
  out.push(`<rect x="${badgeX}" y="46" width="${badgeW}" height="36" rx="18" fill="${C.amber}" fill-opacity="0.10" stroke="${C.amber}" stroke-opacity="0.8" stroke-width="1.5"/>`);
  out.push(`<circle cx="${badgeX + 20}" cy="64" r="4" fill="${C.amber}"/>`);
  out.push(t(badgeX + 32, 69.5, badgeText, 15, { color: C.amber, weight: 700, spacing: 2 }));
  let demoW = 0;
  if (input.demo) {
    const dt = 'DEMO CONFIGURATION';
    demoW = Math.round(estimateTextWidth(dt, 14) + dt.length * 2 + 32);
    out.push(`<rect x="${badgeX - demoW - 12}" y="46" width="${demoW}" height="36" rx="18" fill="none" stroke="${C.blue}" stroke-width="1.5"/>`);
    out.push(t(badgeX - 12 - demoW / 2, 69, dt, 14, { color: C.blue, weight: 700, spacing: 2, anchor: 'middle' }));
    demoW += 12;
  }

  const titleX = M + PIC + 24;
  const titleMax = badgeX - demoW - 40 - titleX;
  const t1 = fitText(primary, (titleMax * (item.titleEn && item.titleCn ? 0.62 : 1)) / 1.12, 38, 22);
  out.push(t(titleX, 80, t1.text, t1.size, { weight: 700 }));
  if (item.titleEn && item.titleCn) {
    const used = estimateTextWidth(t1.text, t1.size) * 1.12 + 22;
    const t2 = fitText(item.titleCn, titleMax - used, 26, 16);
    out.push(t(titleX + used, 80, t2.text, t2.size, { color: C.muted, weight: 500 }));
  }

  // Meta line: SOURCE · REGION · time · last update
  const meta: Array<[string, string]> = [];
  if (item.dataSource) meta.push(['SOURCE', item.dataSource]);
  if (item.region) meta.push(['REGION', item.region]);
  meta.push(['GENERATED', formatMalaysiaDisplay(input.timestamp)]);
  const ts = sim.timeSinceUpdate;
  const tsText = ts.text ?? (ts.minutes !== undefined ? `${formatDuration(ts.minutes)} ago` : undefined);
  const hasSideMetrics = Boolean((sim.baseline && item.baseline) || (sim.limit24h && item.limit24h));
  if (tsText && !hasSideMetrics) meta.push(['LAST UPDATE', tsText]);
  let mx = titleX;
  for (const [lab, val] of meta) {
    const v = fitText(val, 300, 16, 12);
    out.push(t(mx, 113, lab, 12, { color: C.faint, weight: 700, spacing: 1.8 }));
    const lw = estimateTextWidth(lab, 12) + lab.length * 1.8 + 8;
    out.push(t(mx + lw, 113, v.text, v.size, { color: C.muted, weight: 500 }));
    mx += lw + estimateTextWidth(v.text, v.size) + 30;
  }
  out.push(`<rect x="${M}" y="146" width="${RIGHT - M}" height="1" fill="${C.border}"/>`);

  // ================= Layout regions =================
  const bottomCards: Array<{ lab: string; v: SimulatedValue; range?: NumericRange; color: string }> = [];
  if (sim.volume24h) bottomCards.push({ lab: L.volume.toUpperCase(), v: sim.volume24h, range: item.volume24h, color: C.blue });
  if (sim.output24h) bottomCards.push({ lab: L.output.toUpperCase(), v: sim.output24h, range: item.output24h, color: C.accent });
  if (sim.eventCount24h) bottomCards.push({ lab: L.eventCount.toUpperCase(), v: sim.eventCount24h, range: item.eventCount24h, color: C.gold });

  type Side = { h: number; draw: (px: number, py: number, w: number, h: number) => string };
  const side: Side[] = [];
  if (sim.baseline && item.baseline) {
    const v = sim.baseline;
    side.push({
      h: 1,
      draw: (px, py, w, h) =>
        card(px, py, w, h) +
        cardLabel(px + 24, py + 36, L.baseline.toUpperCase(), w - 48, C.gold) +
        t(px + 24, py + 36 + Math.min(62, h - 70), formatValue(v), Math.min(46, h - 82), { weight: 700 }) +
        t(px + w - 24, py + 36, `${formatNumber(item.baseline!.min, v.decimals)} – ${formatNumber(item.baseline!.max, v.decimals)}`, 13, { color: C.faint, weight: 600, anchor: 'end' }),
    });
  }
  if (sim.limit24h && item.limit24h) {
    const v = sim.limit24h;
    side.push({
      h: 1.3,
      draw: (px, py, w, h) => {
        const fs = Math.min(46, h - 106);
        return card(px, py, w, h) +
          cardLabel(px + 24, py + 36, L.limit.toUpperCase(), w - 48, C.blue) +
          t(px + 24, py + 42 + fs + 8, formatValue(v), fs, { weight: 700 }) +
          rangeBar(px + 24, py + h - 44, w - 48, v, item.limit24h!, C.blue, false);
      },
    });
  }
  if (tsText && hasSideMetrics) {
    side.push({
      h: 0.8,
      draw: (px, py, w, h) => {
        const f = fitText(tsText, w - 48, Math.min(34, h - 66), 18);
        return card(px, py, w, h) +
          cardLabel(px + 24, py + 36, 'LAST UPDATE', w - 48, C.accent) +
          t(px + 24, py + 36 + Math.min(48, h - 58), f.text, f.size, { weight: 600 }) +
          (item.nextUpdate ? t(px + w - 24, py + 36, `NEXT ${item.nextUpdate}`, 13, { color: C.faint, weight: 600, anchor: 'end' }) : '');
      },
    });
  }

  const mainTop = 170;
  const footerTop = 836;
  const bottomH = bottomCards.length ? 156 : 0;
  const mainBottom = footerTop - 22 - (bottomH ? bottomH + GAP : 0);
  const sideW = side.length ? 424 : 0;
  const chartW = RIGHT - M - (sideW ? sideW + GAP : 0);

  // ================= Side column =================
  if (side.length) {
    const sx = RIGHT - sideW;
    const avail = mainBottom - mainTop - GAP * (side.length - 1);
    const total = side.reduce((a, s) => a + s.h, 0);
    let sy = mainTop;
    for (const s of side) {
      const h = Math.round((avail * s.h) / total);
      out.push(s.draw(sx, sy, sideW, h));
      sy += h + GAP;
    }
  }

  // ================= Main chart panel =================
  const cx0 = M;
  out.push(card(cx0, mainTop, chartW, mainBottom - mainTop));
  out.push(cardLabel(cx0 + 28, mainTop + 40, `${L.current.toUpperCase()} · LAST 24H`, 360, C.accent));
  const cur = formatValue(sim.current);
  const big = fitText(cur, 360, 68, 40);
  out.push(t(cx0 + 26, mainTop + 112, big.text, big.size, { weight: 700 }));
  let chipX = cx0 + 26 + estimateTextWidth(big.text, big.size) + 22;
  if (sim.difference) {
    const d = sim.difference.value;
    const col = d > 0 ? C.accent : d < 0 ? C.red : C.muted;
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '■';
    const s = `${arrow} ${formatSigned(sim.difference)}`;
    const w = estimateTextWidth(s, 18) + 28;
    out.push(`<rect x="${r(chipX)}" y="${mainTop + 76}" width="${r(w)}" height="34" rx="8" fill="${col}" fill-opacity="0.13"/>`);
    out.push(t(chipX + 14, mainTop + 99, s, 18, { color: col, weight: 700 }));
    out.push(t(chipX, mainTop + 132, 'vs baseline', 13, { color: C.faint, weight: 500 }));
    chipX += w;
  }

  // High / Low / Avg from the line itself
  const vals = sim.trend.map((p) => p.value);
  const dec = sim.current.decimals;
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const stats: Array<[string, string]> = [
    ['24H HIGH', formatNumber(hi, dec)],
    ['24H LOW', formatNumber(lo, dec)],
    ['24H AVG', formatNumber(avg, dec)],
  ];
  const statW = 118;
  let stX = cx0 + chartW - 28 - statW * stats.length;
  if (stX > chipX + 30) {
    for (const [lab, val] of stats) {
      out.push(`<rect x="${r(stX)}" y="${mainTop + 58}" width="1" height="58" fill="${C.border}"/>`);
      out.push(t(stX + 16, mainTop + 76, lab, 12, { color: C.faint, weight: 700, spacing: 1.5 }));
      out.push(t(stX + 16, mainTop + 108, val, 24, { weight: 600 }));
      stX += statW;
    }
  }

  // Chart area
  const gx0 = cx0 + 28;
  const gx1 = cx0 + chartW - 86; // room for right-side axis labels
  const gy0 = mainTop + 168;
  const gy1 = mainBottom - 50;
  const baseVal = sim.difference && sim.baseline ? sim.baseline.value : undefined;
  let dLo = Math.min(lo, baseVal ?? lo);
  let dHi = Math.max(hi, baseVal ?? hi);
  if (dHi - dLo < 1e-9) {
    const pad = Math.abs(dHi) * 0.01 || 1;
    dLo -= pad;
    dHi += pad;
  }
  const padV = (dHi - dLo) * 0.12;
  dLo -= padV;
  dHi += padV;
  const ticks = niceTicks(dLo, dHi, 5).filter((v) => v >= dLo && v <= dHi);
  const tickDec = Math.max(decimalsForStep(ticks), 0);
  const X = (i: number) => gx0 + (i / (sim.trend.length - 1)) * (gx1 - gx0);
  const Y = (v: number) => gy1 - ((v - dLo) / (dHi - dLo)) * (gy1 - gy0);

  const lastY = Y(sim.current.value);
  for (const tv of ticks) {
    const yy = Y(tv);
    out.push(`<line x1="${gx0}" y1="${r(yy)}" x2="${gx1}" y2="${r(yy)}" stroke="${C.grid}" stroke-width="1"/>`);
    if (Math.abs(yy - lastY) > 20) out.push(t(gx1 + 14, yy + 5, formatNumber(tv, tickDec), 13, { color: C.faint, weight: 500 }));
  }
  const n = sim.trend.length;
  for (const h of [0, 6, 12, 18, 24]) {
    const i = Math.round((h / 24) * (n - 1));
    const xx = X(i);
    out.push(`<line x1="${r(xx)}" y1="${gy0}" x2="${r(xx)}" y2="${gy1}" stroke="${C.grid}" stroke-width="1" stroke-dasharray="2 6"/>`);
    const tickDate = new Date(input.timestamp.getTime() - (24 - h) * 3600_000);
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(tickDate);
    out.push(t(xx, gy1 + 30, h === 24 ? `${clock} NOW` : clock, 13, { color: h === 24 ? C.muted : C.faint, weight: 600, anchor: h === 0 ? 'start' : h === 24 ? 'end' : 'middle', spacing: 1 }));
  }

  const pts = sim.trend.map((p, i) => [X(i), Y(p.value)] as [number, number]);
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${r(px)},${r(py)}`).join(' ');
  out.push(`<path d="${line} L${r(gx1)},${gy1} L${r(gx0)},${gy1} Z" fill="url(#area)"/>`);
  if (baseVal !== undefined) {
    const by = Y(baseVal);
    out.push(`<line x1="${gx0}" y1="${r(by)}" x2="${gx1}" y2="${r(by)}" stroke="${C.gold}" stroke-width="1.5" stroke-dasharray="7 6" stroke-opacity="0.9"/>`);
    out.push(`<rect x="${gx0 + 8}" y="${r(by - 26)}" width="${r(estimateTextWidth('BASELINE', 11) + 26)}" height="20" rx="4" fill="${C.bg}" fill-opacity="0.85"/>`);
    out.push(t(gx0 + 16, by - 12, 'BASELINE', 11, { color: C.gold, weight: 700, spacing: 1.5 }));
  }
  out.push(`<path d="${line}" fill="none" stroke="${C.accent}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
  const [lx, ly] = pts[pts.length - 1]!;
  out.push(`<circle cx="${r(lx)}" cy="${r(ly)}" r="14" fill="${C.accent}" fill-opacity="0.18"/>`);
  out.push(`<circle cx="${r(lx)}" cy="${r(ly)}" r="6" fill="${C.accent}" stroke="${C.bg}" stroke-width="2"/>`);
  // value tag on the axis
  const tagW = estimateTextWidth(cur, 13) + 16;
  out.push(`<rect x="${r(gx1 + 6)}" y="${r(ly - 12)}" width="${r(tagW)}" height="24" rx="5" fill="${C.accent}"/>`);
  out.push(t(gx1 + 14, ly + 5, cur, 13, { color: C.bg, weight: 700 }));

  // ================= Bottom cards =================
  if (bottomCards.length) {
    const by = footerTop - 22 - bottomH;
    const cols = Math.max(3, bottomCards.length);
    const bw = (RIGHT - M - GAP * (cols - 1)) / cols;
    bottomCards.forEach((b, i) => {
      const bx = M + i * (bw + GAP);
      out.push(card(bx, by, bw, bottomH));
      out.push(cardLabel(bx + 24, by + 36, b.lab, bw - 48, b.color));
      const v = fitText(formatValue(b.v), bw - 48, 42, 26);
      out.push(t(bx + 24, by + 88, v.text, v.size, { weight: 700 }));
      if (b.range) out.push(rangeBar(bx + 24, by + 116, bw - 48, b.v, b.range, b.color, false));
    });
  }

  // ================= Footer =================
  out.push(t(M, footerTop + 24, `${input.simulatedLabel.toUpperCase()} · For demonstration only. Values and the chart are generated within configured ranges and are not real measurements or forecasts.`, 14, { color: C.faint }));

  const w = input.width ?? DESIGN_WIDTH;
  const h = input.height ?? DESIGN_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}" font-family="${FONT_STACK}">
<defs>
  <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.bg2}"/>
    <stop offset="1" stop-color="${C.bg}"/>
  </linearGradient>
  <radialGradient id="bgGlow" cx="0.2" cy="0" r="0.9">
    <stop offset="0" stop-color="${C.accent}" stop-opacity="0.07"/>
    <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.panel2}"/>
    <stop offset="1" stop-color="${C.panel}"/>
  </linearGradient>
  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.accent}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.gold}"/>
    <stop offset="1" stop-color="#9C7A33"/>
  </linearGradient>
</defs>
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#bgGrad)"/>
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#bgGlow)"/>
${out.join('\n')}
</svg>`;
}
