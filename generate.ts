/**
 * The full "make today's image" pipeline:
 * pick the row → seeded simulation → SVG → PNG on disk.
 */
import path from 'node:path';
import type { AppConfig } from '../config/env.js';
import type { DashboardItem } from '../data/types.js';
import { simulateDashboard, type SimulatedDashboard } from '../simulation/metrics.js';
import { itemSeed } from '../simulation/seed.js';
import { findItemById, selectItem } from '../simulation/selection.js';
import { log } from '../utils/logger.js';
import { loadLabels } from '../database/labels.js';
import { fetchThumbnail, renderPng } from './render.js';
import { buildDashboardSvg } from './svg.js';

export interface GenerateOptions {
  malaysiaDate: string;
  items: DashboardItem[];
  /** Item already chosen for this day (retries reuse it). */
  itemId?: string;
  /** Seed already stored for this day (retries reuse it). */
  seed?: string;
  /** Time printed on the image. */
  timestamp: Date;
  demo?: boolean;
  /** Extra text for the file name, e.g. "-preview". */
  fileTag?: string;
  /** Skip downloading thumbnails (tests). */
  skipThumbnail?: boolean;
}

export interface GeneratedDashboard {
  item: DashboardItem;
  sim: SimulatedDashboard;
  seed: string;
  svg: string;
  pngPath: string;
  bytes: number;
}

export function chooseItem(config: AppConfig, items: DashboardItem[], date: string, preferredId?: string): DashboardItem {
  if (preferredId) {
    const found = findItemById(items, preferredId);
    if (found) return found;
    log.warn(`Item "${preferredId}" chosen earlier today is no longer a valid sheet row; choosing again`);
  }
  return selectItem(items, date, config.selection.strategy, config.selection.fixedItemId);
}

export async function generateDashboard(config: AppConfig, opts: GenerateOptions): Promise<GeneratedDashboard> {
  const item = chooseItem(config, opts.items, opts.malaysiaDate, opts.itemId);
  const seed = opts.seed && opts.itemId === item.id ? opts.seed : itemSeed(opts.malaysiaDate, item.id);

  const sim = simulateDashboard(item, seed, {
    currentValueSource: config.currentValueSource,
    timeSinceUpdateMinMinutes: config.simulation.timeSinceUpdateMinMinutes,
    timeSinceUpdateMaxMinutes: config.simulation.timeSinceUpdateMaxMinutes,
  });

  const [thumbnailDataUri, labels] = await Promise.all([
    item.imageUrl && !opts.skipThumbnail ? fetchThumbnail(item.imageUrl) : Promise.resolve(undefined),
    loadLabels(config),
  ]);

  const svg = buildDashboardSvg({
    item,
    sim,
    timestamp: opts.timestamp,
    simulatedLabel: config.dashboard.simulatedLabel,
    theme: config.dashboard.theme,
    demo: opts.demo,
    thumbnailDataUri,
    labels,
    width: config.dashboard.width,
    height: config.dashboard.height,
  });

  const safeId = item.id.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60);
  const fileName = `dashboard-${opts.malaysiaDate}-${safeId}${opts.fileTag ?? ''}.png`;
  const { path: pngPath, bytes } = await renderPng(svg, path.resolve(config.dashboard.outputDir, fileName));
  log.info('Dashboard image rendered', { file: path.relative(process.cwd(), pngPath), item: item.id, bytes });
  return { item, sim, seed, svg, pngPath, bytes };
}
