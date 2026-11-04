-- =====================================================================
-- Telegram dashboard – initial schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again (everything uses IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- daily_schedule: exactly one row per Malaysia calendar day.
-- ---------------------------------------------------------------------
create table if not exists public.daily_schedule (
  id                   uuid primary key default gen_random_uuid(),
  malaysia_date        date not null,
  scheduled_at         timestamptz not null,
  status               text not null default 'pending',
  dashboard_item_id    text,
  random_seed          text,
  telegram_message_id  bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  sent_at              timestamptz,
  last_error           text,
  attempt_count        integer not null default 0,
  next_attempt_at      timestamptz,
  last_attempt_at      timestamptz,
  claimed_by           text,
  claimed_at           timestamptz,
  lease_until          timestamptz,
  send_started_at      timestamptz,
  constraint daily_schedule_one_per_day unique (malaysia_date),
  constraint daily_schedule_status_check check (status in
    ('pending',     -- waiting for scheduled_at
     'processing',  -- claimed by a worker right now
     'retry',       -- failed before anything reached Telegram; will try again at next_attempt_at
     'sent',        -- posted successfully (final)
     'failed',      -- gave up (final)
     'uncertain',   -- request may or may not have reached Telegram; needs a human check (final until resolved)
     'missed',      -- worker was down too long; skipped for the day (final)
     'skipped')),   -- DRY_RUN: image made, nothing sent (final)
  constraint daily_schedule_attempts_check check (attempt_count >= 0),
  constraint daily_schedule_sent_has_time check (status <> 'sent' or sent_at is not null)
);

create index if not exists daily_schedule_due_idx
  on public.daily_schedule (status, coalesce(next_attempt_at, scheduled_at))
  where status in ('pending', 'retry', 'processing');

-- ---------------------------------------------------------------------
-- dashboard_history: one row per generated image (scheduled, test, dry run).
-- Graph points are NOT stored: they are reproduced from random_seed.
-- ---------------------------------------------------------------------
create table if not exists public.dashboard_history (
  id                   bigint generated always as identity primary key,
  schedule_id          uuid references public.daily_schedule(id) on delete set null,
  kind                 text not null default 'scheduled',
  generated_at         timestamptz not null default now(),
  malaysia_date        date not null,
  dashboard_item_id    text not null,
  random_seed          text not null,
  generated_values     jsonb not null default '{}'::jsonb,
  image_meta           jsonb not null default '{}'::jsonb,
  posting_status       text not null,
  telegram_message_id  bigint,
  error                text,
  constraint dashboard_history_kind_check check (kind in ('scheduled', 'test', 'dry_run')),
  constraint dashboard_history_status_check check (posting_status in ('sent', 'failed', 'uncertain', 'skipped', 'rendered'))
);

create index if not exists dashboard_history_date_idx on public.dashboard_history (malaysia_date desc);

-- Only the server (service role) may touch these tables. With RLS on and no
-- policies, the public "anon" key cannot read or write anything.
alter table public.daily_schedule enable row level security;
alter table public.dashboard_history enable row level security;

-- Make sure the server-side service role can use the tables even if the
-- project was created with "automatically expose new tables" turned off.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select, insert, update, delete on public.daily_schedule, public.dashboard_history to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Functions. Each one is a single SQL statement, so it is atomic: two
-- workers calling at the same moment cannot both succeed.
-- ---------------------------------------------------------------------

-- Create today's row if it does not exist yet, then return the row that exists.
create or replace function public.ensure_daily_schedule(
  p_date date, p_scheduled_at timestamptz, p_status text default 'pending', p_note text default null)
returns setof public.daily_schedule
language plpgsql as $$
begin
  insert into public.daily_schedule (malaysia_date, scheduled_at, status, last_error)
  values (p_date, p_scheduled_at, p_status, p_note)
  on conflict (malaysia_date) do nothing;
  return query select * from public.daily_schedule where malaysia_date = p_date;
end;
$$;

-- A worker that crashed mid-job leaves a 'processing' row whose lease expired.
--  * It never started talking to Telegram → safe to retry.
--  * It had started sending → we cannot know if the photo arrived → 'uncertain'.
create or replace function public.recover_stale_jobs()
returns setof public.daily_schedule
language sql as $$
  update public.daily_schedule
     set status = case when send_started_at is null then 'retry' else 'uncertain' end,
         next_attempt_at = case when send_started_at is null then now() else null end,
         last_error = case when send_started_at is null
                           then 'Worker stopped before sending; will retry'
                           else 'Worker stopped while sending; check the Telegram group, then run the resolve command' end,
         claimed_by = null, lease_until = null, updated_at = now()
   where status = 'processing' and lease_until < now()
  returning *;
$$;

-- Atomically claim a due job. Returns the row only to the one worker that wins.
create or replace function public.claim_daily_job(
  p_id uuid, p_worker text, p_lease_seconds integer, p_max_attempts integer)
returns setof public.daily_schedule
language sql as $$
  update public.daily_schedule
     set status = 'processing',
         claimed_by = p_worker,
         claimed_at = now(),
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempt_count = attempt_count + 1,
         last_attempt_at = now(),
         send_started_at = null,
         updated_at = now()
   where id = p_id
     and status in ('pending', 'retry')
     and coalesce(next_attempt_at, scheduled_at) <= now()
     and attempt_count < p_max_attempts
  returning *;
$$;

-- Called immediately before the Telegram request. Also records which item/seed is used.
create or replace function public.mark_send_started(
  p_id uuid, p_worker text, p_item text, p_seed text)
returns setof public.daily_schedule
language sql as $$
  update public.daily_schedule
     set send_started_at = now(), dashboard_item_id = p_item, random_seed = p_seed, updated_at = now()
   where id = p_id and status = 'processing' and claimed_by = p_worker
  returning *;
$$;

create or replace function public.complete_daily_job(
  p_id uuid, p_worker text, p_message_id bigint)
returns setof public.daily_schedule
language sql as $$
  update public.daily_schedule
     set status = 'sent', telegram_message_id = p_message_id, sent_at = now(),
         last_error = null, next_attempt_at = null, lease_until = null, updated_at = now()
   where id = p_id and status = 'processing' and claimed_by = p_worker
  returning *;
$$;

-- Ends an attempt that did not succeed. p_status: retry | failed | uncertain | missed | skipped.
create or replace function public.finish_daily_job(
  p_id uuid, p_worker text, p_status text, p_error text,
  p_next_attempt_at timestamptz default null, p_item text default null, p_seed text default null)
returns setof public.daily_schedule
language sql as $$
  update public.daily_schedule
     set status = p_status,
         last_error = left(p_error, 2000),
         next_attempt_at = case when p_status = 'retry' then p_next_attempt_at else null end,
         dashboard_item_id = coalesce(p_item, dashboard_item_id),
         random_seed = coalesce(p_seed, random_seed),
         lease_until = null,
         updated_at = now()
   where id = p_id and status = 'processing' and claimed_by = p_worker
     and p_status in ('retry', 'failed', 'uncertain', 'missed', 'skipped')
  returning *;
$$;

-- Manual settlement of an 'uncertain' (or 'failed' / 'missed' / 'skipped') day after a human checked the group.
--   p_action = 'sent'  → it did arrive; never send again today.
--   p_action = 'retry' → it did not arrive; send again as soon as possible.
--   p_action = 'failed'→ give up for today.
create or replace function public.resolve_daily_job(
  p_date date, p_action text, p_message_id bigint default null)
returns setof public.daily_schedule
language sql as $$
  update public.daily_schedule
     set status = p_action,
         sent_at = case when p_action = 'sent' then coalesce(sent_at, now()) else sent_at end,
         telegram_message_id = coalesce(p_message_id, telegram_message_id),
         next_attempt_at = case when p_action = 'retry' then now() else null end,
         attempt_count = case when p_action = 'retry' then least(attempt_count, 1) else attempt_count end,
         last_error = case when p_action = 'retry' then 'Manually resolved: retry' else last_error end,
         updated_at = now()
   where malaysia_date = p_date
     and status in ('uncertain', 'failed', 'missed', 'skipped')
     and p_action in ('sent', 'retry', 'failed')
  returning *;
$$;

-- Lock the functions down to the server-side service role.
do $$
declare f text;
begin
  foreach f in array array[
    'ensure_daily_schedule(date, timestamptz, text, text)',
    'recover_stale_jobs()',
    'claim_daily_job(uuid, text, integer, integer)',
    'mark_send_started(uuid, text, text, text)',
    'complete_daily_job(uuid, text, bigint)',
    'finish_daily_job(uuid, text, text, text, timestamptz, text, text)',
    'resolve_daily_job(date, text, bigint)']
  loop
    execute format('revoke all on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function public.%s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

-- Tell the Data API to pick up the new tables right away.
notify pgrst, 'reload schema';
