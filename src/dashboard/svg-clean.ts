/**
 * Builds the dashboard as an SVG string (1600 × 900 design grid).
 *
 * Layout (from the agreed sketch):
 *
 *   [image]  Title             CURRENT VALUE    BASELINE VALUE
 *            标题                 96.85            93.34
 *            Generated …       ─────────        ─────────
 *   SOURCE   REGION
 *
 *   LIMIT (24H)
 *   58,231
 *   ──────────────────────────────────────────────────────────
 *   3,412,345        3,280,112        2
 *   ─────────        ─────────        ─────────
 *   VOLUME (24H)     OUTPUT (24H)     EVENT COUNT (24H)
 *
 *   SIMULATED DATA · For demonstration only …          [SIMULATED DATA]
 *
 * Any block whose value is missing is left out, so the image never shows
 * "undefined", "NaN" or invented placeholders.
 */
import type { DashboardItem } from '../data/types.js';
import type { SimulatedDashboard } from '../simulation/metrics.js';
import { formatMalaysiaDisplay } from '../utils/time.js';
import { escapeXml as x, estimateTextWidth, fitText, formatValue } from './format.js';

export const DESIGN_WIDTH = 1600;
export const DESIGN_HEIGHT = 900;

export const FONT_STACK = "'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','Noto Sans CJK','Microsoft YaHei','PingFang SC',sans-serif";

const C = {
  bg: '#0A1020',
  panel: '#121B30',
  border: '#24324F',
  text: '#F1F5F9',
  muted: '#93A3BD',
  faint: '#5B6B86',
  line: '#2A3A5A',
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
  /** Optional picture as a data: URI (only when Image_Name is an image URL). */
  thumbnailDataUri?: string;
  width?: number;
  height?: number;
  /** Card titles (pro design); missing ones use the defaults. */
  labels?: Partial<import('../config/env.js').DashboardLabels>;
}

type Anchor = 'start' | 'middle' | 'end';

function text(px: number, py: number, content: string, size: number, opts: { color?: string; weight?: number; anchor?: Anchor; spacing?: number } = {}): string {
  return `<text x="${px}" y="${py}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.color ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''}>${x(content)}</text>`;
}

function label(px: number, py: number, content: string, maxWidth: number): string {
  const f = fitText(content, maxWidth, 16, 11);
  return text(px, py, f.text, f.size, { color: C.muted, weight: 700, spacing: 2 });
}

function accentLine(px: number, py: number, width: number, color: string): string {
  return `<rect x="${px}" y="${py}" width="${Math.round(width)}" height="4" rx="2" fill="${color}"/>`;
}

function pill(rightX: number, y: number, content: string, color: string): { svg: string; width: number } {
  const size = 18;
  const w = Math.round(estimateTextWidth(content, size) + content.length * 2 + 40);
  const left = rightX - w;
  return {
    width: w,
    svg:
      `<rect x="${left}" y="${y}" width="${w}" height="40" rx="20" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.75" stroke-width="1.5"/>` +
      text(left + w / 2, y + 27, content, size, { color, weight: 700, anchor: 'middle', spacing: 2 }),
  };
}

export function buildCleanSvg(input: RenderInput): string {
  const { item, sim } = input;
  const out: string[] = [];
  const M = 72;
  const right = DESIGN_WIDTH - M;

  // ---------- Picture (or a lettered tile when there is no picture) ----------
  const IMG = 150;
  const imgY = 56;
  const primary = item.titleEn ?? item.titleCn ?? 'Dashboard';
  if (input.thumbnailDataUri) {
    out.push(`<clipPath id="imgClip"><rect x="${M}" y="${imgY}" width="${IMG}" height="${IMG}" rx="24"/></clipPath>`);
    out.push(`<image x="${M}" y="${imgY}" width="${IMG}" height="${IMG}" href="${x(input.thumbnailDataUri)}" clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid slice"/>`);
    out.push(`<rect x="${M}" y="${imgY}" width="${IMG}" height="${IMG}" rx="24" fill="none" stroke="${C.border}" stroke-width="2"/>`);
  } else {
    const initial = [...primary.trim()][0]?.toUpperCase() ?? '•';
    out.push(`<rect x="${M}" y="${imgY}" width="${IMG}" height="${IMG}" rx="24" fill="url(#tile)" stroke="${C.border}" stroke-width="2"/>`);
    out.push(text(M + IMG / 2, imgY + IMG / 2 + 28, initial, 80, { anchor: 'middle', weight: 800, color: C.text }));
  }

  // ---------- Title block ----------
  const titleX = M + IMG + 32;
  const titleMax = 780 - titleX;
  const secondary = item.titleEn && item.titleCn ? item.titleCn : undefined;
  const t1 = fitText(primary, titleMax, 60, 30);
  out.push(text(titleX, imgY + 62, t1.text, t1.size, { weight: 800 }));
  let nextY = imgY + 62;
  if (secondary) {
    const t2 = fitText(secondary, titleMax, 32, 20);
    nextY += 46;
    out.push(text(titleX, nextY, t2.text, t2.size, { color: C.muted, weight: 500 }));
  }
  out.push(text(titleX, Math.max(nextY + 42, imgY + IMG - 6), `Generated ${formatMalaysiaDisplay(input.timestamp)}`, 17, { color: C.faint }));

  // ---------- Source / Region (under the picture) ----------
  const meta: Array<[string, string]> = [];
  if (item.dataSource) meta.push(['SOURCE', item.dataSource]);
  if (item.region) meta.push(['REGION', item.region]);
  meta.forEach(([lab, val], i) => {
    const mx = M + i * 300;
    out.push(label(mx, 262, lab, 270));
    const v = fitText(val, 270, 28, 18);
    out.push(text(mx, 300, v.text, v.size, { weight: 600 }));
  });

  // ---------- Top-right: Current Value and Baseline Value ----------
  const stats: Array<{ lab: string; val: string; color: string }> = [{ lab: 'CURRENT VALUE', val: formatValue(sim.current), color: C.yellow }];
  if (sim.baseline) stats.push({ lab: 'BASELINE VALUE', val: formatValue(sim.baseline), color: C.cyan });
  const statW = 330;
  stats.forEach((s, i) => {
    const sx = right - (stats.length - i) * statW + 20;
    out.push(label(sx, 110, s.lab, statW - 40));
    const v = fitText(s.val, statW - 40, 96, 48);
    out.push(text(sx, 205, v.text, v.size, { color: s.color, weight: 800 }));
    out.push(accentLine(sx, 232, statW - 60, s.color));
  });

  // ---------- Middle: Limit (24H) ----------
  if (sim.limit24h) {
    out.push(label(M, 392, 'LIMIT (24H)', 400));
    const v = fitText(formatValue(sim.limit24h), right - M, 150, 60);
    out.push(text(M - 4, 540, v.text, v.size, { weight: 800, color: C.text }));
  }
  out.push(`<rect x="${M}" y="590" width="${right - M}" height="2" fill="${C.line}"/>`);

  // ---------- Bottom row: Volume / Output / Event Count ----------
  const bottom: Array<{ lab: string; val: string; color: string }> = [];
  if (sim.volume24h) bottom.push({ lab: 'VOLUME (24H)', val: formatValue(sim.volume24h), color: C.cyan });
  if (sim.output24h) bottom.push({ lab: 'OUTPUT (24H)', val: formatValue(sim.output24h), color: C.pink });
  if (sim.eventCount24h) bottom.push({ lab: 'EVENT COUNT (24H)', val: formatValue(sim.eventCount24h), color: C.yellow });
  if (bottom.length) {
    const colW = (right - M) / Math.max(3, bottom.length);
    bottom.forEach((b, i) => {
      const bx = Math.round(M + i * colW);
      const v = fitText(b.val, colW - 60, 68, 32);
      out.push(text(bx, 700, v.text, v.size, { weight: 800 }));
      out.push(accentLine(bx, 724, Math.min(colW - 80, 320), b.color));
      out.push(label(bx, 764, b.lab, colW - 60));
    });
  }

  // ---------- Footer: disclosure ----------
  const badges = pill(right, 818, input.simulatedLabel.toUpperCase(), C.yellow);
  out.push(badges.svg);
  if (input.demo) out.push(pill(right - badges.width - 14, 818, 'DEMO CONFIGURATION', C.pink).svg);
  out.push(text(M, 845, `${input.simulatedLabel.toUpperCase()} · For demonstration only. Values are generated within configured ranges and are not real measurements or forecasts.`, 15, { color: C.faint }));

  const w = input.width ?? DESIGN_WIDTH;
  const h = input.height ?? DESIGN_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}" font-family="${FONT_STACK}">
<defs>
  <radialGradient id="bgGlow" cx="0.85" cy="0.0" r="1.0">
    <stop offset="0" stop-color="#17264D"/>
    <stop offset="1" stop-color="${C.bg}"/>
  </radialGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1E3A8A"/>
    <stop offset="1" stop-color="#0E7490"/>
  </linearGradient>
</defs>
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#bgGlow)"/>
${out.join('\n')}
</svg>`;
}
