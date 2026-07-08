import dotenv from "dotenv";

dotenv.config();

// FMP retired the /api/v3 base for most calls in favor of their "stable" API
// (v3/legacy routes were auth-gated behind eligible accounts as of Aug 2025 —
// see https://site.financialmodelingprep.com/developer/docs/legacy-endpoints).
// Endpoint paths + the symbol-in-query convention below were confirmed live
// against the user's own FMP key in July 2026.
//
// IMPORTANT — plan-tier gap found during that live test: `company-screener`,
// `batch-quote`, `insider-trading/search`, and `news/stock` all returned no
// data on this key's plan, while every single-symbol endpoint (quote,
// key-metrics-ttm, ratios-ttm, financial-growth, cash-flow-statement,
// historical-price-eod) worked fine. So this file no longer calls the
// screener/batch endpoints at all — see backend/data/watchlist.js and
// runScan.js for the watchlist-based redesign this forced. If you upgrade
// your FMP plan and confirm screener/batch-quote/insider/news work, this is
// the file to revert.
const BASE = "https://financialmodelingprep.com/stable";
const API_KEY = process.env.FMP_API_KEY;

// Insider trading + news are confirmed unavailable on the current plan.
// Skip calling them by default (saves call budget on Basic's 250/day cap)
// rather than burning a call on a request that's just going to fail. Flip
// this on once you've confirmed those endpoints work on your plan.
const ENABLE_NEWS_AND_INSIDER = process.env.ENABLE_NEWS_AND_INSIDER === "true";

if (!API_KEY) {
  console.warn("[fmp] FMP_API_KEY is not set — API calls will fail.");
}

let callCount = 0;
export function getCallCount() {
  return callCount;
}
export function resetCallCount() {
  callCount = 0;
}

async function fmpGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  url.searchParams.set("apikey", API_KEY);

  callCount += 1;
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FMP ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Single-symbol real-time-ish quote (price, 52w high/low, market cap).
 * Confirmed live: returns { symbol, price, yearHigh, yearLow, marketCap, ... }.
 */
export async function getQuote(ticker) {
  const data = await fmpGet("/quote", { symbol: ticker });
  return data?.[0] || null;
}

/**
 * True 3-month lookback for the drawdown trigger (replaces the old
 * yearHigh-based approximation). Uses the "light" EOD chart (date + close +
 * volume only) since we just need the highest close in the window — cheaper
 * than the full OHLCV endpoint. Returns the highest close over the trailing
 * ~3 months, or null if no data came back.
 */
export async function getThreeMonthHigh(ticker) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 95); // ~3 months, a little padding for weekends/holidays

  const fmt = (d) => d.toISOString().slice(0, 10);

  try {
    const bars = await fmpGet("/historical-price-eod/light", {
      symbol: ticker,
      from: fmt(from),
      to: fmt(to),
    });
    if (!Array.isArray(bars) || bars.length === 0) return null;
    return bars.reduce((max, bar) => (bar.price > max ? bar.price : max), 0) || null;
  } catch {
    return null;
  }
}

export async function getKeyMetricsTTM(ticker) {
  const data = await fmpGet("/key-metrics-ttm", { symbol: ticker });
  return data?.[0] || null;
}

export async function getRatiosTTM(ticker) {
  const data = await fmpGet("/ratios-ttm", { symbol: ticker });
  return data?.[0] || null;
}

export async function getFinancialGrowth(ticker) {
  const data = await fmpGet("/financial-growth", { symbol: ticker, limit: 1 });
  return data?.[0] || null;
}

export async function getCashFlowStatement(ticker) {
  const data = await fmpGet("/cash-flow-statement", { symbol: ticker, limit: 4, period: "quarter" });
  return data || [];
}

export async function getInsiderTrading(ticker) {
  if (!ENABLE_NEWS_AND_INSIDER) return [];
  try {
    return await fmpGet("/insider-trading/search", { symbol: ticker, limit: 20 });
  } catch {
    return [];
  }
}

export async function getRecentNews(ticker) {
  if (!ENABLE_NEWS_AND_INSIDER) return [];
  try {
    return await fmpGet("/news/stock", { symbols: ticker, limit: 5 });
  } catch {
    return [];
  }
}

/**
 * Fetch everything needed to run the quality checklist for one ticker.
 * Run with limited concurrency across the shortlist — see runScan.js.
 * 4 calls per ticker (key-metrics-ttm, ratios-ttm, financial-growth,
 * cash-flow-statement) — 6 if ENABLE_NEWS_AND_INSIDER is on.
 */
export async function getFundamentalsBundle(ticker) {
  const [keyMetrics, ratios, growth, cashFlows, insiderTrades, news] = await Promise.all([
    getKeyMetricsTTM(ticker).catch(() => null),
    getRatiosTTM(ticker).catch(() => null),
    getFinancialGrowth(ticker).catch(() => null),
    getCashFlowStatement(ticker).catch(() => []),
    getInsiderTrading(ticker).catch(() => []),
    getRecentNews(ticker).catch(() => []),
  ]);
  return { keyMetrics, ratios, growth, cashFlows, insiderTrades, news };
}
