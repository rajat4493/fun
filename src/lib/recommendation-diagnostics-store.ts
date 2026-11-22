import { writeLearningRecord } from "@/lib/learning-storage";
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
  recommendationCount?: number;
  platformFilter?: string;
  responseDetail?: string;
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
  outcome?: "success" | "no-match";
  rejectionReasons?: Record<string, number>;
};

// Fixed categories only: never copy provider output, raw prompts or candidate titles.
export function summarizeRejectionReasons(rejections: Array<{ reasons: string[] }>): Record<string, number> {
  const counts: Record<string, number> = {};
  const exact = new Set(["excluded title", "horror excluded", "language not verified", "requested language mismatch", "excluded language", "animation not verified", "family rating not verified", "film requested", "series requested", "subscription match not verified", "explicit content exclusion"]);
  for (const rejection of rejections) for (const reason of new Set(rejection.reasons)) {
    const category = exact.has(reason) ? reason : reason.startsWith("avoidance:") ? "content avoidance"
      : /^(parsedIntent:|intent:)/.test(reason) ? "intent mismatch"
      : reason === "batch: duplicate title" ? "duplicate title" : "other trust rejection";
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

const MAX_STORED_DIAGNOSTICS = 3000;

export async function writeRecommendationDiagnostics(event: RecommendationDiagnosticsEvent): Promise<void> {
  try {
    if (process.env.VERCEL_ENV === "preview" && event.outcome === "no-match") {
      // Preview storage is disconnected. Never log the event object: it has identity fields.
      const reasons: Record<string, number> = {};
      for (const [reason, count] of Object.entries(event.rejectionReasons ?? {})) {
        const safeReason = ["content avoidance", "intent mismatch", "duplicate title", "other trust rejection"].includes(reason)
          ? reason : Object.keys(summarizeRejectionReasons([{ reasons: [reason] }]))[0];
        if (Number.isFinite(count) && count > 0) reasons[safeReason] = (reasons[safeReason] ?? 0) + Math.min(1000, Math.floor(count));
      }
      console.warn("[FUN preview no-match]", {
        outcome: "no-match",
        totalMs: Number.isFinite(event.timings.totalMs) ? event.timings.totalMs : null,
        rejectionReasons: reasons,
      });
    }
    await writeLearningRecord("fun:recommendation-diagnostics", event, 2000, MAX_STORED_DIAGNOSTICS);
  } catch {
    // Fail open — diagnostics must never affect the user-facing response.
  }
}
