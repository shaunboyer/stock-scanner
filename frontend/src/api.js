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

export async function fetchScan(date) {
  const path = date ? `${API_BASE}/scans/${date}` : `${API_BASE}/scans/latest`;
  const res = await fetch(path);
  if (!res.ok) throw new Error("Failed to load scan");
  return res.json();
}
