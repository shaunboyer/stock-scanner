// Prefer VITE_API_HOST (resolved dynamically by Render via `fromService` in
// render.yaml — see there for why). Fall back to an explicit VITE_API_BASE
// for local overrides, then to a same-origin "/api" for local dev (proxied
// by vite.config.js).
// NOTE: Render's `fromService: property: host` returns only the subdomain
// slug (e.g. "stock-scanner-api-q57g"), not the full hostname — ".onrender.com"
// has to be appended here. (This was missing before and broke the live fetch.)
const API_HOST = import.meta.env.VITE_API_HOST;
const API_BASE = API_HOST ? `https://${API_HOST}.onrender.com/api` : import.meta.env.VITE_API_BASE || "/api";

export async function fetchScanDates() {
  const res = await fetch(`${API_BASE}/scans`);
  if (!res.ok) throw new Error("Failed to load scan dates");
  return res.json();
}

// Returns null if no scan exists yet (a normal, expected state before the
// cron job's first run) rather than throwing — the caller distinguishes
// "no data yet" from a real fetch failure.
export async function fetchScan(date) {
  const path = date ? `${API_BASE}/scans/${date}` : `${API_BASE}/scans/latest`;
  const res = await fetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load scan");
  return res.json();
}

// Kicks off a scan in the background; the API responds as soon as it starts
// (202), not when it finishes — poll fetchScanStatus() to know when it's done.
// Throws with the server's message on a 409 (already running).
export async function triggerScan() {
  const res = await fetch(`${API_BASE}/scan/trigger`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to start scan");
  return body;
}

export async function fetchScanStatus() {
  const res = await fetch(`${API_BASE}/scan/status`);
  if (!res.ok) throw new Error("Failed to load scan status");
  return res.json();
}
