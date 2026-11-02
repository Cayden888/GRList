-- Card titles shown on the dashboard image.
--   previous_header : the Google Sheet columns the card comes from (don't edit)
--   new_header      : the title printed on the image – edit this one
--   shows_on        : where the card is on the image
-- Clear new_header to go back to the default title. Running this file again is harmless.

-- Replace the first version of this table (it had "key"/"label" columns).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'dashboard_labels' and column_name = 'key') then
    drop table public.dashboard_labels;
  end if;
end $$;

create table if not exists public.dashboard_labels (
  previous_header text primary key,
  new_header      text not null default '',
  shows_on        text
);

insert into public.dashboard_labels (previous_header, new_header, shows_on) values
  ('Current_Value_Min / Current_Value_Max',     'CURRENT VALUE',     'Main card with the 24H chart (" · 24H" is added after it)'),
  ('Baseline_Value_Min / Baseline_Value_Max',   'BASELINE VALUE',    'Right column, top card'),
  ('Low_Limit_24H_Min / High_Limit_24H_Max',    'LIMIT (24H)',       'Right column, middle card'),
  ('Volume_24H_Min / Volume_24H_Max',           'VOLUME (24H)',      'Bottom row, first card'),
  ('Output_24H_Min / Output_24H_Max',           'OUTPUT (24H)',      'Bottom row, second card'),
  ('Event_Count_24H_Min / Event_Count_24H_Max', 'EVENT COUNT (24H)', 'Bottom row, third card')
on conflict (previous_header) do nothing;

-- Same protection as the other tables: only the server (service role) can read it.
alter table public.dashboard_labels enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.dashboard_labels to service_role;
  end if;
end $$;
