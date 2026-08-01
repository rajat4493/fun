// Cost/abuse safety net for the public /api/recommend endpoint — every request triggers a real
// paid LLM call, so an unthrottled endpoint is a direct billing and availability risk. Framed as
// "the free tier" ceiling: keyed by IP (server-trusted, unlike a client-generated sessionId that
// resets when localStorage is cleared) so a later paid tier can simply grant a higher/removed
// ceiling for a known identifier instead of a different mechanism.
//
// Reuses the same Upstash REST pipeline pattern as src/lib/anonymous-profile-store.ts (raw
// fetch(), no @upstash/ratelimit SDK) and fails open on Redis/network trouble — a rate limiter
// that itself takes the app down when Redis hiccups is worse than the risk it guards against.

const BURST_LIMIT = 5;
const BURST_WINDOW_SECONDS = 60;
const SUSTAINED_LIMIT = 20;
const SUSTAINED_WINDOW_SECONDS = 3600;

export type RateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

function credentials() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  };
}

export function callerIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function incrementAndCheck(key: string, windowSeconds: number, limit: number): Promise<{ count: number } | null> {
  const { url, token } = credentials();
  if (!url || !token) return null;

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, windowSeconds, "NX"],
    ]),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Rate limit check failed (${response.status})`);

  const [incrResult] = (await response.json()) as Array<{ result: number }>;
  return { count: incrResult.result };
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  // Dev/local and production share the same Upstash instance (see anonymous-profile-store.ts) —
  // without this, running the QA gate/regression suites against a local dev server would burn
  // through the same budget real production traffic uses, and could self-lock the dev server for
  // up to an hour once the sustained window's EXPIRE NX is set.
  if (process.env.NODE_ENV !== "production") return { limited: false };
  if (!ip || ip === "unknown") return { limited: false };

  try {
    const burst = await incrementAndCheck(`fun:ratelimit:burst:${ip}`, BURST_WINDOW_SECONDS, BURST_LIMIT);
    if (burst && burst.count > BURST_LIMIT) return { limited: true, retryAfterSeconds: BURST_WINDOW_SECONDS };

    const sustained = await incrementAndCheck(`fun:ratelimit:sustained:${ip}`, SUSTAINED_WINDOW_SECONDS, SUSTAINED_LIMIT);
    if (sustained && sustained.count > SUSTAINED_LIMIT) return { limited: true, retryAfterSeconds: SUSTAINED_WINDOW_SECONDS };

    return { limited: false };
  } catch {
    // Fail open: a Redis outage should never take down recommendations for real users.
    return { limited: false };
  }
}
