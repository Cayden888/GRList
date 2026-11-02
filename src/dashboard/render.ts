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

/** For a Google Drive file, the other public addresses that serve the same picture. */
export function imageUrlCandidates(url: string): string[] {
  const id = /drive\.usercontent\.google\.com\/download\?id=([A-Za-z0-9_-]{10,})/.exec(url)?.[1];
  if (!id) return [url];
  return [url, `https://lh3.googleusercontent.com/d/${id}=w600`, `https://drive.google.com/thumbnail?id=${id}&sz=w600`];
}

async function downloadImage(url: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) {
    throw new Error(type.includes('html')
      ? 'Google sent a web page instead of the picture - the Drive file is probably not shared as "Anyone with the link"'
      : `not an image (${type || 'unknown type'})`);
  }
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_THUMB_BYTES) throw new Error('image too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_THUMB_BYTES) throw new Error('image too large');
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
  log.warn('Picture skipped', { url, reason: firstError?.message });
  return undefined;
}
