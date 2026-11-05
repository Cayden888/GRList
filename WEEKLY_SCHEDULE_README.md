# Supabase-controlled random weekly posting

1. Run `supabase/migrations/20261105000000_weekly_frequency.sql` in Supabase SQL Editor.
2. In Supabase Table Editor open `public.dashboard_schedule_settings`, row `id = 1`. Change `posts_per_week` to any integer **0 to 7** (3 means three distinct random weekdays, 0 pauses scheduled posting, 7 means every day).
3. Deploy the updated project to Railway. Keep `ENABLE_SCHEDULER=true` to enable the long-running worker; the GitHub `post-test` manual action is independent and can still send test posts.
4. The worker checks Supabase when it first creates each day's schedule row. Each Monday-Sunday week in Malaysia time has a deterministic pseudo-random selection of distinct days. The existing posting window still controls random times on selected days.

Important: Changes to `posts_per_week` do not automatically cancel days already present in `daily_schedule` and may result in more/fewer than the newly requested number if changed midweek. **Set the desired number before the week begins for an exact weekly target.** The days are deterministic for a given week + setting, preventing random changes after worker restarts. Missed posts are not automatically made up. A temporary Supabase read error blocks scheduling rather than falling back to daily posting. A missing table defaults to 7/week until the SQL migration is run.
