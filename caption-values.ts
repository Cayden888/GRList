/**
 * Values that can be used in the Telegram caption as {placeholders}.
 * They are the same (simulated) numbers that are drawn on the image.
 */
import type { DashboardItem } from '../data/types.js';
import type { SimulatedDashboard } from '../simulation/metrics.js';
import { formatDuration, formatSigned, formatValue } from './format.js';

export const CAPTION_PLACEHOLDERS = [
  'time', 'date', 'title', 'title_cn', 'source', 'region',
  'current', 'baseline', 'difference', 'limit', 'volume', 'output', 'event_count', 'last_update',
] as const;

export function captionValues(item: DashboardItem, sim: SimulatedDashboard, date?: string): Record<string, string> {
  const v: Record<string, string> = {};
  const set = (k: string, s: string | undefined) => { if (s !== undefined && s !== '') v[k] = s; };
  set('date', date);
  set('title', item.titleEn ?? item.titleCn);
  set('title_cn', item.titleCn);
  set('source', item.dataSource);
  set('region', item.region);
  set('current', formatValue(sim.current));
  set('baseline', sim.baseline && formatValue(sim.baseline));
  set('difference', sim.difference && formatSigned(sim.difference));
  set('limit', sim.limit24h && formatValue(sim.limit24h));
  set('volume', sim.volume24h && formatValue(sim.volume24h));
  set('output', sim.output24h && formatValue(sim.output24h));
  set('event_count', sim.eventCount24h && formatValue(sim.eventCount24h));
  const ts = sim.timeSinceUpdate;
  set('last_update', ts.text ?? (ts.minutes !== undefined ? `${formatDuration(ts.minutes)} ago` : undefined));
  return v;
}
