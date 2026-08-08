import { NextResponse } from "next/server";
import { callerIp, grantDailyUnlock } from "@/lib/rate-limit";
import { isPlaceholderEmailDomain, upsertSubscriber } from "@/lib/subscriber-store";

// Growth lever, not a security boundary: once someone hits the daily free limit, leaving an email
// raises their ceiling for the rest of the day. Keyed by the same IP the rate limiter uses, so the
// bonus applies immediately without the client needing to retry with a new identifier.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email : "";

    // No real verification exists yet (would need an email provider this project doesn't have
    // configured) — this only blocks the zero-effort placeholder case, not a determined abuser.
    if (isPlaceholderEmailDomain(email)) {
      return NextResponse.json({ error: "Please use a real email address." }, { status: 400 });
    }

    const stored = await upsertSubscriber(email, { dailyUnlockGrantedAt: new Date().toISOString() });
    if (!stored) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    await grantDailyUnlock(callerIp(req));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 400 });
  }
}
