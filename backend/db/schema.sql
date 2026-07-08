-- Run once against your Render Postgres instance:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  scan_date DATE NOT NULL UNIQUE,
  universe_size INTEGER NOT NULL,
  triggered_count INTEGER NOT NULL,
  shortlisted_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_results (
  id SERIAL PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  price NUMERIC,
  market_cap NUMERIC,
  year_low NUMERIC,
  year_high NUMERIC,
  pct_from_52w_low NUMERIC,
  pct_drawdown_3m NUMERIC,

  -- quality checklist (each: 'pass' | 'fail' | 'unknown')
  debt_flag TEXT,
  debt_detail TEXT,
  fcf_flag TEXT,
  fcf_detail TEXT,
  revenue_growth_flag TEXT,
  revenue_growth_detail TEXT,
  margin_flag TEXT,
  margin_detail TEXT,
  going_concern_flag TEXT,
  going_concern_detail TEXT,
  insider_buying_flag TEXT,
  insider_buying_detail TEXT,

  quality_score INTEGER,      -- count of criteria passed, out of 5 (insider buying is a bonus, not counted)
  opportunity_score NUMERIC,  -- composite rank score, higher = more interesting

  narrative TEXT,             -- Claude-generated summary
  news_headline TEXT,         -- most relevant recent headline used for narrative

  -- Consecutive trading days (including today) this ticker has cleared the
  -- shortlist. 1 = new today. Resets to 1 if it drops off and reappears later.
  streak_count INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_ticker ON scan_results(ticker);
CREATE INDEX IF NOT EXISTS idx_scans_scan_date ON scans(scan_date);

-- Run this against an existing database that predates streak_count:
-- ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 1;
