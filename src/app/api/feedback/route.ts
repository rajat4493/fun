import { NextResponse } from "next/server";

type FeedbackEvent = {
  sessionId: string;
  runId?: string;
  reason: string;
  phase?: string;
  title: string;
  year: string;
  format: string;
  country?: string;
  mood?: string[];
  wants?: string[];
  avoids?: string[];
  languagePreferences?: string[];
  craziness?: number;
  platformFilter?: string;
  contextHint?: string;
  confidence?: number;
  batchIndex?: number;
  batchSize?: number;
  receivedAt: string;
};

async function writeToKv(event: FeedbackEvent): Promise<void> {
  // Upstash Redis (marketplace) or legacy Vercel KV env var names
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.log("[FUN feedback]", JSON.stringify(event));
    return;
  }
  await fetch(`${url}/lpush/fun:feedback`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([JSON.stringify(event)]),
    signal: AbortSignal.timeout(3000),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Omit<FeedbackEvent, "receivedAt">;

    const event: FeedbackEvent = {
      sessionId: body.sessionId ?? "unknown",
      runId: body.runId,
      reason: body.reason ?? "unknown",
      phase: body.phase,
      title: body.title ?? "",
      year: body.year ?? "",
      format: body.format ?? "",
      country: body.country,
      mood: body.mood,
      wants: body.wants,
      avoids: body.avoids,
      languagePreferences: body.languagePreferences,
      craziness: body.craziness,
      platformFilter: body.platformFilter,
      contextHint: body.contextHint,
      confidence: body.confidence,
      batchIndex: body.batchIndex,
      batchSize: body.batchSize,
      receivedAt: new Date().toISOString(),
    };

    // Fire-and-forget — don't hold the response for storage
    writeToKv(event).catch((err) => console.warn("[FUN feedback write failed]", err));

    return NextResponse.json({ ok: true });
  } catch {
    // Never surface analytics errors to the client
    return NextResponse.json({ ok: true });
  }
}
