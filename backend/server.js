import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db/pool.js";
import { runScan } from "./scan/runScan.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// In-memory only (fine for a single-instance free-tier service) — guards
// against overlapping runs if someone double-clicks "Run scan now", and
// gives the frontend something to poll while a run is in progress.
let scanState = { running: false, startedAt: null, finishedAt: null, error: null, result: null };

// List available scan dates, most recent first.
app.get("/api/scans", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT scan_date, universe_size, triggered_count, shortlisted_count
       FROM scans ORDER BY scan_date DESC LIMIT 60`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load scans" });
  }
});

// Shared logic for both "latest" and "specific date" lookups below.
async function sendScanPayload(res, date) {
  try {
    const scanQuery = date
      ? `SELECT * FROM scans WHERE scan_date = $1`
      : `SELECT * FROM scans ORDER BY scan_date DESC LIMIT 1`;
    const scanParams = date ? [date] : [];
    const scanResult = await pool.query(scanQuery, scanParams);

    if (scanResult.rows.length === 0) {
      return res.status(404).json({ error: "No scan found" });
    }
    const scan = scanResult.rows[0];

    const resultsResult = await pool.query(
      `SELECT * FROM scan_results WHERE scan_id = $1 ORDER BY opportunity_score DESC`,
      [scan.id]
    );

    res.json({ scan, results: resultsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load scan" });
  }
}

// NOTE: these are two distinct paths on purpose, not "/api/scans/:date?".
// Express treats "/api/scans/" (trailing slash, no date) as the same route
// as "/api/scans" under its default non-strict routing — since "/api/scans"
// is registered above, it was winning the match and returning the dates
// list instead of a scan payload whenever the frontend asked for "no date
// selected" (i.e. on every normal page load). Splitting into /latest and
// /:date removes the ambiguity.
app.get("/api/scans/latest", (req, res) => sendScanPayload(res, null));
app.get("/api/scans/:date", (req, res) => sendScanPayload(res, req.params.date));

// Manual "run scan now" — fires the scan in the background and returns
// immediately (a full run takes anywhere from several seconds to a couple
// minutes depending on watchlist size, too long to hold an HTTP request
// open reliably). Frontend polls /api/scan/status to know when it's done.
app.post("/api/scan/trigger", (req, res) => {
  if (scanState.running) {
    return res.status(409).json({ error: "A scan is already running", scanState });
  }

  scanState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null, result: null };

  runScan()
    .then((result) => {
      scanState = { ...scanState, running: false, finishedAt: new Date().toISOString(), result };
    })
    .catch((err) => {
      console.error("[scan/trigger] failed:", err);
      scanState = { ...scanState, running: false, finishedAt: new Date().toISOString(), error: err.message };
    });

  res.status(202).json({ started: true, scanState });
});

app.get("/api/scan/status", (req, res) => res.json(scanState));

app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`[server] listening on :${port}`));
