/**
 * Turns a raw fundamentals bundle into a pass/fail/unknown checklist.
 * These thresholds are starting points — tune them once you see how many
 * names clear the bar day to day. Too strict = empty list, too loose =
 * back to scrolling garbage.
 */

function flag(pass) {
  if (pass === null || pass === undefined) return "unknown";
  return pass ? "pass" : "fail";
}

export function evaluateQuality({ keyMetrics, ratios, growth, cashFlows, insiderTrades }) {
  const checklist = {};

  // 1. Debt load — Debt/EBITDA under ~4x is generally manageable;
  // above that, a rough patch can turn into a solvency problem.
  const debtToEbitda = keyMetrics?.netDebtToEBITDATTM ?? keyMetrics?.debtToEbitda ?? null;
  checklist.debt = {
    flag: debtToEbitda === null ? "unknown" : flag(debtToEbitda < 4),
    detail:
      debtToEbitda === null
        ? "Debt/EBITDA not available"
        : `Net Debt/EBITDA: ${debtToEbitda.toFixed(2)}x`,
  };

  // 2. Free cash flow — positive or near-breakeven means no urgent need
  // to dilute shareholders or take on expensive debt to stay afloat.
  // NOTE: confirmed against a live response — freeCashFlowPerShareTTM lives
  // on the ratios-ttm payload, not key-metrics-ttm (the field doesn't exist
  // there at all, so this always came back "unknown" before the fix).
  const fcfPerShare = ratios?.freeCashFlowPerShareTTM ?? keyMetrics?.freeCashFlowPerShareTTM ?? null;
  checklist.fcf = {
    flag: fcfPerShare === null ? "unknown" : flag(fcfPerShare > -0.5),
    detail: fcfPerShare === null ? "FCF/share not available" : `FCF/share (TTM): $${fcfPerShare.toFixed(2)}`,
  };

  // 3. Revenue growth — still growing (or flat), not a business in
  // structural decline that just happens to look "cheap."
  const revGrowth = growth?.revenueGrowth ?? null;
  checklist.revenueGrowth = {
    flag: revGrowth === null ? "unknown" : flag(revGrowth > -0.05),
    detail: revGrowth === null ? "Revenue growth not available" : `Revenue growth (YoY): ${(revGrowth * 100).toFixed(1)}%`,
  };

  // 4. Margins — gross margin holding up, not eroding, which would
  // signal pricing power or competitive position is breaking down.
  const grossMargin = ratios?.grossProfitMarginTTM ?? null;
  checklist.margin = {
    flag: grossMargin === null ? "unknown" : flag(grossMargin > 0.2),
    detail: grossMargin === null ? "Gross margin not available" : `Gross margin (TTM): ${(grossMargin * 100).toFixed(1)}%`,
  };

  // 5. Going concern / liquidity crunch — rough proxy using current ratio
  // and recent cash flow trend, since FMP doesn't expose filing language directly.
  const currentRatio = ratios?.currentRatioTTM ?? null;
  const recentOperatingCF = cashFlows?.[0]?.operatingCashFlow ?? null;
  const liquidityOk =
    currentRatio === null && recentOperatingCF === null
      ? null
      : (currentRatio === null || currentRatio > 1) && (recentOperatingCF === null || recentOperatingCF > 0);
  checklist.goingConcern = {
    flag: flag(liquidityOk),
    detail: `Current ratio: ${currentRatio !== null ? currentRatio.toFixed(2) : "n/a"}, recent operating CF: ${
      recentOperatingCF !== null ? (recentOperatingCF > 0 ? "positive" : "negative") : "n/a"
    }`,
  };

  // Bonus, not counted in the score: insider buying in the last ~6 months.
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const recentBuys = (insiderTrades || []).filter((t) => {
    const isBuy = (t.transactionType || t.acquisitionOrDisposition) === "P-Purchase" || t.acquisitionOrDisposition === "A";
    const date = new Date(t.transactionDate || t.filingDate);
    return isBuy && date > sixMonthsAgo;
  });
  checklist.insiderBuying = {
    flag: recentBuys.length > 0 ? "pass" : "fail",
    detail: recentBuys.length > 0 ? `${recentBuys.length} insider buy(s) in last 6mo` : "No recent insider buying",
  };

  const scoredCriteria = ["debt", "fcf", "revenueGrowth", "margin", "goingConcern"];
  const qualityScore = scoredCriteria.filter((k) => checklist[k].flag === "pass").length;

  return { checklist, qualityScore, scoredOutOf: scoredCriteria.length };
}

/**
 * Composite ranking score: rewards being both deeply oversold AND high quality.
 * Purely a sort key for the dashboard — tune weights to taste.
 */
export function computeOpportunityScore({ pctFromLow, pctDrawdown3m, qualityScore, scoredOutOf }) {
  const oversoldComponent = Math.max(0, 15 - pctFromLow) + Math.max(0, pctDrawdown3m - 20);
  const qualityComponent = (qualityScore / scoredOutOf) * 20;
  return Number((oversoldComponent + qualityComponent).toFixed(2));
}

/**
 * Minimum bar for making today's shortlist at all. Names that fail more
 * than one scored criterion are probably cheap for a real reason.
 */
export function passesQualityBar(qualityScore, scoredOutOf) {
  return qualityScore >= scoredOutOf - 1;
}
