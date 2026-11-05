/** Read the frequency configured in Supabase Table Editor. */
import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config/env.js';
import { log } from '../utils/logger.js';

export async function loadPostsPerWeek(config: AppConfig): Promise<number> {
  // Backwards compatible if a database isn't configured (scheduler still requires one).
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return 7;
  const db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await db.from('dashboard_schedule_settings')
    .select('posts_per_week').eq('id', 1).single();
  if (error) {
    // Keep existing installs working before the migration is applied.
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(error.message)) {
      log.warn('Weekly frequency table not installed yet; defaulting to daily (7/week). Run supabase/migrations/20261105000000_weekly_frequency.sql');
      return 7;
    }
    // Do NOT silently send daily if configuration could not be read.
    throw new Error(`Could not read weekly posting frequency: ${error.message}`);
  }
  const count = data?.posts_per_week;
  if (!Number.isInteger(count) || count < 0 || count > 7) throw new Error('Invalid posts_per_week in Supabase: expected 0 to 7');
  return count;
}
