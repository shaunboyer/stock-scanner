import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db/pool.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`[server] listening on :${port}`));
