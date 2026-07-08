// Default scan universe.
//
// The original design pulled "the market" from FMP's stock screener +
// batch-quote endpoints, but those turned out to require a plan tier above
// what this project's FMP key has (confirmed live — screener/batch-quote
// return no data; single-symbol endpoints like quote/key-metrics-ttm/
// ratios-ttm/financial-growth/cash-flow-statement all work fine on this
// plan). So instead of screening the whole market, the scan now loops
// single-symbol calls over a fixed, user-edited watchlist.
//
// This list is just a reasonable starting point — a spread of liquid
// large/mid-caps across sectors — NOT a curated "quality" list. Swap it for
// whatever you actually want scanned: your own coverage list, an index's
// constituents pasted in once, sector-specific names, whatever. Override it
// entirely without editing this file by setting WATCHLIST_TICKERS as a
// comma-separated env var (see backend/.env.example).
//
// Sizing note: every ticker here costs 1 FMP call for its quote, plus 1
// more if it needs the real 3-month-high check, plus 4 more if it clears
// the "beaten down" trigger and goes to fundamentals. See runScan.js's
// call-budget log line after a run to check you're inside your plan's
// daily call limit (MAX_DAILY_FMP_CALLS, default 250 for FMP's Basic plan).
export const DEFAULT_WATCHLIST = [
  // Tech / software
  "AAPL", "MSFT", "GOOGL", "META", "NVDA", "AMD", "CRM", "ADBE", "ORCL", "INTC",
  "CSCO", "IBM", "QCOM", "TXN", "NOW", "INTU", "PANW", "SNOW", "NET", "DDOG",
  // Consumer
  "AMZN", "TSLA", "HD", "NKE", "SBUX", "MCD", "TGT", "LOW", "TJX", "DIS",
  // Healthcare
  "JNJ", "PFE", "UNH", "ABBV", "MRK", "LLY", "BMY", "GILD", "CVS", "MRNA",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "V", "MA", "AXP", "SCHW", "BLK",
  // Industrials / energy / materials
  "XOM", "CVX", "CAT", "BA", "GE", "HON", "UPS", "DE", "LIN", "FCX",
  // Comms / media
  "NFLX", "CMCSA", "T", "VZ", "TMUS",
];
