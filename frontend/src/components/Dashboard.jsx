import React, { useEffect, useRef, useState } from "react";
import { fetchScanDates, fetchScan, triggerScan, fetchScanStatus } from "../api.js";
import QualityBar from "./QualityBar.jsx";
import DetailPanel from "./DetailPanel.jsx";

function fmtMoney(n) {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function fmtMarketCap(n) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

export default function Dashboard() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [scanData, setScanData] = useState(null);
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanRunError, setScanRunError] = useState(null);
  const pollRef = useRef(null);

  function loadDates() {
    fetchScanDates()
      .then((d) => setDates(d))
      .catch(() => {});
  }

  function loadScan() {
    setLoading(true);
    setError(null);
    fetchScan(selectedDate)
      .then((data) => setScanData(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(loadDates, []);
  useEffect(loadScan, [selectedDate]);

  // Pick up an in-progress scan (e.g. the cron job, or another browser tab)
  // on load, so the button reflects reality instead of always starting idle.
  useEffect(() => {
    fetchScanStatus()
      .then((status) => {
        if (status.running) startPolling();
      })
      .catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  function startPolling() {
    setScanRunning(true);
    setScanRunError(null);
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchScanStatus();
        if (!status.running) {
          clearInterval(pollRef.current);
          setScanRunning(false);
          if (status.error) setScanRunError(status.error);
          loadDates();
          loadScan();
        }
      } catch {
        // transient — keep polling
      }
    }, 3000);
  }

  async function handleRunScan() {
    setScanRunError(null);
    try {
      await triggerScan();
      startPolling();
    } catch (err) {
      setScanRunError(err.message);
    }
  }

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <span className="brand-mark">Undervault</span>
          <h1>Daily value scanner</h1>
          <p>Quality companies, beaten-down prices — rescanned every close.</p>
        </div>
        <div className="header-controls">
          {scanData?.scan && (
            <div className="stat-row">
              <div className="stat-pill">
                <span className="value">{scanData.scan.universe_size}</span>
                <span className="label">Scanned</span>
              </div>
              <div className="stat-pill">
                <span className="value">{scanData.scan.triggered_count}</span>
                <span className="label">Oversold</span>
              </div>
              <div className="stat-pill">
                <span className="value">{scanData.scan.shortlisted_count}</span>
                <span className="label">Shortlisted</span>
              </div>
            </div>
          )}
          <select
            className="date-select"
            value={selectedDate || ""}
            onChange={(e) => setExpandedTicker(null) || setSelectedDate(e.target.value || null)}
          >
            <option value="">Latest</option>
            {dates.map((d) => (
              <option key={d.scan_date} value={d.scan_date}>
                {d.scan_date}
              </option>
            ))}
          </select>
          <button className="run-scan-btn" onClick={handleRunScan} disabled={scanRunning}>
            {scanRunning ? "Scanning…" : "Run scan now"}
          </button>
        </div>
      </div>

      {scanRunError && <div className="empty-state">Scan run failed — {scanRunError}</div>}
      {loading && <div className="loading-state">Loading scan…</div>}
      {error && <div className="empty-state">Couldn't load scan data — {error}</div>}
      {!loading && !error && scanData === null && (
        <div className="empty-state">
          No scan has run yet. Trigger the cron job from Render's dashboard, or wait for the next scheduled run.
        </div>
      )}
      {!loading && !error && scanData?.results?.length === 0 && (
        <div className="empty-state">No names cleared both filters today.</div>
      )}

      {!loading && !error && scanData?.results?.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="num">Price</th>
              <th className="num">Mkt Cap</th>
              <th className="num">From 52W Low</th>
              <th className="num">Drawdown (3M)</th>
              <th>Quality</th>
              <th className="num">Score</th>
              <th className="num">Streak</th>
            </tr>
          </thead>
          <tbody>
            {scanData.results.map((r) => (
              <React.Fragment key={r.ticker}>
                <tr
                  className="row"
                  onClick={() => setExpandedTicker(expandedTicker === r.ticker ? null : r.ticker)}
                >
                  <td>
                    <div className="ticker-cell">
                      <span className="ticker">{r.ticker}</span>
                      <span className="company-name">{r.company_name}</span>
                    </div>
                  </td>
                  <td className="num">{fmtMoney(r.price)}</td>
                  <td className="num">{fmtMarketCap(r.market_cap)}</td>
                  <td className="num pct-drop">+{fmtPct(r.pct_from_52w_low)}</td>
                  <td className="num pct-drop">-{fmtPct(r.pct_drawdown_3m)}</td>
                  <td>
                    <QualityBar result={r} />
                  </td>
                  <td className="num opportunity-score">{r.opportunity_score}</td>
                  <td className="num">
                    {r.streak_count > 1 ? (
                      <span className="streak-badge" title={`On the shortlist ${r.streak_count} scans in a row`}>
                        🔥 {r.streak_count}
                      </span>
                    ) : (
                      <span className="streak-new">new</span>
                    )}
                  </td>
                </tr>
                {expandedTicker === r.ticker && (
                  <tr className="detail-row">
                    <td colSpan={8}>
                      <DetailPanel result={r} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
