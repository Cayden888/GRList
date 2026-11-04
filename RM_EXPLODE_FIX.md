# RM + 98% marker fix

Changed `src/dashboard/svg-portrait.ts`:

- Prefix the main 24-hour limit value and the chart endpoint callout with `RM`.
- Add a visible dashed horizontal guide and arrow at the 98% position on the gold bar.
- Label the guide `EXPLODE POINT · 98%`.
- Keep the existing cards, chart data, Supabase caption integration and Telegram posting pipeline.

The 98% annotation is a visual threshold and not a real payout prediction.
Deploy these updated files to GitHub and run a new preview/post-test; previously generated images won't change.
