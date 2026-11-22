// Server-owned provenance: never trust a browser-supplied environment label.
export function learningProvenance() {
  const environment = process.env.VERCEL_ENV === "production" ? "production"
    : process.env.VERCEL_ENV === "preview" ? "preview" : "local";
  return { environment, deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null };
}

// Call inside after(). Do not blindly retry LPUSH: a timed-out write may have succeeded.
export async function writeLearningRecord(key: string, event: object, timeoutMs = 2000, limit?: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn("[FUN learning write skipped]", { key, ...learningProvenance(), reason: "storage-not-configured" });
    return;
  }
  const commands: Array<Array<string | number>> = [
    ["LPUSH", key, JSON.stringify({ ...event, ...learningProvenance() })],
  ];
  if (limit !== undefined) commands.push(["LTRIM", key, 0, limit - 1]);
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("HTTP rejection");
    const results = await response.json() as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(results) || results.length !== commands.length ||
      results.some((item) => !item || item.error || !("result" in item)) ||
      !Number.isInteger(results[0].result) || Number(results[0].result) < 1) {
      throw new Error("Command rejection");
    }
  } catch {
    // Never include prompts, session IDs, credentials or provider response bodies.
    console.warn("[FUN learning write failed]", { key, ...learningProvenance() });
    throw new Error("Learning storage write failed");
  }
}
