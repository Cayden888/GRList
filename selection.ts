/**
 * Chooses which dashboard row to show on a given Malaysia date.
 *
 *  random     – seeded random pick; the same date always gives the same row
 *               (as long as the set of valid rows has not changed).
 *  sequential – rotates through the rows one per day.
 *  fixed      – always the row whose id / Image_Name / Title_EN matches SELECTION_ITEM_ID.
 */
import type { SelectionStrategy } from '../config/env.js';
import type { DashboardItem } from '../data/types.js';
import { createRng } from '../utils/rng.js';
import { selectionSeed } from './seed.js';

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectionError';
  }
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function selectItem(
  items: readonly DashboardItem[],
  malaysiaDate: string,
  strategy: SelectionStrategy = 'random',
  fixedItemId?: string,
): DashboardItem {
  if (items.length === 0) throw new SelectionError('No valid dashboard rows to choose from.');
  // Sort by id so the pick does not depend on the row order in the sheet.
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (strategy === 'fixed') {
    const want = (fixedItemId ?? '').trim().toLowerCase();
    const found =
      items.find((i) => i.id.toLowerCase() === want) ??
      items.find((i) => (i.imageName ?? '').toLowerCase() === want) ??
      items.find((i) => (i.titleEn ?? '').toLowerCase() === want);
    if (!found) throw new SelectionError(`SELECTION_ITEM_ID "${fixedItemId}" does not match any valid row.`);
    return found;
  }
  if (strategy === 'sequential') {
    const n = sorted.length;
    return sorted[((dayNumber(malaysiaDate) % n) + n) % n]!;
  }
  return createRng(selectionSeed(malaysiaDate)).pick(sorted);
}

/** Finds an item by id (used when retrying a job that already chose its item). */
export function findItemById(items: readonly DashboardItem[], id: string): DashboardItem | undefined {
  return items.find((i) => i.id === id);
}
