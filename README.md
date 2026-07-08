# Undervault — Daily Value Scanner

Scans a watchlist of stocks once a day for names that are near their 52-week
low or sharply down from a recent high, then filters that list down to names
whose fundamentals still look solid, and writes a short Claude-generated note
for each survivor. The dashboard just reads yesterday's computed results — no
live API calls on page load.

**Note on scope:** this checks a fixed, user-edited watchlist rather than
screening the entire market. FMP's stock-screener and batch-quote endpoints
— which would be needed to discover candidates market-wide — aren't
available on the Basic plan this project runs on (confirmed live: both
return no data, while every single-symbol endpoint works fine). See
"Watchlist & call budget" below.

## How it works

1. **`backend/scan/runScan.js`** — the daily job. Pulls a quote for each
   ticker in the watchlist (one FMP call per ticker — no batch endpoint on
   this plan), checks each against 52-week low / a real trailing-3-month
   high, pulls fundamentals for anything that triggers, scores them against
   the quality checklist, generates a narrative for the shortlist via the
   Claude API, computes each name's shortlist streak, and writes it all to
   Postgres.
2. **`backend/server.js`** — small Express API the dashboard reads from
   (`/api/scans` for the list of available dates, `/api/scans/:date` for a
   given day's results).
3. **`frontend/`** — React dashboard. Table sorted by opportunity score,
   click a row to expand the quality checklist + narrative.

## Watchlist & call budget

There's no market-wide screener on this FMP plan, so `backend/data/
watchlist.js` holds the list of tickers actually checked each day — a
generic spread of liquid names, not a curated pick list. **Replace it** with
whatever you want covered (your own coverage list, an index's constituents
pasted in once, etc.), or override it per-environment with a comma-separated
`WATCHLIST_TICKERS` env var without touching the file.

Every ticker costs FMP calls:

- 1 call for its quote (every ticker, every day)
- +1 if it needs the real 3-month-high check (only names that look
  "beaten down" off the quote alone)
- +4 if it clears the trigger and goes to fundamentals (key-metrics-ttm,
  ratios-ttm, financial-growth, cash-flow-statement)

FMP's Basic plan caps out at **250 calls/day**. `runScan.js` logs actual
usage at the end of every run (`[scan] FMP calls used this run: X / 250`) —
watch that line and shrink the watchlist if you're consistently over. As a
rough guide, ~60-80 tickers with a typical 15-20% trigger rate lands well
under budget; a few hundred tickers likely won't.

`insider-trading/search` and `news/stock` are also unavailable on this plan
(confirmed live) and are skipped entirely by default (`ENABLE_NEWS_AND_INSIDER=false`)
rather than burning call budget on requests that will just fail — insider
buying always shows as "no recent insider buying" and narratives generate
without news context until you upgrade and flip that flag.

## Local setup

```bash
# 1. Postgres — point DATABASE_URL at any local or hosted instance, then:
cd backend
cp .env.example .env   # fill in FMP_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL
psql "$DATABASE_URL" -f db/schema.sql

npm install
npm run scan            # runs one scan and populates the DB
npm start                # serves the API on :4000

# 2. Frontend, in a second terminal
cd frontend
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

## Deploying to Render

`render.yaml` at the repo root defines everything: a free Postgres instance,
the API web service, the static dashboard, and a cron job that runs the scan
on weekdays at 21:30 UTC (30 min after US market close — adjust for DST).

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. It'll pick up
   `render.yaml` and provision all three services + the database.
3. Set the two secret env vars Render will prompt for on the cron job:
   `FMP_API_KEY` and `ANTHROPIC_API_KEY`. (The API web service only reads
   from Postgres, so it doesn't need either.)
4. Optionally set `WATCHLIST_TICKERS` on the cron job if you don't want the
   default list in `backend/data/watchlist.js`.
5. The dashboard's API URL is resolved automatically — `render.yaml` uses
   Render's `fromService` to pull the API service's real hostname into
   `VITE_API_HOST` at build/sync time, so it stays correct even if
   `stock-scanner-api` collides with another Render user's service name and
   gets a random suffix.
6. Run the schema once against the new database:
   `psql "$DATABASE_URL" -f backend/db/schema.sql` (grab the external
   connection string from the Render Postgres dashboard).
7. Trigger the cron job manually once from the Render dashboard so you
   have data to look at instead of waiting for the next scheduled run —
   and check its logs for the `FMP calls used this run` line to confirm
   you're inside budget.

**Free tier note:** Render's free Postgres expires after 90 days and free
web services spin down when idle (the first request after idle will be
slow). Fine for testing; worth upgrading the DB at least before you rely on
this daily.

## Tuning

- **Trigger thresholds** — env vars `PCT_FROM_52W_LOW_MAX` and
  `PCT_DRAWDOWN_3M_MIN` (backend/.env or render.yaml).
- **Watchlist** — `backend/data/watchlist.js` or `WATCHLIST_TICKERS` (see
  above).
- **Quality checklist logic** — `backend/services/filters.js`. Each
  criterion (debt load, FCF, revenue growth, margin, liquidity) has its own
  threshold and comment explaining the reasoning. Insider buying is tracked
  as a bonus flag, not counted toward the pass/fail score (and always reads
  as "no recent insider buying" until `ENABLE_NEWS_AND_INSIDER` is on).

If the shortlist comes back empty most days, loosen `passesQualityBar` in
`filters.js` (currently requires passing at least 4 of 5 scored criteria).
If it's flooded with junk, tighten the trigger thresholds first — that's
usually the cheaper lever.

## Streak tracking

Each shortlisted ticker carries a `streak_count`: the number of consecutive
scans (including today) it's cleared the shortlist, using the most recent
*prior scan date* rather than a fixed day offset, so weekends/holidays don't
reset it. Shown as a 🔥 badge in the dashboard once a name has appeared 2+
days in a row — the "still cheap, nothing's changed" signal. Resets to 1 if
a ticker drops off the list and later reappears.

## Known gaps to verify before relying on this

- **FMP plan tier blocks market-wide scanning.** `company-screener`,
  `batch-quote`, `insider-trading/search`, and `news/stock` all confirmed
  return no data on the current plan; every single-symbol endpoint works
  fine. If you upgrade your FMP plan and confirm those work, `fmp.js` has
  inline notes on what to revert to get back to scanning a real screener
  universe instead of a fixed watchlist.
- **Field names were spot-checked live**, not just against docs:
  `netDebtToEBITDATTM`, `grossProfitMarginTTM`, `currentRatioTTM`,
  `revenueGrowth`, `operatingCashFlow`, and the historical-price `price`
  field all confirmed against real API responses. One bug this caught:
  `freeCashFlowPerShareTTM` lives on the `ratios-ttm` response, not
  `key-metrics-ttm` — fixed in `filters.js`.
- **3-month drawdown is a real lookback**, not an approximation. A cheap
  first pass (single quote) narrows the watchlist down to plausible
  candidates using `yearHigh` as a loose, over-inclusive proxy; a second
  pass then pulls each candidate's actual trailing-3-month high via
  `stable/historical-price-eod/light` and recomputes the drawdown off that.
- FMP's query params and plan-tier limits can still shift between API
  updates — double-check `services/fmp.js` against FMP's current docs
  periodically.
