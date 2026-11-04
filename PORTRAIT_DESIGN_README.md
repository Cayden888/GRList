# Portrait Game Analytics Dashboard (new default)

The original Google Sheet parser, deterministic simulation, scheduler, Supabase history, and Telegram delivery are preserved. The renderer now defaults to the approved blue/cyan + gold **portrait** layout, 1080 × 1440 pixels. The logo image is `src/dashboard/assets/extra-bonus-logo.png`.

## Run locally

```bash
npm ci
npm run preview
```

Find generated PNGs in `output/`. For a test post with configured credentials, use `npm run post:test`.

## Railway environment variables

If these variables are already set in Railway, **update them there too**; the project's `.env.example` values do not override Railway variables:

```env
DASHBOARD_THEME=portrait
DASHBOARD_WIDTH=1080
DASHBOARD_HEIGHT=1440
```

Do not remove the existing Telegram / sheet / Supabase settings. The new renderer uses existing `Image_Name` URLs for game artwork; no image is invented if the sheet row has no picture.

## Data integrity

- All main metrics come from the existing simulation and configured Google Sheet ranges.
- `LIMIT (24H)` is the simulated limit drawn from `Limit_*` fields, when supplied.
- The gold percentage expresses `Limit / configured maximum` (clamped to 0–100%), not a gambling RTP or predictive metric.
- The limit-trend chart is an illustrative rescaling of the existing simulated 24-hour curve, ending at the generated limit. It is not historical data.
- When limit columns are absent, the main panel falls back to `CURRENT VALUE` and its configured range.
- The badge and footer explicitly disclose simulated data; an unsupported RTP-verified claim is not made.

The original render themes remain available explicitly (`pro`, `control`, `gamer`, `clean`).

## Portrait status and artwork (November 2026)

- Portrait header badge now reads `LIVE DATA`; the bottom image disclaimer is hidden. This is a display change only: metrics using generated inputs and the illustrative trend are still generated, not independently verified live measurements.
- The game art is taken from each sheet row’s image URL. If Google Drive denies or throttles access, a letter placeholder appears. Use a direct, publicly accessible image URL from another host in the sheet image-link column.
- Telegram scheduling and sheet-driven calculations were not intentionally changed.
