// Prefer VITE_API_HOST (resolved dynamically by Render via `fromService` in
// render.yaml — see there for why). Fall back to an explicit VITE_API_BASE
// for local overrides, then to a same-origin "/api" for local dev (proxied
// by vite.config.js).
const API_HOST = import.meta.env.VITE_API_HOST;
const API_BASE = API_HOST ? `https://${API_HOST}/api` : import.meta.env.VITE_API_BASE || "/api";

export async function fetchScanDates() {
  const res = await fetch(`${API_BASE}/scans`);
  if (!res.ok) throw new Error("Failed to load scan dates");
  return res.json();
}

export async function fetchScan(date) {
  const path = date ? `${API_BASE}/scans/${date}` : `${API_BASE}/scans/`;
  const res = await fetch(path);
  if (!res.ok) throw new Error("Failed to load scan");
  return res.json();
}
