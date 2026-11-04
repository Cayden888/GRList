/** SVG → PNG with Sharp, plus the optional thumbnail download. */
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { log } from '../utils/logger.js';

export async function renderPng(svg: string, outPath: string): Promise<{ path: string; bytes: number }> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg, 'utf8'), { density: 72 }).png({ compressionLevel: 9 }).toFile(outPath);
  const s = await stat(outPath);
  if (s.size < 1000) throw new Error(`Rendered PNG looks broken (${s.size} bytes)`);
  return { path: outPath, bytes: s.size };
}

const MAX_THUMB_BYTES = 5 * 1024 * 1024;

/**
 * Public picture URLs, including common Google Drive share/thumbnail variants.
 * Try image endpoints before Drive's download page (which sometimes returns HTML).
 */
export function imageUrlCandidates(url: string): string[] {
  let id: string | undefined;
  try {
    const u = new URL(url);
    if (/(^|\.)drive\.google\.com$|^drive\.usercontent\.google\.com$|^lh3\.googleusercontent\.com$/.test(u.hostname)) {
      id = /\/(?:file\/d|d)\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1]
        ?? /\/thumbnail\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1]
        ?? u.searchParams.get('id') ?? undefined;
    }
  } catch { /* Invalid links are reported in fetchThumbnail. */ }
  if (!id) return [url];
  return [...new Set([
    `https://drive.google.com/thumbnail?id=${id}&sz=w600`,
    `https://lh3.googleusercontent.com/d/${id}=w600`,
    `https://drive.usercontent.google.com/download?id=${id}&export=view`,
    `https://drive.google.com/uc?export=download&id=${id}`,
    url,
  ])];
}

async function downloadImage(url: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { 'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('text/html')) throw new Error('Link returned an HTML page rather than a public image');
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_THUMB_BYTES) throw new Error('image too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_THUMB_BYTES) throw new Error('image too large');
  // A valid image sometimes comes back as octet-stream; inspect its bytes.
  const metadata = await sharp(buf).metadata().catch(() => undefined);
  if (!metadata || !['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'].includes(metadata.format ?? '')) {
    throw new Error(`Response isn't an image (${type || 'unknown type'})`);
  }
  return buf;
}

/**
 * Downloads the row's picture and returns a small PNG data URI.
 * Google Drive links are tried through a few public addresses.
 * Any failure just means "no picture" - it never stops the dashboard.
 */
export async function fetchThumbnail(url: string, timeoutMs = 8000): Promise<string | undefined> {
  let firstError: Error | undefined;
  for (const candidate of imageUrlCandidates(url)) {
    try {
      const buf = await downloadImage(candidate, timeoutMs);
      const png = await sharp(buf).resize(300, 300, { fit: 'cover' }).png().toBuffer();
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch (e) {
      firstError ??= e as Error;
    }
  }
  log.warn('Picture skipped: check the row Image_Link/Link column and image sharing permissions', { url, reason: firstError?.message, tried: imageUrlCandidates(url).length });
  return undefined;
}
