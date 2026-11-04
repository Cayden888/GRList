/**
 * Portrait dashboard (1080×1440), inspired by the approved cyan-and-gold reference.
 * All numeric values come from the existing sheet/simulation pipeline.
 * The chart is illustrative: the original normalized simulated trend is scaled
 * to the selected limit's configured range and ends at its generated value.
 */
import { readFileSync } from 'node:fs';
import type { RenderInput } from './svg-clean.js';
import { FONT_STACK } from './svg-clean.js';
import { escapeXml as esc, fitText, formatValue, formatNumber, formatDuration } from './format.js';
import { formatMalaysiaDisplay } from '../utils/time.js';

const WIDTH = 1080;
const HEIGHT = 1440;
const CYAN = '#03DDFF';
const GOLD = '#FFCE23';
const WHITE = '#F7FAFF';
const MUTED = '#B8CBE0';
const BLUE = '#0060BD';
const logo = `data:image/png;base64,${readFileSync(new URL('./assets/extra-bonus-logo.png', import.meta.url)).toString('base64')}`;

function label(txt: string, x: number, y: number, size = 22, color = WHITE, weight = 600, extra = ''): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${esc(txt)}</text>`;
}
function box(x: number, y: number, w: number, h: number, r = 25): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#panel)" stroke="${CYAN}" stroke-opacity="0.9" stroke-width="2.4" filter="url(#panelShadow)"/>`;
}
function fitted(s: string, x: number, y: number, w: number, font: number, min: number, color = WHITE, weight = 700): string {
  const f = fitText(s, w, font, min);
  return label(f.text, x, y, f.size, color, weight);
}
function val(v?: { value: number; decimals: number }): string {
  return v ? formatValue(v) : '—';
}
function compact(v?: { value: number; decimals: number }): string { return val(v); }
function rounded(n: number): string { return formatNumber(Math.round(n), 0); }

export function buildPortraitSvg(input: RenderInput): string {
  const { item, sim } = input;
  const width = input.width ?? WIDTH;
  const height = input.height ?? HEIGHT;
  const primary = item.titleEn ?? item.titleCn ?? 'Analytics Dashboard';
  const source = item.dataSource;
  const region = item.region ?? 'Malaysia';
  const mainLimit = sim.limit24h;
  const limitRange = item.limit24h;
  const mainVal = mainLimit?.value ?? sim.current.value;
  const range = limitRange ?? item.current;
  const min = range.min;
  const max = range.max;
  // Position within the configured range, not a financial / payout rate.
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, mainVal / max));
  const pct = Math.round(ratio * 100);
  const num = mainLimit ? val(mainLimit) : val(sim.current);
  const last = sim.timeSinceUpdate.text ?? (sim.timeSinceUpdate.minutes === undefined ? 'Not available' : `${formatDuration(sim.timeSinceUpdate.minutes)} ago`);
  const formattedTime = formatMalaysiaDisplay(input.timestamp);
  const hasLimit = Boolean(mainLimit && limitRange);

  const origLo = item.current.min;
  const origSpan = item.current.max - origLo;
  const points = sim.trend.map((p) => {
    const norm = origSpan === 0 ? 0.5 : Math.max(0, Math.min(1, (p.value - origLo) / origSpan));
    return hasLimit ? min + norm * (max - min) : p.value;
  });
  if (points.length) points[points.length - 1] = mainVal;
  const trendMin = hasLimit ? min : item.current.min;
  const trendMax = hasLimit ? max : item.current.max;
  const span = Math.max(1, trendMax - trendMin);
  const gx = 114, gy = 886, gw = 875, gh = 212;
  const coords = points.map((v, i) => ({
    x: gx + (i / Math.max(1, points.length - 1)) * gw,
    y: gy + (1 - (v - trendMin) / span) * gh,
  }));
  let d = '';
  coords.forEach((p, i) => {
    if (!i) { d = `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`; return; }
    const prev = coords[i - 1]!;
    const middleX = (prev.x + p.x) / 2;
    d += ` C ${middleX.toFixed(1)} ${prev.y.toFixed(1)}, ${middleX.toFixed(1)} ${p.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  });
  const area = coords.length ? `${d} L ${gx + gw} ${gy + gh} L ${gx} ${gy + gh} Z` : '';
  const currentPoint = coords[coords.length - 1];
  const statHigh = sim.trend.length ? Math.max(...sim.trend.map(p => p.value)) : sim.current.value;
  const statLow = sim.trend.length ? Math.min(...sim.trend.map(p => p.value)) : sim.current.value;

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT_STACK}">`);
  o.push(`<defs>
    <linearGradient id="back" x2="1" y2="1"><stop stop-color="#061B35"/><stop offset="0.51" stop-color="#001125"/><stop offset="1" stop-color="#002448"/></linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#084477" stop-opacity="0.74"/><stop offset="0.35" stop-color="#00203B" stop-opacity="0.96"/><stop offset="1" stop-color="#042C52" stop-opacity="0.96"/></linearGradient>
    <linearGradient id="gold" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#FFEF91"/><stop offset="0.21" stop-color="#FFF5B3"/><stop offset="0.49" stop-color="#FFC729"/><stop offset="0.77" stop-color="#F5A700"/><stop offset="1" stop-color="#FFE04A"/></linearGradient>
    <linearGradient id="bar" x1="0" x2="1"><stop stop-color="#FFB500"/><stop offset="0.48" stop-color="#FFF16A"/><stop offset="1" stop-color="#FFC900"/></linearGradient>
    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#03DFFE" stop-opacity="0.61"/><stop offset="0.5" stop-color="#086EC7" stop-opacity="0.46"/><stop offset="1" stop-color="#002E5D" stop-opacity="0.02"/></linearGradient>
    <filter id="panelShadow" x="-12%" y="-28%" width="124%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="5" result="shadow"/><feFlood flood-color="#04C5FF" flood-opacity="0.15"/><feComposite in2="shadow" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="softGold" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="3.4"/></filter>
    <filter id="softBlue" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="7"/></filter>
    <clipPath id="photoClip"><rect x="42" y="125" width="136" height="132" rx="23"/></clipPath>
    <clipPath id="barClip"><rect x="72" y="455" width="790" height="30" rx="15"/></clipPath>
  </defs>`);
  o.push(`<rect width="1080" height="1440" fill="url(#back)"/>`);
  // Flowing blue + gold structural accents around header and footer.
  o.push(`<path d="M 505 104 Q 660 108 728 84 L 802 0" fill="none" stroke="#018CEF" stroke-width="27" opacity=".25"/>`);
  o.push(`<path d="M 514 104 Q 656 108 730 81 L 799 0" fill="none" stroke="#00CFFF" stroke-width="2"/>`);
  o.push(`<path d="M 748 105 Q 796 42 852 0" fill="none" stroke="#FFE05A" stroke-width="9" opacity="0.9"/>`);
  o.push(`<path d="M 0 1430 Q 182 1405 370 1468 Q 600 1530 845 1461 Q 950 1435 1080 1414" fill="none" stroke="#1479F5" stroke-width="3" opacity=".75"/>`);
  o.push(`<path d="M 0 1420 Q 155 1390 330 1442" fill="none" stroke="url(#gold)" stroke-width="14" opacity=".9"/>`);
  // Header with the user's actual brand image; no duplicated EXTRA BONUS heading.
  o.push(`<image href="${logo}" x="26" y="6" width="128" height="104" preserveAspectRatio="xMidYMid meet"/>`);
  o.push(`<line x1="176" y1="27" x2="176" y2="83" stroke="#E9BD4D" stroke-width="2"/>`);
  o.push(label('GAME ANALYTICS', 208, 62, 29, WHITE, 800));
  o.push(`<rect x="836" y="29" width="211" height="46" rx="23" fill="#001328" stroke="#A8DDFC" stroke-width="1.7"/>`);
  o.push(label('INTERNAL USE ONLY', 860, 58, 18, WHITE, 700));
  o.push(`<line x1="0" x2="1080" y1="109" y2="109" stroke="#00CDFF" stroke-opacity=".7"/>`);

  // Item identity and genuine row metadata.
  if (input.thumbnailDataUri) {
    o.push(`<image href="${esc(input.thumbnailDataUri)}" x="42" y="125" width="136" height="132" clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    const letter = [...primary.trim()][0]?.toUpperCase() ?? 'D';
    o.push(`<rect x="42" y="125" width="136" height="132" rx="23" fill="url(#panel)" stroke="#20CFFF" stroke-width="2"/>`);
    o.push(label(letter, 110, 218, 79, GOLD, 800, 'text-anchor="middle"'));
  }
  o.push(fitted(primary, 203, 187, 580, 51, 29));
  o.push(fitted(`${source ? `SOURCE: ${source}   |   ` : ''}REGION: ${region}`, 203, 226, 600, 21, 16, MUTED, 400));
  o.push(fitted(`${input.labels?.current ?? 'CURRENT VALUE'}: ${val(sim.current)}${item.titleCn ? `   |   ${item.titleCn}` : ''}`, 203, 253, 580, 18, 14, MUTED, 500));
  o.push(`<rect x="808" y="150" width="234" height="55" rx="27" fill="#082F29" stroke="#60F585" stroke-width="2"/>`);
  o.push(label('SIMULATED DATA', 832, 184, 21, '#82FFB0', 700));

  // Main hero card. Limit is sourced from the sheet if supplied.
  o.push(box(25, 279, 1030, 233, 28));
  o.push(`<path d="M83 303 l22 11 -22 11 -22 -11 z M62 326 l21 11 21 -11" fill="none" stroke="${GOLD}" stroke-width="6" stroke-linejoin="round"/>`);
  o.push(label(hasLimit ? (input.labels?.limit ?? 'LIMIT (24H)') : (input.labels?.current ?? 'CURRENT VALUE'), 142, 335, 28, WHITE, 800));
  o.push(fitted(num, 74, 417, 505, 82, 46, "url(#gold)", 850));
  o.push(`<rect x="70" y="371" width="520" height="75" fill="none"/>`);
  o.push(`<line x1="645" y1="336" x2="645" y2="425" stroke="#DDEEFF" stroke-width="1.8"/>`);
  o.push(label(hasLimit ? 'LIMIT RANGE' : 'VALUE RANGE', 694, 363, 22, MUTED, 600));
  o.push(fitted(`${rounded(min)} – ${rounded(max)}`, 694, 402, 332, 30, 22));
  o.push(`<rect x="70" y="456" width="792" height="28" rx="14" fill="#053058" stroke="#087DCF" stroke-width="2"/>`);
  o.push(`<g clip-path="url(#barClip)"><rect x="70" y="456" width="${Math.max(0, 792 * ratio)}" height="28" fill="url(#bar)"/><rect x="77" y="458" width="${Math.max(0, 780 * ratio)}" height="5" rx="2" fill="#FFF8BE" opacity="0.6"/></g>`);
  o.push(`<rect x="888" y="447" width="141" height="46" rx="23" fill="#281D00" stroke="#FFE13A" stroke-width="2"/>`);
  o.push(label(`${pct}%`, 960, 478, 29, "url(#gold)", 800, 'text-anchor="middle"'));

  // Compact reading strip; preserves baseline / current inputs and uses the simulated trend's high/low.
  o.push(box(26, 529, 1028, 122, 23));
  o.push(`<line x1="379" y1="550" x2="379" y2="631" stroke="#01BFE9" stroke-width="1.8"/>`);
  o.push(`<line x1="723" y1="550" x2="723" y2="631" stroke="#01BFE9" stroke-width="1.8"/>`);
  if (sim.baseline) {
    o.push(label(input.labels?.baseline ?? 'BASELINE VALUE', 67, 570, 21, WHITE, 650));
    o.push(label(val(sim.baseline), 143, 625, 42, WHITE, 800));
  }
  o.push(label('24H HIGH', 430, 570, 22, '#66FA96', 700));
  o.push(label(formatNumber(statHigh, 2), 498, 625, 41, '#63F58C', 850));
  o.push(label('24H LOW', 766, 570, 22, '#FF5C73', 700));
  o.push(label(formatNumber(statLow, 2), 828, 625, 41, '#FF526A', 850));
  // Four cards. Only show values that actually exist in the configured sheet.
  const metrics = [
    ...(sim.volume24h ? [{ title: input.labels?.volume ?? 'VOLUME (24H)', value: compact(sim.volume24h), ico: '●' }] : []),
    ...(sim.output24h ? [{ title: input.labels?.output ?? 'OUTPUT (24H)', value: compact(sim.output24h), ico: '●' }] : []),
    ...(sim.eventCount24h ? [{ title: input.labels?.eventCount ?? 'EVENT COUNT (24H)', value: compact(sim.eventCount24h), ico: '●' }] : []),
    { title: 'LAST UPDATE', value: last, ico: '●' },
  ];
  metrics.forEach((m, i) => {
    const w = (1028 - (metrics.length - 1) * 16) / metrics.length;
    const x = 26 + i * (w + 16);
    o.push(box(x, 669, w, 118, 22));
    o.push(`<circle cx="${x + 38}" cy="699" r="9" fill="none" stroke="${CYAN}" stroke-width="4"/>`);
    o.push(fitted(m.title, x + 67, 706, w - 80, 18, 12, WHITE, 650));
    o.push(fitted(m.value, x + 30, 758, w - 50, 33, 19, i === 2 ? GOLD : WHITE, 800));
  });

  o.push(box(26, 808, 1028, 368, 27));
  o.push(`<path d="M68 851 v-10 h7 v10 M81 851 v-22 h7 v22 M94 851 v-16 h7 v16" stroke="${CYAN}" stroke-width="5"/>`);
  o.push(label(hasLimit ? 'LIMIT TREND (24H)' : 'CURRENT TREND (24H)', 112, 854, 26, WHITE, 800));
  o.push(`<line x1="730" x2="774" y1="841" y2="841" stroke="${GOLD}" stroke-dasharray="10 7" stroke-width="4"/>`);
  o.push(label('Range', 787, 847, 18, WHITE, 500));
  o.push(`<circle cx="879" cy="840" r="8" fill="${CYAN}"/>`);
  o.push(label('Generated', 897, 847, 17, WHITE, 500));
  [0, 1, 2, 3].forEach(i => {
    const yy = gy + i * (gh / 3);
    o.push(`<line x1="${gx}" x2="${gx + gw}" y1="${yy}" y2="${yy}" stroke="#23618E" stroke-opacity=".58"/>`);
    o.push(label(`${rounded(trendMax - i * span / 3)}`, 95, yy + 6, 17, MUTED, 500, 'text-anchor="end"'));
  });
  for (let i = 0; i <= 8; i++) {
    const xx = gx + i * gw / 8;
    o.push(`<line x1="${xx}" x2="${xx}" y1="${gy}" y2="${gy + gh}" stroke="#194F80" stroke-opacity=".5"/>`);
    if (i % 2 === 0) o.push(label(`${String(i * 3).padStart(2, '0')}:00`, xx, 1140, 18, WHITE, 500, 'text-anchor="middle"'));
  }
  // The top and bottom dashed lines show the range; the area is not an observed historical time series.
  o.push(`<line x1="${gx}" x2="${gx + gw}" y1="${gy + 4}" y2="${gy + 4}" stroke="${GOLD}" stroke-dasharray="11 8" stroke-opacity=".9" stroke-width="2.8"/>`);
  if (area) o.push(`<path d="${area}" fill="url(#chartFill)"/>`);
  if (d) o.push(`<path d="${d}" fill="none" stroke="${CYAN}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (currentPoint) {
    o.push(`<circle cx="${currentPoint.x}" cy="${currentPoint.y}" r="8" fill="#A5F7FF" stroke="${CYAN}" stroke-width="4"/>`);
    o.push(`<rect x="${currentPoint.x - 108}" y="${Math.max(870, currentPoint.y - 54)}" width="108" height="35" rx="13" fill="${CYAN}"/>`);
    o.push(label(rounded(mainVal), currentPoint.x - 54, Math.max(894, currentPoint.y - 31), 20, '#001328', 850, 'text-anchor="middle"'));
  }

  // The footer card is a range position summary (not a percent of maximum, nor RTP).
  o.push(box(27, 1199, 1027, 120, 25));
  o.push(`<path d="M76 1229 l23 13 -23 13 -23 -13z M53 1259 l23 13 23 -13 M53 1276 l23 13 23 -13" fill="none" stroke="${GOLD}" stroke-width="7" stroke-linejoin="round"/>`);
  o.push(label('DATA', 144, 1248, 25, WHITE, 800));
  o.push(label('SUMMARY (24H)', 144, 1282, 22, WHITE, 800));
  o.push(`<line x1="398" x2="398" y1="1220" y2="1294" stroke="#DDEEFF" stroke-width="1.7"/>`);
  o.push(label(hasLimit ? 'CURRENT / RANGE MAX' : 'CURRENT / MAX', 432, 1244, 20, WHITE, 500));
  o.push(fitted(`${num} / ${rounded(max)}`, 431, 1289, 361, 36, 25, WHITE, 800));
  o.push(`<rect x="816" y="1207" width="227" height="105" rx="26" fill="#4B3200" stroke="${GOLD}" stroke-width="3.5"/>`);
  o.push(label(`${pct}%`, 927, 1270, 54, "url(#gold)", 850, 'text-anchor="middle"'));
  o.push(label('OF RANGE', 928, 1296, 20, WHITE, 700, 'text-anchor="middle"'));

  // Honest generated-data disclosure with exact generation timestamp.
  o.push(label(input.demo ? 'DEMO CONFIGURATION  •  SIMULATED DATA' : 'SIMULATED DATA  •  INTERNAL DEMONSTRATION', 30, 1352, 19, '#C7D8EB', 700));
  o.push(fitted(`Generated ${formattedTime}`, 30, 1380, 1000, 18, 15, MUTED, 500));
  o.push(label('Illustrative values and chart; not real measurements or forecasts.', 30, 1405, 17, MUTED, 400));
  o.push('</svg>');
  return o.join('');
}
