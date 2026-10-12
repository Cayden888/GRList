# Telegram Daily Dashboard (simulated data)

Once a day, at a random time between **10:30 AM and 5:00 PM Malaysia time**, this worker:

1. reads your public Google Sheet (configuration ranges, not real data),
2. picks one row and generates **simulated** numbers inside the min/max ranges,
3. draws a 1600 × 900 dashboard image (SVG → PNG with Sharp) with a simulated 24-hour line graph,
4. posts it to your Telegram group,
5. records everything in Supabase so restarts never lose or double the day's post.

Every image says **SIMULATED DATA** and its footer states the values are not real measurements or forecasts. The disclosure cannot be switched off (the app refuses to start if `SIMULATED_DATA_LABEL` doesn't say "simulated").

**Safe by default:** `ENABLE_SCHEDULER=false` and `DRY_RUN=true`. Nothing is ever posted until you turn both off yourself.

---

## Contents

1. [Run it on your computer](#1-run-it-on-your-computer)
2. [Connect your Google Sheet](#2-connect-your-google-sheet)
3. [Set up the Telegram bot](#3-set-up-the-telegram-bot)
4. [Set up Supabase](#4-set-up-supabase)
5. [Put the code in a private GitHub repository](#5-put-the-code-in-a-private-github-repository)
6. [Deploy to Railway](#6-deploy-to-railway)
7. [Turn on daily posting](#7-turn-on-daily-posting)
8. [Day-to-day: status, problems, "uncertain" posts](#8-day-to-day)
9. [How it works](#9-how-it-works)
10. [Command reference](#10-command-reference)
11. [Final checklist](#11-final-checklist)

---

## 0. No computer needed: buttons on GitHub

Everything in sections 1–3 and 8 can also be done from the browser:

1. Add your settings as **secrets**: repository → **Settings → Secrets and variables → Actions → New repository secret**. Names: `GOOGLE_SHEET_CSV_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (add each one when you reach that step).
2. Repository → **Actions → Dashboard tools → Run workflow**, choose an action:
   - `preview` / `preview-all-rows`: makes the image(s). Download them from the run page under **Artifacts → dashboard-images**.
   - `check-sheet`, `telegram-chat-id`, `status`: the result appears on the run's Summary page under **Result**.
   - `post-test`: sends one test image; only works if you type `SEND` in the confirm box.
   - `resolve`: settles an "uncertain" day (fill in the date and pick what happened).

The **Tests** workflow runs automatically on every code change and never sends anything.

## 1. Run it on your computer

You need **Node.js 22 or newer** (download the "LTS" installer from nodejs.org). Then, in a terminal inside this folder:

```bash
npm ci                      # install the exact package versions in package-lock.json
cp .env.example .env        # your private settings file (Windows: copy .env.example .env)
npm run preview             # makes an image in the output/ folder
```

Open the PNG in `output/`. Without a sheet configured, the preview uses built-in demo ranges and the image carries an extra **DEMO CONFIGURATION** badge.

Useful preview options:

```bash
npm run preview -- --date 2026-10-10     # what that day's image would look like
npm run preview -- --item 11-o           # a specific row (ids are shown by check-sheet)
npm run preview -- --all                 # one image per valid row
npm test                                 # run the automated tests (never sends anything)
```

Preview never touches Telegram or Supabase.

## 2. Connect your Google Sheet

1. In Google Sheets click **Share → General access → Anyone with the link → Viewer**.
2. In `.env` paste your normal sheet link:
   ```
   GOOGLE_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/1Wikan76r6oZaFF_J0ptPg4XKY9a9HBdZ63VSCUR0lLg/edit?gid=0#gid=0
   ```
   It is converted to the CSV download address automatically (the `gid=0` picks the first tab). Alternatively set `GOOGLE_SHEET_ID` + `GOOGLE_SHEET_GID` (or `GOOGLE_SHEET_TAB` with the tab's name).
3. Check it:
   ```bash
   npm run check-sheet
   npm run preview
   ```

How the sheet is read:

| Column(s) | What happens |
|---|---|
| `Title_EN`, `Title_CN` | At least one is required. Both shown when present. |
| `Current_Value_Min/Max` | **Required.** Rows with blanks, text, or min > max are skipped and logged. |
| `Current_Value` | Ignored unless `CURRENT_VALUE_SOURCE=sheet`; then used as the fixed main value. |
| `Baseline_Value_Min/Max`, `Volume_24H_*`, `Output_24H_*`, `Event_Count_24H_*` | Optional. Blank or invalid → that card is hidden (with a log line). Event Count is always a whole number. |
| `Data_Source`, `Region`, `Last_Updated`, `Next_Update` | Shown as small labels. Placeholder words like `Static`, `-`, `N/A` count as blank. |
| `Time_Since_Last_Update` | A number = minutes; short text shown as-is; blank → a simulated duration (3–45 min by default). |
| `Random_Timer_Seconds` | Read and validated, but intentionally **not drawn**: a countdown would suggest something is about to happen. |
| `Image_Name` | Used for the row's id. If it is an `http(s)` image link, it is shown as a small thumbnail; otherwise it is just a name. |

Columns are matched by header name (order doesn't matter), quoted commas and Chinese text are fine, empty rows are skipped. **About your current sheet:** every row has the same ranges, `Title_CN` is empty, and the Volume / Output / Event Count columns are blank, so images show Current Value, Baseline, Difference and a simulated Time Since Last Update. Fill those columns in and their cards appear automatically.

## 3. Set up the Telegram bot

1. **Create the bot:** in Telegram open **@BotFather** → send `/newbot` → choose a name and a username ending in `bot`. BotFather replies with a token like `123456789:AA…`. Put it in `.env` as `TELEGRAM_BOT_TOKEN=`. Treat it like a password.
2. **Add it to your group:** open the group → group name → **Add members** → search the bot's username → Add.
3. **Permissions:** the bot needs to be able to send messages and photos. In most groups members can do that by default. If your group restricts members, open the group → **Edit → Permissions** and allow *Send Messages* and *Send Photos* (or make the bot an admin with permission to post).
4. **Find the group's chat ID:** send any message in the group, e.g. `/start@YourBotName`, then run:
   ```bash
   npm run telegram:chat-id
   ```
   It lists the chats the bot has seen. Group IDs are negative, often starting with `-100`. Put it in `.env` as `TELEGRAM_CHAT_ID=`. This command sends nothing.
5. **Send one test image** (this is the only way to post manually, and it needs `--confirm`):
   ```bash
   npm run post:test -- --confirm
   ```
   The caption starts with "🧪 Test post". It doesn't count as the day's post.

## 4. Set up Supabase

1. Go to supabase.com → **New project** (free plan is fine). Pick a region close to Malaysia (e.g. Singapore). Save the database password somewhere safe (the app doesn't need it).
2. **Create the tables:** open **SQL Editor → New query**, paste the whole file `supabase/migrations/20261009000000_init.sql`, and click **Run**. You should see "Success". (Running it again is harmless.)
3. **Project URL:** **Project Settings → Data API** (or **API**) → copy the URL like `https://abcd1234.supabase.co` → `SUPABASE_URL=`.
4. **Service role key:** **Project Settings → API Keys** → the **service_role** secret key (on newer projects, a "secret" key starting `sb_secret_`) → `SUPABASE_SERVICE_ROLE_KEY=`. This key bypasses all security rules: only put it in `.env` and Railway variables, never in GitHub, screenshots or chats.
5. Check it: `npm run status` → "No schedule rows yet" means the connection works.

The tables have Row Level Security on with no public policies, and the job functions are only executable by the service role, so the public "anon" key can't read or change anything.

## 5. Put the code in a private GitHub repository

I could not create the repository from my side (no GitHub login available), so do this once:

1. On github.com click **+ → New repository**, name it e.g. `telegram-dashboard`, choose **Private**, and do **not** add a README/.gitignore (the project has them).
2. In a terminal in this folder (the project is already a git repository with one commit):
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/telegram-dashboard.git
   git branch -M main
   git push -u origin main
   ```
   If asked for a password, use a GitHub **personal access token** (GitHub → Settings → Developer settings → Personal access tokens) or sign in with GitHub Desktop.
3. Double-check on GitHub that there is **no `.env` file** in the repository. `.gitignore` excludes it.

## 6. Deploy to Railway

1. railway.com → **New Project → Deploy from GitHub repo** → allow access to your private repo → select it.
2. Railway finds the `Dockerfile` and builds it (it installs Chinese fonts and compiles the code). The start command is built in: `node dist/index.js`. You don't need to type one; if Railway asks, use that.
3. Open the service → **Variables** → add everything from your `.env` **except** `LOCAL_SHEET_CSV_PATH`. To start, keep `ENABLE_SCHEDULER=false` and `DRY_RUN=true`.
4. Service **Settings**:
   - **Restart policy:** "On Failure" (or "Always").
   - **Replicas:** 1. (More would still be safe, just pointless.)
   - Make sure "Serverless" / app sleeping is **off**: a worker must stay running.
   - No public domain or port is needed: this is a background worker, not a website.
5. Deploy, then open **Deployments → View logs**. You should see `Starting telegram-dashboard worker {...}` (no secrets are printed) and `Scheduler is DISABLED…`.

To run the manual commands against the Railway settings, either run them on your computer with the same values in `.env` (simplest), or open a shell on the service (`railway ssh` with the Railway CLI) and use `node dist/cli.js preview`, `node dist/cli.js post-test --confirm`, `node dist/cli.js status`.

## 7. Turn on daily posting

Do this only after the preview and the test post look right.

1. **Dry run day (optional but recommended):** set `ENABLE_SCHEDULER=true`, keep `DRY_RUN=true`. Logs show `Today's post is scheduled for … MYT`; at that time it renders the image but sends nothing and marks the day `skipped`. `npm run status` shows the row.
2. **Go live:** set `DRY_RUN=false` (with `ENABLE_SCHEDULER=true`). Railway restarts the worker. From now on one image is posted per day.

If you go live on a day that was already marked `skipped`, today stays skipped (posting starts tomorrow). To post today anyway: `npm run resolve -- --date YYYY-MM-DD --as retry`.

If the worker starts after 5:00 PM, it records the day as `missed` and starts again tomorrow. It never posts outside the window just because it started up.

## 8. Day-to-day

```bash
npm run status          # last 10 days: scheduled time, status, attempts, Telegram message id
```

Statuses: `pending` → waiting · `processing` → posting now · `retry` → will try again at the time shown · `sent` · `failed` · `missed` · `skipped` (dry run) · `uncertain` (see below).

**What happens when something goes wrong**

| Problem | What the worker does |
|---|---|
| Sheet unreachable, image error, Telegram not reachable, Telegram rate limit | Retries after 2, 10, then 30 minutes (max 4 attempts, never past midnight), reusing the same row and numbers. |
| Telegram refuses (wrong chat ID, bot removed, no permission) | Marks the day `failed` with a hint in `last_error`. Fix the setting; posting resumes the next day. |
| Worker restarts or redeploys | Reads today's row from Supabase: same time, same status. Nothing is lost or doubled. |
| Worker was offline at the scheduled time | Posts when it returns if that is within 90 minutes (`MISSED_JOB_GRACE_MINUTES`), otherwise marks the day `missed`. |
| **Telegram timed out / connection cut while sending** | Marks the day **`uncertain`** and does **not** resend, because Telegram may have received it and resending could double-post. |

**Settling an `uncertain` day:** look in the group, then run one of:

```bash
npm run resolve -- --date 2026-10-09 --as sent     # it did arrive – never send again that day
npm run resolve -- --date 2026-10-09 --as retry    # it did not arrive – send it at the next check (same day only)
```

Railway logs show a heartbeat every 15 minutes, e.g. `Heartbeat: today (2026-10-09) status=pending, next attempt 2026-10-09 14:37:12 MYT…`. If the heartbeats stop, the worker isn't running.

## 9. How it works

- **Same numbers on retry:** the row is picked with a seed made from the Malaysia date; the numbers and graph use a seed made from the date + row id, stored in Supabase. Selection, each metric, and the graph each use their own random stream, so adding a card never changes the graph. The next day gets a fresh simulation.
- **The graph:** 25 hourly points (−24h … 0h), smooth but not flat, always inside the Current Value min–max, last point exactly equal to the big number. Graph points are not stored: they are reproducible from the seed.
- **One post per day:** `daily_schedule.malaysia_date` is unique. A job is claimed with one atomic database update, so if two workers ever run at once (e.g. during a Railway redeploy) only one can claim it. The worker records "sending started" just before calling Telegram, so a crash mid-send becomes `uncertain`, never a duplicate.
- **No busy polling:** the worker sleeps until the scheduled time (checking the database every 15 minutes at most), about 100 small queries per day.
- **Time zone:** all scheduling uses Malaysia time (UTC+8, no daylight saving), independent of the server's own clock setting.

```
src/
  config/env.ts            settings + validation
  data/                    sheet download, CSV parsing/validation, demo rows
  simulation/              seeds, row selection, metrics, 24h trend
  dashboard/               SVG layout, number formatting, PNG rendering
  telegram/client.ts       sendPhoto + careful error classification
  database/                Supabase repository (+ in-memory one for tests)
  scheduler/               daily time planner, job runner, worker loop
  index.ts                 worker entry (Railway)
  cli.ts, cli-ops.ts       manual commands
supabase/migrations/       SQL tables, constraints, atomic job functions
tests/                     Vitest tests (Telegram and Supabase mocked)
```

## 10. Command reference

| Local | On Railway | Needs |
|---|---|---|
| `npm run preview` | `node dist/cli.js preview` | nothing |
| `npm run check-sheet` | `node dist/cli.js check-sheet` | sheet |
| `npm run telegram:chat-id` | `node dist/cli.js telegram-chat-id` | bot token |
| `npm run post:test -- --confirm` | `node dist/cli.js post-test --confirm` | sheet + Telegram |
| `npm run status` | `node dist/cli.js status` | Supabase |
| `npm run resolve -- --date D --as sent\|retry\|failed` | `node dist/cli.js resolve …` | Supabase |
| `npm test` | – | nothing |
| `npm run build && npm start` | (automatic) | see `.env.example` |

All settings are explained in `.env.example`.

## 11. Final checklist

| Check | How it is verified |
|---|---|
| Preview image renders correctly | `npm run preview`, open the PNG (automated test also checks it is a 1600×900 PNG) |
| All values respect configured ranges | tests run 400 simulated days per field; integers for counts; min = max handled |
| Chinese and English render correctly | test renders Chinese glyphs and checks they are not missing-glyph boxes; the Dockerfile installs Noto CJK fonts |
| Graph is labelled as simulated | "Simulated 24-Hour Trend" + "not historical data", checked by tests |
| Daily schedule persists across restarts | stored in Supabase; tested with a fresh worker on the same database |
| Posting window uses Malaysia time | tests: 500 days all between 10:30 and 17:00 MYT; UTC/MYT midnight boundaries |
| Duplicate posting protection works | tested with concurrent workers in tests **and** against a real PostgreSQL database (20 simultaneous claims → 1 winner) |
| Telegram test posting works | **your step:** `npm run post:test -- --confirm` once the bot and chat ID are set |
| Scheduling stays off until you enable it | `ENABLE_SCHEDULER=false` and `DRY_RUN=true` by default |
