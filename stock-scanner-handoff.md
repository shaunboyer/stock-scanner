# Handoff: Stock Scanner ("Undervault") — from Claude Chat to Cowork

## What this is
A daily scanner that finds quality stocks trading near 52-week lows / sharply
down from a recent high, filters out the ones that are cheap for a bad reason,
and writes a short AI narrative for each survivor. Dashboard reads
pre-computed results — no live API calls on page load.

## Where the code is
Attached to this handoff (or already downloaded): `stock-scanner.zip`.
Structure:
- `backend/` — Express API + `scan/runScan.js` (the daily job: FMP screener →
  trigger filter → fundamentals → quality checklist → Claude narrative →
  Postgres)
- `frontend/` — React dashboard (dark trading-desk theme, expandable rows)
- `render.yaml` — Render blueprint (Postgres + API + static site + cron job)
- `README.md` — full setup/deploy instructions

## Data source
Financial Modeling Prep (FMP) — user already has an API key.

## Filter logic (the core design decision)
**Trigger ("beaten down"):** price within 15% of 52-week low, OR down 20%+
from 3-month high. Thresholds are env vars: `PCT_FROM_52W_LOW_MAX`,
`PCT_DRAWDOWN_3M_MIN`.

**Quality checklist (5 scored criteria, in `backend/services/filters.js`):**
debt load (Debt/EBITDA), free cash flow, revenue growth, gross margin,
liquidity/going-concern proxy. Insider buying tracked as a bonus flag, not
scored. Must pass 4 of 5 to make the shortlist (`passesQualityBar`).

This mirrors the user's own manual stock-analysis framework (a 7-criteria
table: debt & rate, convertible notes, cash burn & runway, TAM/competitors,
founder vs. hired CEO, C-suite turnover, insider buying/selling) — worth
keeping that alignment if the checklist gets revised.

## Known gaps flagged but not yet fixed
1. 3-month drawdown currently approximates off FMP's `yearHigh` field rather
   than a true 3-month lookback — needs a dedicated historical-price call.
2. FMP's screener params / field names (e.g. `netDebtToEBITDATTM`) haven't
   been spot-checked against live API responses yet — verify before trusting
   output.
3. Frontend `VITE_API_BASE` in `render.yaml` guesses the Render service URL
   pattern — confirm once the API service is live.

## Not yet built (discussed as a possible next step)
Tracking which tickers reappear on the shortlist across multiple days — a
"still cheap, nothing's changed" signal — was proposed but not started.

## Deploy target
Render.com, via `render.yaml` blueprint (Postgres + API + static dashboard +
cron job in one shot). User is experienced with the Claude → Render workflow.
