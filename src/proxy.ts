import { NextResponse, type NextRequest } from "next/server";

export const config = {
  matcher: ["/api/:path*"],
};

// Not real auth — just a same-origin check to keep the API from being casually called directly
// (curl, scripts, other sites embedding a fetch) in the first live version. A determined actor can
// still spoof Origin/Referer; real hardening would need accounts/API keys, which this stateless MVP
// doesn't have. Requests with neither header fail open, since some legitimate same-origin requests
// can omit both.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const sourceHost = origin
    ? safeHost(origin)
    : referer
      ? safeHost(referer)
      : null;

  if (sourceHost && sourceHost !== host) {
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  }

  return NextResponse.next();
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
