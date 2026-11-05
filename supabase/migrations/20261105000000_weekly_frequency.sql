-- Run once in Supabase SQL Editor. Edit posts_per_week in Table Editor afterwards.
-- 0 = pause automatic posting; 7 = every day. Weeks are Monday–Sunday MYT.
create table if not exists public.dashboard_schedule_settings (
  id integer primary key default 1 check (id = 1),
  posts_per_week integer not null default 7 check (posts_per_week between 0 and 7),
  description text not null default 'Number of distinct random days per Monday-Sunday week (Malaysia time)',
  updated_at timestamptz not null default now()
);

insert into public.dashboard_schedule_settings (id, posts_per_week)
values (1, 3)
on conflict (id) do nothing;

-- Dashboard worker authenticates with the service role, not with anonymous clients.
revoke all on public.dashboard_schedule_settings from anon, authenticated;
grant select on public.dashboard_schedule_settings to service_role;

-- Change to desired frequency whenever needed:
-- update public.dashboard_schedule_settings set posts_per_week = 4, updated_at = now() where id = 1;
