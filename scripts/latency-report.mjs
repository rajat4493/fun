import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function summarizeLatency(records, environment) {
  const events = records.flatMap((raw) => {
    try {
      const e = typeof raw === "string" ? JSON.parse(raw) : raw;
      // Historical records have no trustworthy environment; never infer production.
      if (environment && e.environment !== environment) return [];
      const diagnostics = e.diagnostics ?? e;
      const timings = diagnostics.timings;
      if (!Number.isFinite(timings?.totalMs) || timings.totalMs < 0) return [];
      return [{
        date: e.createdAt,
        count: e.recommendationCount ?? e.request?.recommendationCount,
        platformFilter: e.platformFilter ?? e.request?.platformFilter,
        retries: diagnostics.retryCount,
        timings,
        outcome: e.outcome ?? "success",
      }];
    } catch { return []; }
  });
  const stats = (values) => {
    const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
    const percentile = (p) => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]) : null;
    return { samples: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95) };
  };
  const groups = {
    all: events,
    successful: events.filter((e) => e.outcome === "success"),
    noMatch: events.filter((e) => e.outcome === "no-match"),
    singlePick: events.filter((e) => e.count === 1),
    backgroundTwoPicks: events.filter((e) => e.count === 2),
    subscriptions: events.filter((e) => e.platformFilter === "mine"),
    unrestricted: events.filter((e) => e.platformFilter === "any"),
    withRetries: events.filter((e) => e.retries > 0),
    withoutRetries: events.filter((e) => e.retries === 0),
  };
  const dates = events.map((e) => e.date).filter((s) => typeof s === "string" && Number.isFinite(Date.parse(s))).sort();
  return {
    recordsRead: records.length,
    environmentFilter: environment ?? "all-including-unattributed",
    timedRecords: events.length,
    dateFrom: dates[0] ?? null,
    dateTo: dates.at(-1) ?? null,
    groups: Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, {
      total: stats(group.map((e) => e.timings.totalMs)),
      intent: stats(group.map((e) => e.timings.intentMs)),
      generation: stats(group.map((e) => e.timings.recommendationMs)),
      verification: stats(group.map((e) => e.timings.verificationMs)),
    }])),
    note: "Server timings, with successful and no-match requests separated; excludes browser rendering and unrecorded failures. Historical samples do not establish current production latency. Missing timings are not counted as zero.",
  };
}

async function main() {
  const args = process.argv.slice(2);
  let environment;
  const environmentIndex = args.indexOf("--environment");
  if (environmentIndex !== -1) {
    environment = args[environmentIndex + 1];
    if (!["local", "preview", "production"].includes(environment)) throw new Error("Environment must be local, preview or production");
    args.splice(environmentIndex, 2);
  }
  let records;
  if (args[0] === "--file" && args[1]) {
    records = JSON.parse(readFileSync(args[1], "utf8"));
  } else if (args.length === 1 && args[0] === "--redis") {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("Redis configuration missing. Use a local export with --file instead.");
    const response = await fetch(`${url}/lrange/fun%3Arecommendation-diagnostics/0/2999`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Diagnostics read failed (${response.status})`);
    const body = await response.json();
    if (body.error) throw new Error("Redis rejected diagnostics read");
    records = body.result;
  } else {
    throw new Error("Usage: npm run latency:report -- --file <export.json> OR --redis (one read, no writes). No provider calls are made.");
  }
  if (!Array.isArray(records)) throw new Error("Expected an array of diagnostics events");
  console.log(JSON.stringify(summarizeLatency(records, environment), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
