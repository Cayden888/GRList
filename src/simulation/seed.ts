/**
 * Seeds.
 *
 * - The *selection* seed depends only on the Malaysia date, because the item is
 *   not known yet when we choose it.
 * - The *item* seed combines the date and the item's stable id. It is stored in
 *   the database so a retry later the same day reproduces the exact same image.
 */
const VERSION = 'v1';

export function selectionSeed(malaysiaDate: string): string {
  return `dash-${VERSION}|select|${malaysiaDate}`;
}

export function itemSeed(malaysiaDate: string, itemId: string): string {
  return `dash-${VERSION}|${malaysiaDate}|${itemId}`;
}
