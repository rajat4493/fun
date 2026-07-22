import { getOrCreateSessionId } from "@/lib/recommendation-session";
import type { RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

export function captureRecommendationRun(input: {
  runId: string;
  source: "initial" | "reroll" | "search-all-cinema";
  request: RecommendRequest;
  recommendation: Recommendation;
  batch: Recommendation[];
  displayState?: RecommendationDisplayState;
}) {
  fetch("/api/recommendation-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: getOrCreateSessionId(),
      runId: input.runId,
      source: input.source,
      request: input.request,
      recommendation: input.recommendation,
      batch: input.batch,
      displayState: input.displayState,
      clientCreatedAt: new Date().toISOString(),
    }),
  }).catch(() => {});
}
