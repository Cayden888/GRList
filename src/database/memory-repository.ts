/**
 * In-memory repository with exactly the same rules as the SQL functions.
 * Used by the automated tests (no network, no real database).
 * JavaScript runs one statement at a time, so each method is atomic just like
 * a single SQL UPDATE.
 */
import { randomUUID } from 'node:crypto';
import type { FinishStatus, HistoryEntry, ResolveAction, ScheduleRepository, ScheduleRow } from './repository.js';

export class MemoryScheduleRepository implements ScheduleRepository {
  readonly rows = new Map<string, ScheduleRow>();
  readonly history: HistoryEntry[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  private iso(): string {
    return this.now().toISOString();
  }

  private clone(r: ScheduleRow): ScheduleRow {
    return { ...r };
  }

  async getByDate(malaysiaDate: string): Promise<ScheduleRow | null> {
    const r = this.rows.get(malaysiaDate);
    return r ? this.clone(r) : null;
  }

  async ensureDaily(malaysiaDate: string, scheduledAt: Date, status: 'pending' | 'missed' | 'skipped' = 'pending', note?: string): Promise<ScheduleRow> {
    if (!this.rows.has(malaysiaDate)) {
      const t = this.iso();
      this.rows.set(malaysiaDate, {
        id: randomUUID(),
        malaysia_date: malaysiaDate,
        scheduled_at: scheduledAt.toISOString(),
        status,
        dashboard_item_id: null,
        random_seed: null,
        telegram_message_id: null,
        created_at: t,
        updated_at: t,
        sent_at: null,
        last_error: note ?? null,
        attempt_count: 0,
        next_attempt_at: null,
        last_attempt_at: null,
        claimed_by: null,
        claimed_at: null,
        lease_until: null,
        send_started_at: null,
      });
    }
    return this.clone(this.rows.get(malaysiaDate)!);
  }

  private byId(id: string): ScheduleRow | undefined {
    for (const r of this.rows.values()) if (r.id === id) return r;
    return undefined;
  }

  async recoverStale(): Promise<ScheduleRow[]> {
    const now = this.now().getTime();
    const out: ScheduleRow[] = [];
    for (const r of this.rows.values()) {
      if (r.status === 'processing' && r.lease_until && Date.parse(r.lease_until) < now) {
        const started = r.send_started_at !== null;
        r.status = started ? 'uncertain' : 'retry';
        r.next_attempt_at = started ? null : this.iso();
        r.last_error = started ? 'Worker stopped while sending; check the Telegram group, then run the resolve command' : 'Worker stopped before sending; will retry';
        r.claimed_by = null;
        r.lease_until = null;
        r.updated_at = this.iso();
        out.push(this.clone(r));
      }
    }
    return out;
  }

  async claim(id: string, workerId: string, leaseSeconds: number, maxAttempts: number): Promise<ScheduleRow | null> {
    const r = this.byId(id);
    const now = this.now().getTime();
    if (!r || !(r.status === 'pending' || r.status === 'retry')) return null;
    if (Date.parse(r.next_attempt_at ?? r.scheduled_at) > now) return null;
    if (r.attempt_count >= maxAttempts) return null;
    r.status = 'processing';
    r.claimed_by = workerId;
    r.claimed_at = this.iso();
    r.lease_until = new Date(now + leaseSeconds * 1000).toISOString();
    r.attempt_count += 1;
    r.last_attempt_at = this.iso();
    r.send_started_at = null;
    r.updated_at = this.iso();
    return this.clone(r);
  }

  private owned(id: string, workerId: string): ScheduleRow | undefined {
    const r = this.byId(id);
    return r && r.status === 'processing' && r.claimed_by === workerId ? r : undefined;
  }

  async markSendStarted(id: string, workerId: string, itemId: string, seed: string): Promise<boolean> {
    const r = this.owned(id, workerId);
    if (!r) return false;
    r.send_started_at = this.iso();
    r.dashboard_item_id = itemId;
    r.random_seed = seed;
    return true;
  }

  async complete(id: string, workerId: string, telegramMessageId: number): Promise<boolean> {
    const r = this.owned(id, workerId);
    if (!r) return false;
    Object.assign(r, { status: 'sent', telegram_message_id: telegramMessageId, sent_at: this.iso(), last_error: null, next_attempt_at: null, lease_until: null, updated_at: this.iso() });
    return true;
  }

  async finish(id: string, workerId: string, status: FinishStatus, error: string, nextAttemptAt?: Date | null, itemId?: string | null, seed?: string | null): Promise<boolean> {
    const r = this.owned(id, workerId);
    if (!r) return false;
    r.status = status;
    r.last_error = error.slice(0, 2000);
    r.next_attempt_at = status === 'retry' && nextAttemptAt ? nextAttemptAt.toISOString() : null;
    r.dashboard_item_id = itemId ?? r.dashboard_item_id;
    r.random_seed = seed ?? r.random_seed;
    r.lease_until = null;
    r.updated_at = this.iso();
    return true;
  }

  async resolve(malaysiaDate: string, action: ResolveAction, telegramMessageId?: number | null): Promise<ScheduleRow | null> {
    const r = this.rows.get(malaysiaDate);
    if (!r || !['uncertain', 'failed', 'missed', 'skipped'].includes(r.status)) return null;
    r.status = action;
    if (action === 'sent') r.sent_at = r.sent_at ?? this.iso();
    if (telegramMessageId) r.telegram_message_id = telegramMessageId;
    r.next_attempt_at = action === 'retry' ? this.iso() : null;
    if (action === 'retry') {
      r.attempt_count = Math.min(r.attempt_count, 1);
      r.last_error = 'Manually resolved: retry';
    }
    r.updated_at = this.iso();
    return this.clone(r);
  }

  async listRecent(limit: number): Promise<ScheduleRow[]> {
    return [...this.rows.values()].sort((a, b) => (a.malaysia_date < b.malaysia_date ? 1 : -1)).slice(0, limit).map((r) => this.clone(r));
  }

  async recordHistory(entry: HistoryEntry): Promise<void> {
    this.history.push(entry);
  }
}
