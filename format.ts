/** Number and text formatting for the image. Never returns "NaN" or "undefined". */
import type { SimulatedValue } from '../simulation/metrics.js';

export function formatNumber(n: number, decimals: number): string {
  if (!Number.isFinite(n)) throw new Error('Refusing to format a non-finite number');
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatValue(v: SimulatedValue): string {
  return formatNumber(v.value, v.decimals);
}

/** "+2.58", "−1.20" (true minus sign), "0.00". */
export function formatSigned(v: SimulatedValue): string {
  const abs = formatNumber(Math.abs(v.value), v.decimals);
  if (Number(abs.replace(/,/g, '')) === 0) return abs;
  return v.value > 0 ? `+${abs}` : `−${abs}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that are invalid in XML.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Rough rendered width: CJK/full-width ≈ 1em, digits/latin ≈ 0.56em. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x2e80) units += 1.0;
    else if (/[A-Z0-9MW@%#]/.test(ch)) units += 0.64;
    else if (ch === ' ') units += 0.28;
    else if (/[il.,:;'|!]/.test(ch)) units += 0.3;
    else units += 0.54;
  }
  return units * fontSize;
}

/** Shrinks the font (down to minSize) and then truncates with "…" so text fits maxWidth. */
export function fitText(text: string, maxWidth: number, fontSize: number, minSize: number): { text: string; size: number } {
  let size = fontSize;
  while (size > minSize && estimateTextWidth(text, size) > maxWidth) size -= 1;
  if (estimateTextWidth(text, size) <= maxWidth) return { text, size };
  const chars = [...text];
  while (chars.length > 1 && estimateTextWidth(chars.join('') + '…', size) > maxWidth) chars.pop();
  return { text: chars.join('').trimEnd() + '…', size };
}
