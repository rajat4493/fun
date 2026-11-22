// Resolves the Upstash REST credentials from the environment.
//
// Vercel's Upstash integration names its variables after an optional per-connection prefix
// (e.g. FUN_FEEDBACK_KV_REST_API_URL), and reconnecting a store can change that prefix. Rather than
// requiring hand-copied duplicates, accept the standard names first and then any single prefixed
// KV_REST_API_URL/KV_REST_API_TOKEN pair.
export type RedisRestConfig = { url: string; token: string };

export function redisRestConfig(env: Record<string, string | undefined> = process.env): RedisRestConfig | null {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  }
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
  }
  // Sorted so the choice is deterministic if more than one prefixed store is connected.
  const prefixes = Object.keys(env)
    .filter((key) => key.endsWith("_KV_REST_API_URL"))
    .map((key) => key.slice(0, -"KV_REST_API_URL".length))
    .sort();
  for (const prefix of prefixes) {
    const url = env[`${prefix}KV_REST_API_URL`];
    const token = env[`${prefix}KV_REST_API_TOKEN`];
    if (url && token) return { url, token };
  }
  return null;
}
