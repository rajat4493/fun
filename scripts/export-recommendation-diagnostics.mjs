import fs from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const requestedLimit = Number(argument("limit", "100"));
const limit = Number.isFinite(requestedLimit)
  ? Math.min(1000, Math.max(1, Math.floor(requestedLimit)))
  : 100;
const output = path.resolve(
  argument(
    "output",
    `fun-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  ),
);

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  throw new Error(
    "Missing Upstash credentials. Set UPSTASH_REDIS_REST_URL and " +
    "UPSTASH_REDIS_REST_TOKEN (or the KV equivalents).",
  );
}

const response = await fetch(
  `${url}/lrange/fun:recommendation-diagnostics/0/${limit - 1}`,
  { headers: { Authorization: `Bearer ${token}` } },
);

if (!response.ok) {
  throw new Error(`Diagnostics export failed with HTTP ${response.status}.`);
}

const body = await response.json();
if (!Array.isArray(body.result)) {
  throw new Error("Diagnostics export returned an unexpected response.");
}

function decodeStoredValue(value) {
  let decoded = value;
  for (let depth = 0; depth < 3 && typeof decoded === "string"; depth += 1) {
    decoded = JSON.parse(decoded);
  }
  return decoded;
}

const diagnostics = body.result.flatMap((value, index) => {
  try {
    const parsed = decodeStoredValue(value);
    // Early diagnostics builds used an extra array wrapper. Accept those records so exports
    // remain readable across the rollout instead of requiring a data migration.
    if (Array.isArray(parsed)) {
      return parsed.map(decodeStoredValue);
    }
    return [parsed];
  } catch {
    console.warn(`Skipping unreadable diagnostics item ${index + 1}.`);
    return [];
  }
});

await fs.writeFile(output, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
console.log(`Exported ${diagnostics.length} recommendation diagnostics to ${output}`);
