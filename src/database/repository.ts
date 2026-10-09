/**
 * Storage interface for the daily schedule. The real implementation talks to
 * Supabase (see supabase-repository.ts); tests use the in-memory version
 * (memory-repository.ts), which follows the same rules as the SQL functions.
 */
export type JobStatus = 'pending' | 'processing' | 'retry' | 'sent' | 'failed' | 'uncertain' | 'missed' | 'skipped';
export type FinishStatus = 'retry' | 'failed' | 'uncertain' | 'missed' | 'skipped';
export type ResolveAction = 'sent' | 'retry' | 'failed';

export const FINAL_STATUSES: readonly JobStatus[] = ['sent', 'failed', 'uncertain', 'missed', 'skipped'];

export interface ScheduleRow {
  id: string;
  malaysia_date: string;
  scheduled_at: string;
  status: JobStatus;
  dashboard_item_id: string | null;
  random_seed: string | null;
  telegram_message_id: number | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  last_error: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_until: string | null;
  send_started_at: string | null;
}

export interface HistoryEntry {
  schedule_id?: string | null;
  kind: 'scheduled' | 'test' | 'dry_run';
  malaysia_date: string;
  dashboard_item_id: string;
  random_seed: string;
  generated_values: Record<string, unknown>;
  image_meta: Record<string, unknown>;
  posting_status: 'sent' | 'failed' | 'uncertain' | 'skipped' | 'rendered';
  telegram_message_id?: number | null;
  error?: string | null;
}

export interface ScheduleRepository {
  getByDate(malaysiaDate: string): Promise<ScheduleRow | null>;
  /** Inserts the day's row if missing and returns whichever row exists. */
  ensureDaily(malaysiaDate: string, scheduledAt: Date, status?: 'pending' | 'missed', note?: string): Promise<ScheduleRow>;
  recoverStale(): Promise<ScheduleRow[]>;
  /** Atomic claim. Returns null when another worker won or the job is not due. */
  claim(id: string, workerId: string, leaseSeconds: number, maxAttempts: number): Promise<ScheduleRow | null>;
  markSendStarted(id: string, workerId: string, itemId: string, seed: string): Promise<boolean>;
  complete(id: string, workerId: string, telegramMessageId: number): Promise<boolean>;
  finish(id: string, workerId: string, status: FinishStatus, error: string, nextAttemptAt?: Date | null, itemId?: string | null, seed?: string | null): Promise<boolean>;
  resolve(malaysiaDate: string, action: ResolveAction, telegramMessageId?: number | null): Promise<ScheduleRow | null>;
  listRecent(limit: number): Promise<ScheduleRow[]>;
  recordHistory(entry: HistoryEntry): Promise<void>;
}
