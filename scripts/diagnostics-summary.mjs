// Reads real persisted diagnostics (src/lib/recommendation-diagnostics-store.ts) and prints trend
// summaries — replaces needing an ad-hoc audit script every time "is it getting better or worse"
// comes up. Run with: npm run diagnostics:summary (loads .env.local for Redis credentials).

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error("Missing KV_REST_API_URL/TOKEN — cannot reach Redis.");
  process.exit(1);
}

async function lrange(key, start, stop) {
  const res = await fetch(`${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result ?? [];
}

const raw = await lrange("fun:recommendation-diagnostics", 0, 2999);
console.log(`Fetched ${raw.length} diagnostics events.\n`);

if (raw.length === 0) {
  console.log("No events yet — make a few real requests against the app first.");
  process.exit(0);
}

const events = raw.map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}).filter(Boolean);

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const totalMs = events.map((e) => e.timings?.totalMs ?? 0);
const intentMs = events.map((e) => e.timings?.intentMs ?? 0);
const recommendationMs = events.map((e) => e.timings?.recommendationMs ?? 0);
const verificationMs = events.map((e) => e.timings?.verificationMs ?? 0);

console.log("--- Timings (ms) ---");
console.log(`total:          avg=${avg(totalMs).toFixed(0)}  median=${median(totalMs)}`);
console.log(`intent:         avg=${avg(intentMs).toFixed(0)}  median=${median(intentMs)}`);
console.log(`recommendation: avg=${avg(recommendationMs).toFixed(0)}  median=${median(recommendationMs)}`);
console.log(`verification:   avg=${avg(verificationMs).toFixed(0)}  median=${median(verificationMs)}`);

const degradedCount = events.filter((e) => e.degraded).length;
console.log(`\n--- Degrade rate ---`);
console.log(`${degradedCount}/${events.length} (${((degradedCount / events.length) * 100).toFixed(1)}%) requests degraded`);

const degradeReasons = {};
for (const e of events) {
  if (!e.degradeReason) continue;
  degradeReasons[e.degradeReason] = (degradeReasons[e.degradeReason] ?? 0) + 1;
}
console.log("Breakdown:", JSON.stringify(degradeReasons, null, 2));

const sourceCounts = {};
for (const e of events) {
  sourceCounts[e.source] = (sourceCounts[e.source] ?? 0) + 1;
}
console.log(`\n--- Source distribution ---`);
console.log(JSON.stringify(sourceCounts, null, 2));

const rejectionCounts = events.map((e) => e.rejectionCount ?? 0);
const withRejections = rejectionCounts.filter((c) => c > 0).length;
console.log(`\n--- Rejections ---`);
console.log(`avg rejectionCount=${avg(rejectionCounts).toFixed(2)}  requests with 1+ rejection: ${withRejections}/${events.length}`);

const distinctSessions = new Set(events.map((e) => e.sessionId).filter(Boolean));
console.log(`\n--- Volume ---`);
console.log(`${events.length} events across ${distinctSessions.size} distinct sessions`);
