import dotenv from "dotenv";
import { pool } from "../db/pool.js";
import { getQuote, getThreeMonthHigh, getFundamentalsBundle, getCallCount } from "../services/fmp.js";
import { evaluateQuality, computeOpportunityScore, passesQualityBar } from "../services/filters.js";
import { generateNarrative } from "../services/claude.js";
import { mapWithConcurrency } from "../services/concurrency.js";
import { DEFAULT_WATCHLIST } from "../data/watchlist.js";

dotenv.config();

const PCT_FROM_52W_LOW_MAX = Number(process.env.PCT_FROM_52W_LOW_MAX || 15);
const PCT_DRAWDOWN_3M_MIN = Number(process.env.PCT_DRAWDOWN_3M_MIN || 20);
const MAX_DAILY_FMP_CALLS = Number(process.env.MAX_DAILY_FMP_CALLS || 250); // FMP Basic plan default

function pctFromLow(price, yearLow) {
  if (!price || !yearLow) return null;
  return ((price - yearLow) / yearLow) * 100;
}

function getWatchlist() {
  const override = process.env.WATCHLIST_TICKERS;
  if (override && override.trim().length > 0) {
    return override.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  }
  return DEFAULT_WATCHLIST;
}

async function main() {
  console.log("[scan] starting daily scan...");
  const today = new Date().toISOString().slice(0, 10);

  // 1. Scan universe = a fixed, user-edited watchlist (see backend/data/
  // watchlist.js or WATCHLIST_TICKERS env var), NOT the whole market.
  // FMP's company-screener/batch-quote endpoints aren't available on this
  // plan (confirmed live), so there's no way to discover "everything near
  // its 52-week low" market-wide — only to check tickers we already know
  // about, one quote call at a time.
  const watchlist = getWatchlist();
  console.log(`[scan] watchlist size: ${watchlist.length}`);

  // 2. Pull a quote per ticker (1 FMP call each — no batch endpoint on this plan).
  const quoted = await mapWithConcurrency(watchlist, 8, async (ticker) => {
    const q = await getQuote(ticker).catch(() => null);
    return { ticker, quote: q };
  });

  // 3a. Cheap trigger check using only the quote we already have (no extra
  // calls yet). "Near 52w low" is already accurate here. For the drawdown
  // side we use yearHigh as a loose, over-inclusive proxy — anything that
  // *might* clear the real 3-month-drawdown bar once we check its actual
  // 3-month high gets carried into the precise pass below. This keeps us
  // from firing a historical-price call for names nowhere near either bar.
  const preCandidates = [];
  for (const { ticker, quote: q } of quoted) {
    if (!q || !q.yearLow || !q.price) continue;

    const fromLow = pctFromLow(q.price, q.yearLow);
    const nearLow = fromLow !== null && fromLow <= PCT_FROM_52W_LOW_MAX;

    const approxDrawdown = q.yearHigh ? ((q.yearHigh - q.price) / q.yearHigh) * 100 : null;
    const mightHaveBigDrawdown = approxDrawdown !== null && approxDrawdown >= PCT_DRAWDOWN_3M_MIN;

    if (nearLow || mightHaveBigDrawdown) {
      preCandidates.push({
        ticker,
        companyName: q.name,
        sector: null, // /quote doesn't return sector; not worth a profile call just for display
        price: q.price,
        marketCap: q.marketCap,
        yearLow: q.yearLow,
        yearHigh: q.yearHigh,
        pctFromLow: fromLow,
        nearLow,
      });
    }
  }
  console.log(`[scan] pre-filter candidates: ${preCandidates.length}`);

  // 3b. Precise pass: pull each candidate's real trailing-3-month high and
  // recompute the drawdown off that instead of yearHigh. Confirms (or
  // rejects) the "near low" names too, since we now have a real number.
  const withRealDrawdown = await mapWithConcurrency(preCandidates, 8, async (stock) => {
    const threeMonthHigh = await getThreeMonthHigh(stock.ticker);
    const drawdown =
      threeMonthHigh && threeMonthHigh > 0 ? ((threeMonthHigh - stock.price) / threeMonthHigh) * 100 : null;
    return { ...stock, threeMonthHigh, pctDrawdown3m: drawdown };
  });

  const triggered = withRealDrawdown.filter((s) => {
    const bigDrawdown = s.pctDrawdown3m !== null && s.pctDrawdown3m >= PCT_DRAWDOWN_3M_MIN;
    return s.nearLow || bigDrawdown;
  });
  console.log(`[scan] triggered (near low / big drawdown, real 3M high): ${triggered.length}`);

  // 4. Pull fundamentals for the triggered set and score quality.
  // Concurrency-limited since this is one call bundle per ticker.
  const evaluated = await mapWithConcurrency(triggered, 8, async (stock) => {
    const bundle = await getFundamentalsBundle(stock.ticker);
    const { checklist, qualityScore, scoredOutOf } = evaluateQuality(bundle);
    const opportunityScore = computeOpportunityScore({
      pctFromLow: stock.pctFromLow ?? 100,
      pctDrawdown3m: stock.pctDrawdown3m ?? 0,
      qualityScore,
      scoredOutOf,
    });
    return { ...stock, checklist, qualityScore, scoredOutOf, opportunityScore, news: bundle.news };
  });

  // 5. Shortlist = clears the quality bar.
  const shortlisted = evaluated
    .filter((s) => passesQualityBar(s.qualityScore, s.scoredOutOf))
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
  console.log(`[scan] shortlisted: ${shortlisted.length}`);

  // 6. Generate narratives only for the shortlist (keeps Claude API usage small).
  const withNarratives = await mapWithConcurrency(shortlisted, 5, async (s) => {
    const { narrative, headline } = await generateNarrative({
      ticker: s.ticker,
      companyName: s.companyName,
      sector: s.sector,
      price: s.price,
      pctFromLow: s.pctFromLow,
      pctDrawdown3m: s.pctDrawdown3m,
      checklist: s.checklist,
      news: s.news,
    });
    return { ...s, narrative, newsHeadline: headline };
  });

  // 7. Streak tracking: how many consecutive scans (including today) has each
  // shortlisted ticker appeared on the list? Looks at the most recent PRIOR
  // scan date (not just "yesterday") so weekends/holidays don't break the streak.
  const tickerList = withNarratives.map((s) => s.ticker);
  let streakByTicker = new Map();
  if (tickerList.length > 0) {
    const prevResult = await pool.query(
      `SELECT sr.ticker, sr.streak_count
       FROM scan_results sr
       JOIN scans sc ON sr.scan_id = sc.id
       WHERE sc.scan_date = (SELECT MAX(scan_date) FROM scans WHERE scan_date < $1)
         AND sr.ticker = ANY($2)`,
      [today, tickerList]
    );
    streakByTicker = new Map(prevResult.rows.map((r) => [r.ticker, r.streak_count]));
  }
  const withStreaks = withNarratives.map((s) => ({
    ...s,
    streakCount: (streakByTicker.get(s.ticker) || 0) + 1,
  }));

  // 8. Persist.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const scanRes = await client.query(
      `INSERT INTO scans (scan_date, universe_size, triggered_count, shortlisted_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (scan_date) DO UPDATE SET
         universe_size = EXCLUDED.universe_size,
         triggered_count = EXCLUDED.triggered_count,
         shortlisted_count = EXCLUDED.shortlisted_count
       RETURNING id`,
      [today, watchlist.length, triggered.length, withStreaks.length]
    );
    const scanId = scanRes.rows[0].id;

    await client.query("DELETE FROM scan_results WHERE scan_id = $1", [scanId]);

    for (const s of withStreaks) {
      await client.query(
        `INSERT INTO scan_results (
          scan_id, ticker, company_name, sector, price, market_cap, year_low, year_high,
          pct_from_52w_low, pct_drawdown_3m,
          debt_flag, debt_detail, fcf_flag, fcf_detail,
          revenue_growth_flag, revenue_growth_detail, margin_flag, margin_detail,
          going_concern_flag, going_concern_detail, insider_buying_flag, insider_buying_detail,
          quality_score, opportunity_score, narrative, news_headline, streak_count
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
        )`,
        [
          scanId, s.ticker, s.companyName, s.sector, s.price, s.marketCap, s.yearLow, s.yearHigh,
          s.pctFromLow, s.pctDrawdown3m,
          s.checklist.debt.flag, s.checklist.debt.detail,
          s.checklist.fcf.flag, s.checklist.fcf.detail,
          s.checklist.revenueGrowth.flag, s.checklist.revenueGrowth.detail,
          s.checklist.margin.flag, s.checklist.margin.detail,
          s.checklist.goingConcern.flag, s.checklist.goingConcern.detail,
          s.checklist.insiderBuying.flag, s.checklist.insiderBuying.detail,
          s.qualityScore, s.opportunityScore, s.narrative, s.newsHeadline, s.streakCount,
        ]
      );
    }

    await client.query("COMMIT");
    console.log(`[scan] done. ${withStreaks.length} names saved for ${today}.`);

    const callsUsed = getCallCount();
    const budgetNote = callsUsed > MAX_DAILY_FMP_CALLS ? " — OVER BUDGET, trim WATCHLIST_TICKERS" : "";
    console.log(`[scan] FMP calls used this run: ${callsUsed} / ${MAX_DAILY_FMP_CALLS} daily budget${budgetNote}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[scan] failed:", err);
  process.exit(1);
});
