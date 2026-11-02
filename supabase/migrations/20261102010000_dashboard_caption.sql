-- The text under each Telegram picture. Edit the "text" column in the
-- Supabase Table Editor; the next post uses it.
--   Placeholders (filled with that post's numbers – the same simulated values as the image):
--     {time} {date} {title} {title_cn} {source} {region} {current} {baseline}
--     {difference} {limit} {volume} {output} {event_count} {last_update}
--   A line whose placeholder has no value that day is left out automatically.
--   Several lines in one cell are fine (or type \n for a new line).
--   Clear a cell to go back to the default wording.
--   Type a single "-" to leave that line out.
-- Running this file again is harmless (your edits are kept).
create table if not exists public.dashboard_caption (
  line        text primary key,
  text        text not null default '',
  what_it_is  text
);

insert into public.dashboard_caption (line, text, what_it_is) values
  ('1_title',      '📊 Daily Dashboard',                          'First line of the daily post'),
  ('2_test_title', '🧪 Test post – Daily Dashboard',              'First line of a post-test (instead of 1_title)'),
  ('3_message',    'Simulated data for demonstration purposes.',  'Middle line(s)'),
  ('4_updated',    'Updated: {time}',                             'Last line – {time} becomes the post time'),
  ('5_footer',     '-',                                           'Optional extra line(s) at the end ("-" = none)')
on conflict (line) do nothing;

alter table public.dashboard_caption enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.dashboard_caption to service_role;
  end if;
end $$;
