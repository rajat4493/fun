import type { LlmCallTelemetry } from "@/lib/llm";
import type { IntentContract, RecommendRequest, Recommendation } from "@/lib/types";

type ProviderTraceRecord = {
  provider: string;
  durationMs: number;
  ok: boolean;
  promptChars: number;
  error?: string;
  count?: number;
  calls?: LlmCallTelemetry[];
};

type DiagnosticsSummary = {
  source: string;
  providerVerification: string;
  degraded: boolean;
  degradeReason?: string;
  timings: Record<string, number>;
  retryCount: number;
};

type RecommendationDiagnosticsInput = {
  runId: string;
  request: RecommendRequest;
  intentContract: IntentContract;
  recommendation: Recommendation;
  batch: Recommendation[];
  rejections: Array<{ title: string; reasons: string[] }>;
  fallbackUsed: boolean;
  displayState: string;
  diagnostics: DiagnosticsSummary;
  providerTrace: ProviderTraceRecord[];
};

const MAX_STORED_DIAGNOSTICS = 1000;

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
}

function collectPromptText(): boolean {
  return process.env.FUN_COLLECT_PROMPTS === "true";
}

function compactRequest(request: RecommendRequest, includeText: boolean) {
  return {
    mode: request.mode,
    mood: request.mood,
    wants: request.wants,
    avoids: request.avoids,
    time: request.time,
    energy: request.energy,
    country: request.country,
    languagePreferences: request.languagePreferences,
    platforms: request.platforms,
    platformFilter: request.platformFilter,
    discoveryMode: request.discoveryMode,
    craziness: request.craziness,
    recommendationCount: request.recommendationCount,
    responseDetail: request.responseDetail,
    selfText: includeText ? truncate(request.selfText, 4000) : undefined,
    reference: includeText ? truncate(request.reference, 1000) : undefined,
    seenTitles: request.seenTitles?.slice(0, 40),
    recentTitles: request.recentTitles?.slice(0, 12),
    excludedTitleCount: request.excludedTitles?.length ?? 0,
  };
}

function compactRecommendation(recommendation: Recommendation) {
  return {
    title: recommendation.title,
    year: recommendation.year,
    format: recommendation.format,
    runtime: recommendation.runtime,
    vibe: recommendation.vibe,
    confidence: recommendation.confidence,
    oneLine: recommendation.oneLine,
    whyItFits: recommendation.whyItFits,
    parsedIntent: recommendation.parsedIntent,
    contentCategory: recommendation.contentCategory,
    emotionalEffect: recommendation.emotionalEffect,
    availability: {
      status: recommendation.whereToWatch.status,
      primary: recommendation.whereToWatch.primary,
      country: recommendation.whereToWatch.country,
      providers: recommendation.whereToWatch.providers?.map((provider) => ({
        name: provider.name,
        access: provider.access,
        urlKind: provider.urlKind,
      })),
    },
  };
}

function compactProviderTrace(trace: ProviderTraceRecord[], includeText: boolean) {
  return trace.map((item) => ({
    provider: item.provider,
    durationMs: item.durationMs,
    ok: item.ok,
    promptChars: item.promptChars,
    count: item.count,
    error: truncate(item.error, 2000),
    calls: item.calls?.map((call) => ({
      ...call,
      prompt: includeText ? truncate(call.prompt, 30_000) : undefined,
      responseText: includeText ? truncate(call.responseText, 30_000) : undefined,
    })),
  }));
}

export async function writeRecommendationDiagnostics(input: RecommendationDiagnosticsInput): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;

  const includeText = collectPromptText();
  const event = {
    schemaVersion: 1,
    runId: input.runId,
    createdAt: new Date().toISOString(),
    promptCollection: includeText ? "full" : "structured-only",
    request: compactRequest(input.request, includeText),
    intentContract: input.intentContract,
    recommendation: compactRecommendation(input.recommendation),
    batch: input.batch.map(compactRecommendation),
    rejections: input.rejections.slice(0, 40),
    fallbackUsed: input.fallbackUsed,
    displayState: input.displayState,
    diagnostics: input.diagnostics,
    providerTrace: compactProviderTrace(input.providerTrace, includeText),
  };

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  await fetch(`${url}/lpush/fun:recommendation-diagnostics`, {
    method: "POST",
    headers,
    body: JSON.stringify(JSON.stringify(event)),
    signal: AbortSignal.timeout(2000),
  });

  await fetch(`${url}/ltrim/fun:recommendation-diagnostics/0/${MAX_STORED_DIAGNOSTICS - 1}`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(2000),
  });
}
