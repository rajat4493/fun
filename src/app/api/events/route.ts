import { writeLearningRecord } from "@/lib/learning-storage";
import { after, NextResponse } from "next/server";

type FunEvent = {
  sessionId?: string;
  type?: "ask" | "recommendation" | "feedback" | "watch-click" | "streaming-fit";
  payload?: Record<string, unknown>;
  receivedAt: string;
};

async function writeToKv(event: FunEvent): Promise<void> {
  await writeLearningRecord("fun:events", event);
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

    after(async () => {
      try {
        await writeToKv(event);
      } catch (error) {
        console.warn("[FUN event write failed]", error);
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
