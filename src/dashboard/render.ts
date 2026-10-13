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
 * Downloads Image_Name when it is an image URL and returns a small PNG data URI.
 * Any failure just means "no thumbnail" – it never stops the dashboard.
 */
export async function fetchThumbnail(url: string, timeoutMs = 8000): Promise<string | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown type'})`);
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_THUMB_BYTES) throw new Error('image too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_THUMB_BYTES) throw new Error('image too large');
    const png = await sharp(buf).resize(300, 300, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (e) {
    log.warn('Thumbnail skipped', { url, reason: (e as Error).message });
    return undefined;
  }
}
