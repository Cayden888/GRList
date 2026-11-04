/**
 * "Gamer" theme: neon game-HUD style.
 * Same blocks and positions as the clean theme, restyled with angled panels,
 * glowing numbers, a grid background and a progress bar for Limit (24H).
 */
import { formatMalaysiaDisplay } from '../utils/time.js';
import { escapeXml as x, estimateTextWidth, fitText, formatNumber, formatValue } from './format.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';

const C = {
  bg: '#05060F',
  bg2: '#0B0F24',
  panel: '#0E1330',
  grid: '#1B2350',
  text: '#F5F7FF',
  muted: '#9AA6D6',
  faint: '#5D6796',
  cyan: '#00E5FF',
  magenta: '#FF2BD6',
  yellow: '#FFE600',
  lime: '#7CFF4F',
};

type Anchor = 'start' | 'middle' | 'end';

function text(px: number, py: number, content: string, size: number, opts: { color?: string; weight?: number; anchor?: Anchor; spacing?: number; glow?: string; italic?: boolean } = {}): string {
  const style = opts.italic ? ' font-style="italic"' : '';
  const filter = opts.glow ? ` filter="url(#glow-${opts.glow})"` : '';
  return `<text x="${px}" y="${py}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.color ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''}${style}${filter}>${x(content)}</text>`;
}

/** Panel with two cut corners (top-left and bottom-right), HUD style. */
function panel(px: number, py: number, w: number, h: number, color: string, cut = 22): string {
  const d = `M${px + cut},${py} H${px + w} V${py + h - cut} L${px + w - cut},${py + h} H${px} V${py + cut} Z`;
  return `<path d="${d}" fill="${C.panel}" fill-opacity="0.85" stroke="${color}" stroke-opacity="0.55" stroke-width="2"/>` +
    // bright corner ticks
    `<path d="M${px},${py + cut + 18} V${py + cut} L${px + cut},${py} H${px + cut + 18}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="square"/>` +
    `<path d="M${px + w},${py + h - cut - 18} V${py + h - cut} L${px + w - cut},${py + h} H${px + w - cut - 18}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="square"/>`;
}

function tag(px: number, py: number, content: string, color: string): string {
  const size = 15;
  const w = Math.round(estimateTextWidth(content, size) + content.length * 2.2 + 26);
  return `<path d="M${px + 8},${py} H${px + w} L${px + w - 8},${py + 28} H${px} Z" fill="${color}"/>` +
    text(px + w / 2, py + 20, content, size, { color: C.bg, weight: 800, anchor: 'middle', spacing: 2 });
}

function pill(rightX: number, y: number, content: string, color: string): { svg: string; width: number } {
  const size = 18;
  const w = Math.round(estimateTextWidth(content, size) + content.length * 2 + 44);
  const left = rightX - w;
  return {
    width: w,
    svg:
      `<path d="M${left + 12},${y} H${left + w} L${left + w - 12},${y + 40} H${left} Z" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2"/>` +
      text(left + w / 2, y + 27, content, size, { color, weight: 800, anchor: 'middle', spacing: 2 }),
  };
}

/** Small geometric icons (no external assets). */
function icon(kind: 'diamond' | 'bolt' | 'star', cx: number, cy: number, color: string): string {
  if (kind === 'diamond') return `<path d="M${cx},${cy - 13} L${cx + 11},${cy} L${cx},${cy + 13} L${cx - 11},${cy} Z" fill="${color}" filter="url(#glow-soft)"/>`;
  if (kind === 'bolt') return `<path d="M${cx + 3},${cy - 14} L${cx - 9},${cy + 2} H${cx - 1} L${cx - 4},${cy + 14} L${cx + 9},${cy - 3} H${cx + 1} Z" fill="${color}" filter="url(#glow-soft)"/>`;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 13 : 5.5;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${color}" filter="url(#glow-soft)"/>`;
}

export function buildGamerSvg(input: RenderInput): string {
  const { item, sim } = input;
  const out: string[] = [];
  const M = 64;
  const right = DESIGN_WIDTH - M;

  // ---------- Picture in a neon hex-cut frame ----------
  const IMG = 156;
  const imgX = M;
  const imgY = 52;
  const cut = 26;
  const frame = `M${imgX + cut},${imgY} H${imgX + IMG - cut} L${imgX + IMG},${imgY + cut} V${imgY + IMG - cut} L${imgX + IMG - cut},${imgY + IMG} H${imgX + cut} L${imgX},${imgY + IMG - cut} V${imgY + cut} Z`;
  const primary = item.titleEn ?? item.titleCn ?? 'Dashboard';
  out.push(`<clipPath id="imgClip"><path d="${frame}"/></clipPath>`);
  if (input.thumbnailDataUri) {
    out.push(`<image x="${imgX}" y="${imgY}" width="${IMG}" height="${IMG}" href="${x(input.thumbnailDataUri)}" clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    const initial = [...primary.trim()][0]?.toUpperCase() ?? '•';
    out.push(`<path d="${frame}" fill="url(#tile)"/>`);
    out.push(text(imgX + IMG / 2, imgY + IMG / 2 + 30, initial, 86, { anchor: 'middle', weight: 900, glow: 'soft' }));
  }
  out.push(`<path d="${frame}" fill="none" stroke="${C.cyan}" stroke-width="3" filter="url(#glow-cyan)"/>`);

  // ---------- Title block ----------
  const titleX = imgX + IMG + 34;
  const titleMax = 760 - titleX;
  out.push(tag(titleX, imgY + 2, 'DAILY STATS', C.cyan));
  const t1 = fitText(primary.toUpperCase(), titleMax, 64, 30);
  out.push(text(titleX - 2, imgY + 96, t1.text, t1.size, { weight: 900, italic: true, glow: 'soft' }));
  let nextY = imgY + 96;
  if (item.titleEn && item.titleCn) {
    const t2 = fitText(item.titleCn, titleMax, 30, 18);
    nextY += 42;
    out.push(text(titleX, nextY, t2.text, t2.size, { color: C.muted, weight: 700 }));
  }
  out.push(text(titleX, Math.max(nextY + 38, imgY + IMG - 4), `UPDATED ${formatMalaysiaDisplay(input.timestamp)}`, 17, { color: C.faint }));

  // ---------- Source / Region chips ----------
  const meta: Array<[string, string]> = [];
  if (item.dataSource) meta.push(['SOURCE', item.dataSource]);
  if (item.region) meta.push(['REGION', item.region]);
  let chipX = M;
  for (const [lab, val] of meta) {
    const v = fitText(val, 240, 24, 16);
    const w = Math.round(Math.max(estimateTextWidth(v.text, v.size), estimateTextWidth(lab, 13) + lab.length * 2) + 44);
    out.push(`<path d="M${chipX + 12},250 H${chipX + w} V${306} L${chipX + w - 12},318 H${chipX} V262 Z" fill="${C.bg2}" stroke="${C.grid}" stroke-width="2"/>`);
    out.push(text(chipX + 20, 276, lab, 13, { color: C.magenta, weight: 800, spacing: 2 }));
    out.push(text(chipX + 20, 304, v.text, v.size, { weight: 700 }));
    chipX += w + 16;
  }

  // ---------- Top-right stat panels ----------
  const stats: Array<{ lab: string; val: string; color: string; glow: string }> = [
    { lab: 'CURRENT VALUE', val: formatValue(sim.current), color: C.yellow, glow: 'yellow' },
  ];
  if (sim.baseline) stats.push({ lab: 'BASELINE VALUE', val: formatValue(sim.baseline), color: C.cyan, glow: 'cyan' });
  const pw = 330;
  const gap = 24;
  stats.forEach((s, i) => {
    const px = right - (stats.length - i) * pw - (stats.length - 1 - i) * gap;
    out.push(panel(px, 52, pw, 200, s.color));
    out.push(text(px + 30, 96, s.lab, 16, { color: C.muted, weight: 800, spacing: 3 }));
    const v = fitText(s.val, pw - 60, 92, 44);
    out.push(text(px + 28, 200, v.text, v.size, { color: s.color, weight: 900, italic: true, glow: s.glow }));
  });

  // ---------- Limit (24H) with an XP-style bar ----------
  if (sim.limit24h && item.limit24h) {
    out.push(tag(M, 360, 'LIMIT (24H)', C.magenta));
    const val = formatValue(sim.limit24h);
    const v = fitText(val, 760, 140, 60);
    out.push(text(M - 4, 520, v.text, v.size, { weight: 900, italic: true, color: C.text, glow: 'magenta' }));
    // progress bar showing where today's value sits in its range
    const barX = 860;
    const barW = right - barX;
    const barY = 450;
    const span = item.limit24h.max - item.limit24h.min;
    const frac = span > 0 ? (sim.limit24h.value - item.limit24h.min) / span : 1;
    const segs = 20;
    const segW = (barW - (segs - 1) * 6) / segs;
    for (let i = 0; i < segs; i++) {
      const on = (i + 0.5) / segs <= Math.max(0.05, frac);
      const sx = barX + i * (segW + 6);
      out.push(`<path d="M${(sx + 6).toFixed(1)},${barY} H${(sx + segW).toFixed(1)} L${(sx + segW - 6).toFixed(1)},${barY + 34} H${sx.toFixed(1)} Z" fill="${on ? 'url(#bar)' : C.grid}"${on ? ' filter="url(#glow-soft)"' : ''}/>`);
    }
    const dec = sim.limit24h.decimals;
    out.push(text(barX, barY + 66, `MIN ${formatNumber(item.limit24h.min, dec)}`, 16, { color: C.faint, weight: 700, spacing: 1.5 }));
    out.push(text(barX + barW, barY + 66, `MAX ${formatNumber(item.limit24h.max, dec)}`, 16, { color: C.faint, weight: 700, spacing: 1.5, anchor: 'end' }));
  }
  // neon divider
  out.push(`<rect x="${M}" y="574" width="${right - M}" height="3" fill="url(#divider)"/>`);

  // ---------- Bottom stat chips ----------
  const bottom: Array<{ lab: string; val: string; color: string; glow: string; ic: 'diamond' | 'bolt' | 'star' }> = [];
  if (sim.volume24h) bottom.push({ lab: 'VOLUME (24H)', val: formatValue(sim.volume24h), color: C.cyan, glow: 'cyan', ic: 'diamond' });
  if (sim.output24h) bottom.push({ lab: 'OUTPUT (24H)', val: formatValue(sim.output24h), color: C.magenta, glow: 'magenta', ic: 'bolt' });
  if (sim.eventCount24h) bottom.push({ lab: 'EVENT COUNT (24H)', val: formatValue(sim.eventCount24h), color: C.lime, glow: 'lime', ic: 'star' });
  if (bottom.length) {
    const n = Math.max(3, bottom.length);
    const bgap = 24;
    const bw = (right - M - bgap * (n - 1)) / n;
    bottom.forEach((b, i) => {
      const bx = Math.round(M + i * (bw + bgap));
      out.push(panel(bx, 604, Math.round(bw), 180, b.color, 18));
      out.push(icon(b.ic, bx + 40, 650, b.color));
      out.push(text(bx + 64, 657, fitText(b.lab, bw - 90, 16, 11).text, 16, { color: C.muted, weight: 800, spacing: 2.5 }));
      const v = fitText(b.val, bw - 60, 70, 32);
      out.push(text(bx + 28, 748, v.text, v.size, { weight: 900, italic: true, color: b.color, glow: b.glow }));
    });
  }

  // ---------- Footer disclosure ----------
  const sim1 = pill(right, 818, input.simulatedLabel.toUpperCase(), C.yellow);
  out.push(sim1.svg);
  if (input.demo) out.push(pill(right - sim1.width - 14, 818, 'DEMO CONFIGURATION', C.magenta).svg);
  out.push(text(M, 845, `${input.simulatedLabel.toUpperCase()} · For demonstration only. Values are generated within configured ranges and are not real measurements or forecasts.`, 15, { color: C.faint }));

  // ---------- Background: grid + scanlines + corner brackets ----------
  const bg: string[] = [];
  for (let gx = 0; gx <= DESIGN_WIDTH; gx += 64) bg.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${DESIGN_HEIGHT}" stroke="${C.grid}" stroke-opacity="0.35" stroke-width="1"/>`);
  for (let gy = 0; gy <= DESIGN_HEIGHT; gy += 64) bg.push(`<line x1="0" y1="${gy}" x2="${DESIGN_WIDTH}" y2="${gy}" stroke="${C.grid}" stroke-opacity="0.35" stroke-width="1"/>`);
  const br = (px: number, py: number, sx: number, sy: number) => `<path d="M${px},${py + sy * 40} V${py} H${px + sx * 40}" fill="none" stroke="${C.cyan}" stroke-opacity="0.7" stroke-width="3"/>`;
  bg.push(br(16, 16, 1, 1), br(DESIGN_WIDTH - 16, 16, -1, 1), br(16, DESIGN_HEIGHT - 16, 1, -1), br(DESIGN_WIDTH - 16, DESIGN_HEIGHT - 16, -1, -1));

  const glow = (id: string, color: string, dev: number) =>
    `<filter id="glow-${id}" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="${dev}" result="b"/><feFlood flood-color="${color}" flood-opacity="0.85"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

  const w = input.width ?? DESIGN_WIDTH;
  const h = input.height ?? DESIGN_HEIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}" font-family="${FONT_STACK}">
<defs>
  <radialGradient id="bgGlow" cx="0.75" cy="0.1" r="1.1">
    <stop offset="0" stop-color="#1A1050"/>
    <stop offset="0.55" stop-color="${C.bg2}"/>
    <stop offset="1" stop-color="${C.bg}"/>
  </radialGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3A0CA3"/>
    <stop offset="1" stop-color="#0077B6"/>
  </linearGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.magenta}"/>
    <stop offset="1" stop-color="${C.cyan}"/>
  </linearGradient>
  <linearGradient id="divider" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.cyan}" stop-opacity="0"/>
    <stop offset="0.5" stop-color="${C.cyan}"/>
    <stop offset="1" stop-color="${C.magenta}" stop-opacity="0"/>
  </linearGradient>
  <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#FFFFFF" fill-opacity="0.025"/></pattern>
  ${glow('soft', '#FFFFFF', 4)}
  ${glow('cyan', C.cyan, 7)}
  ${glow('yellow', C.yellow, 7)}
  ${glow('magenta', C.magenta, 8)}
  ${glow('lime', C.lime, 7)}
</defs>
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#bgGlow)"/>
${bg.join('\n')}
<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#scan)"/>
${out.join('\n')}
</svg>`;
}
