import { NextResponse } from "next/server";
import { upsertSubscriber } from "@/lib/subscriber-store";

// Low-key "interested in F.U.N Premium" capture from the Memory page — registers intent only.
// No payment processing exists yet; this just marks subscriptionStatus "pending" so a future
// Stripe integration has a list to convert instead of starting from zero.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email : "";

    const stored = await upsertSubscriber(email, { subscriptionStatus: "pending" });
    if (!stored) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 400 });
  }
}
