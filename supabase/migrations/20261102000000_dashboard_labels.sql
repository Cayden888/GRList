-- Card titles shown on the dashboard image. Edit the "label" column in the
-- Supabase Table Editor; the next image uses it. Delete a row's text (or the
-- row) to fall back to the default title. Running this file again is harmless.
create table if not exists public.dashboard_labels (
  key         text primary key,
  label       text not null default '',
  description text
);

insert into public.dashboard_labels (key, label, description) values
  ('current_value',   'CURRENT VALUE',     'Main card with the 24H chart (" · 24H" is added after it)'),
  ('baseline_value',  'BASELINE VALUE',    'Right column, top card'),
  ('limit_24h',       'LIMIT (24H)',       'Right column, middle card'),
  ('volume_24h',      'VOLUME (24H)',      'Bottom row, first card'),
  ('output_24h',      'OUTPUT (24H)',      'Bottom row, second card'),
  ('event_count_24h', 'EVENT COUNT (24H)', 'Bottom row, third card')
on conflict (key) do nothing;

-- Same protection as the other tables: only the server (service role) can read it.
alter table public.dashboard_labels enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.dashboard_labels to service_role;
  end if;
end $$;
