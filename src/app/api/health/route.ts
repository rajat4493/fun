import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// A deliberately non-sensitive readiness probe. It verifies the minimum configuration needed to
// protect the paid endpoint without revealing which value is absent to a public caller.
export async function GET() {
  const redisConfigured = Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  );
  const ready = Boolean(
    process.env.OPENAI_API_KEY &&
    redisConfigured &&
    (process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_API_KEY),
  );

  return NextResponse.json(
    { status: ready ? "ok" : "not-ready" },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
