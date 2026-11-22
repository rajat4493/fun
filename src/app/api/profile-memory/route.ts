import { NextResponse } from "next/server";
import { deleteAnonymousProfile } from "@/lib/anonymous-profile-store";

export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { sessionId?: string };
    if (!body || typeof body.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(body.sessionId) || ["unknown", "ssr"].includes(body.sessionId)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    await deleteAnonymousProfile(body.sessionId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not clear server memory. Please try again." }, { status: 503 });
  }
}
