import { NextResponse } from "next/server";
import { deleteAnonymousProfile } from "@/lib/anonymous-profile-store";

export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { sessionId?: string };
    if (typeof body.sessionId === "string") {
      await deleteAnonymousProfile(body.sessionId);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
