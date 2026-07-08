/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 * Simple replacement for the p-limit package so we don't add a dependency.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = { error: err.message || String(err) };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}
