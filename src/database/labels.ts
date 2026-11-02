/**
 * Reads the card titles from the Supabase "dashboard_labels" table.
 * Anything missing or blank keeps the title from settings (LABEL_*) or the default.
 * A failure never stops the post: it is logged and the existing titles are used.
 */
import { createClient } from '@supabase/supabase-js';
import type { AppConfig, DashboardLabels } from '../config/env.js';
import { hasDatabase } from '../config/env.js';
import { log } from '../utils/logger.js';

const KEY_MAP: Record<string, keyof DashboardLabels> = {
  current_value: 'current',
  baseline_value: 'baseline',
  limit_24h: 'limit',
  volume_24h: 'volume',
  output_24h: 'output',
  event_count_24h: 'eventCount',
};

/** Pure merge, exported for tests. */
export function applyLabelRows(base: DashboardLabels, rows: Array<{ key: string; label: string | null }>): DashboardLabels {
  const out = { ...base };
  for (const r of rows) {
    const field = KEY_MAP[r.key?.trim().toLowerCase()];
    const text = (r.label ?? '').replace(/\s+/g, ' ').trim();
    if (field && text) out[field] = text.slice(0, 40);
  }
  return out;
}

export async function loadLabels(config: AppConfig): Promise<DashboardLabels> {
  const base = config.dashboard.labels;
  if (!hasDatabase(config)) return base;
  try {
    const db = createClient(config.supabase.url!, config.supabase.serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) }) },
    });
    const { data, error } = await db.from('dashboard_labels').select('key,label');
    if (error) {
      const hint = /does not exist|Could not find the table/i.test(error.message) ? ' – run supabase/migrations/20261102000000_dashboard_labels.sql in the Supabase SQL editor' : '';
      log.warn(`Card titles not read from Supabase: ${error.message}${hint}`);
      return base;
    }
    return applyLabelRows(base, (data ?? []) as Array<{ key: string; label: string | null }>);
  } catch (e) {
    log.warn(`Card titles not read from Supabase: ${(e as Error).message}`);
    return base;
  }
}
