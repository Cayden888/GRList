/**
 * Values that can be used in the Telegram caption as {placeholders}.
 * They are the same (simulated) numbers that are drawn on the image.
 */
import type { DashboardItem } from '../data/types.js';
import type { SimulatedDashboard } from '../simulation/metrics.js';
import { formatDuration, formatNumber, formatSigned, formatValue } from './format.js';

export const CAPTION_PLACEHOLDERS = [
  'time', 'date', 'title', 'title_cn', 'source', 'region', 'play_url', 'updated_at',
  'current', 'baseline', 'difference', 'limit', 'volume', 'output', 'event_count', 'last_update',
  'limit_min', 'limit_max', 'limit_percent', 'gap_to_limit', 'rtp_shortfall', 'rtp_gap_amount', 'rtp_gap_amount_m',
] as const;

export function captionValues(item: DashboardItem, sim: SimulatedDashboard, date?: string): Record<string, string> {
  const v: Record<string, string> = {};
  const set = (k: string, s: string | undefined) => { if (s !== undefined && s !== '') v[k] = s; };
  set('date', date);
  set('title', item.titleEn ?? item.titleCn);
  set('title_cn', item.titleCn);
  set('source', item.dataSource);
  set('region', item.region);
  set('play_url', item.playUrl);
  set('updated_at', item.lastUpdated ?? item.timeSinceUpdateText);
  set('current', formatValue(sim.current));
  set('baseline', sim.baseline && formatValue(sim.baseline));
  set('difference', sim.difference && formatSigned(sim.difference));
  set('limit', sim.limit24h && formatValue(sim.limit24h));
  set('volume', sim.volume24h && formatValue(sim.volume24h));
  set('output', sim.output24h && formatValue(sim.output24h));
  set('event_count', sim.eventCount24h && formatValue(sim.eventCount24h));
  const ts = sim.timeSinceUpdate;
  set('last_update', ts.text ?? (ts.minutes !== undefined ? `${formatDuration(ts.minutes)} ago` : undefined));

  if (item.limit24h && sim.limit24h) {
    set('limit_min', formatNumber(item.limit24h.min, 0));
    set('limit_max', formatNumber(item.limit24h.max, 0));
    const gap = Math.max(0, item.limit24h.max - sim.limit24h.value);
    set('gap_to_limit', formatNumber(gap, 0));
    const pct = item.limit24h.max > 0 ? Math.round((sim.limit24h.value / item.limit24h.max) * 100) : 0;
    set('limit_percent', String(pct));
  }

  if (sim.baseline) {
    const shortfall = sim.baseline.value - sim.current.value;
    if (shortfall > 0) {
      set('rtp_shortfall', formatNumber(shortfall, Math.max(sim.baseline.decimals, sim.current.decimals)));
      if (sim.volume24h) {
        const gapAmount = sim.volume24h.value * (shortfall / 100);
        set('rtp_gap_amount', formatNumber(gapAmount, 0));
        set('rtp_gap_amount_m', `${formatNumber(gapAmount / 1_000_000, 2)}M`);
      }
    } else {
      set('rtp_shortfall', '0.00');
      if (sim.volume24h) {
        set('rtp_gap_amount', '0');
        set('rtp_gap_amount_m', '0.00M');
      }
    }
  }
  return v;
}
