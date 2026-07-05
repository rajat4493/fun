import { NextResponse } from "next/server";

type FunEvent = {
  sessionId?: string;
  type?: "ask" | "recommendation" | "feedback" | "watch-click" | "streaming-fit";
  payload?: Record<string, unknown>;
  receivedAt: string;
};

async function writeToKv(event: FunEvent): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.log("[FUN event]", JSON.stringify(event));
    return;
  }

  await fetch(`${url}/lpush/fun:events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([JSON.stringify(event)]),
    signal: AbortSignal.timeout(3000),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Omit<FunEvent, "receivedAt">;
    const event: FunEvent = {
      sessionId: typeof body.sessionId === "string" ? body.sessionId : "unknown",
      type: body.type,
      payload: body.payload && typeof body.payload === "object" ? body.payload : {},
      receivedAt: new Date().toISOString(),
    };

    writeToKv(event).catch((error) => console.warn("[FUN event write failed]", error));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
