/**
 * Supabase implementation. All state changes go through the SQL functions in
 * supabase/migrations, which are single atomic statements – that is what stops
 * two workers from posting the same day twice.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FinishStatus, HistoryEntry, ResolveAction, ScheduleRepository, ScheduleRow } from './repository.js';

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class SupabaseScheduleRepository implements ScheduleRepository {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { 'x-client-info': 'telegram-dashboard-worker' },
        // Never wait forever: give up on any database request after 20 seconds.
        fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
      },
    });
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<ScheduleRow[]> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) {
      if (/abort|timeout|fetch failed|ENOTFOUND/i.test(error.message)) {
        throw new DatabaseError(`Could not reach Supabase (${error.message}). Check SUPABASE_URL is the Project URL like https://abcd1234.supabase.co`);
      }
      const hint = /function .* does not exist|Could not find the function/i.test(error.message)
        ? ' – did you run supabase/migrations/20261009000000_init.sql in the Supabase SQL editor?'
        : '';
      throw new DatabaseError(`Supabase ${fn} failed: ${error.message}${hint}`);
    }
    return (data ?? []) as ScheduleRow[];
  }

  async getByDate(malaysiaDate: string): Promise<ScheduleRow | null> {
    const { data, error } = await this.db.from('daily_schedule').select('*').eq('malaysia_date', malaysiaDate).maybeSingle();
    if (error) throw new DatabaseError(`Supabase read failed: ${error.message}`);
    return (data as ScheduleRow | null) ?? null;
  }

  async ensureDaily(malaysiaDate: string, scheduledAt: Date, status: 'pending' | 'missed' = 'pending', note?: string): Promise<ScheduleRow> {
    const rows = await this.rpc('ensure_daily_schedule', {
      p_date: malaysiaDate,
      p_scheduled_at: scheduledAt.toISOString(),
      p_status: status,
      p_note: note ?? null,
    });
    if (!rows[0]) throw new DatabaseError('ensure_daily_schedule returned no row');
    return rows[0];
  }

  recoverStale(): Promise<ScheduleRow[]> {
    return this.rpc('recover_stale_jobs', {});
  }

  async claim(id: string, workerId: string, leaseSeconds: number, maxAttempts: number): Promise<ScheduleRow | null> {
    const rows = await this.rpc('claim_daily_job', { p_id: id, p_worker: workerId, p_lease_seconds: leaseSeconds, p_max_attempts: maxAttempts });
    return rows[0] ?? null;
  }

  async markSendStarted(id: string, workerId: string, itemId: string, seed: string): Promise<boolean> {
    return (await this.rpc('mark_send_started', { p_id: id, p_worker: workerId, p_item: itemId, p_seed: seed })).length === 1;
  }

  async complete(id: string, workerId: string, telegramMessageId: number): Promise<boolean> {
    return (await this.rpc('complete_daily_job', { p_id: id, p_worker: workerId, p_message_id: telegramMessageId })).length === 1;
  }

  async finish(id: string, workerId: string, status: FinishStatus, error: string, nextAttemptAt?: Date | null, itemId?: string | null, seed?: string | null): Promise<boolean> {
    const rows = await this.rpc('finish_daily_job', {
      p_id: id,
      p_worker: workerId,
      p_status: status,
      p_error: error,
      p_next_attempt_at: nextAttemptAt ? nextAttemptAt.toISOString() : null,
      p_item: itemId ?? null,
      p_seed: seed ?? null,
    });
    return rows.length === 1;
  }

  async resolve(malaysiaDate: string, action: ResolveAction, telegramMessageId?: number | null): Promise<ScheduleRow | null> {
    const rows = await this.rpc('resolve_daily_job', { p_date: malaysiaDate, p_action: action, p_message_id: telegramMessageId ?? null });
    return rows[0] ?? null;
  }

  async listRecent(limit: number): Promise<ScheduleRow[]> {
    const { data, error } = await this.db.from('daily_schedule').select('*').order('malaysia_date', { ascending: false }).limit(limit);
    if (error) throw new DatabaseError(`Supabase read failed: ${error.message}`);
    return (data ?? []) as ScheduleRow[];
  }

  async recordHistory(entry: HistoryEntry): Promise<void> {
    const { error } = await this.db.from('dashboard_history').insert(entry);
    if (error) throw new DatabaseError(`Supabase history insert failed: ${error.message}`);
  }
}
