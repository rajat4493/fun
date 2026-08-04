// Server-side, purely additive recommendation diagnostics — replaces needing an ad-hoc audit
// script every time "is it getting better or worse" comes up. A near-identical feature existed
// before (commit b40014b) but got swept into a 1210-line wholesale revert (e0a7ee0) alongside
// unrelated recommendation-logic changes it had gotten invasively threaded through (127 lines added
// to llm.ts itself). It also had the same double-encoded Redis write bug fixed elsewhere in this
// codebase this session. This version is deliberately isolated: one file, one call site in
// route.ts, zero changes to llm.ts/prompt.ts/intent-contract.ts/recommendation-trust.ts, and uses
// the proven /pipeline command-array write pattern (see anonymous-profile-store.ts, rate-limit.ts).
// Metrics only — no prompt/response text — this is for trend analysis, not archaeology.

export type RecommendationDiagnosticsEvent = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  sessionId?: string;
  mode: string;
  country?: string;
  title: string;
  year: string;
  confidence?: number;
  displayState: string;
  fallbackUsed: boolean;
  source: string;
  degraded: boolean;
  degradeReason?: string;
  timings: Record<string, number>;
  retryCount: number;
  rejectionCount: number;
};

const MAX_STORED_DIAGNOSTICS = 3000;

function credentials() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  };
}

export async function writeRecommendationDiagnostics(event: RecommendationDiagnosticsEvent): Promise<void> {
  const { url, token } = credentials();
  if (!url || !token) return;
  try {
    await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["LPUSH", "fun:recommendation-diagnostics", JSON.stringify(event)],
        ["LTRIM", "fun:recommendation-diagnostics", 0, MAX_STORED_DIAGNOSTICS - 1],
      ]),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Fail open — diagnostics must never affect the user-facing response.
  }
}
