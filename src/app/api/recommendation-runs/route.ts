import { after, NextResponse } from "next/server";
import type { RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";
import { appendProfileRecommendation } from "@/lib/anonymous-profile-store";

type RecommendationRunBody = {
  sessionId?: string;
  runId?: string;
  source?: "initial" | "reroll" | "search-all-cinema" | string;
  request?: RecommendRequest;
  recommendation?: Recommendation;
  batch?: Recommendation[];
  displayState?: RecommendationDisplayState;
  clientCreatedAt?: string;
};

type RecommendationRunEvent = {
  sessionId: string;
  runId: string;
  source: string;
  request: CompactRequest;
  recommendation: ReturnType<typeof compactRecommendation> | null;
  batch: ReturnType<typeof compactRecommendation>[];
  displayState?: RecommendationDisplayState;
  promptCollection: "full" | "structured-only";
  clientCreatedAt?: string;
  receivedAt: string;
};

type CompactRequest = Partial<RecommendRequest> & {
  exclusionSnapshot?: {
    count: number;
    recentSample: string[];
    fingerprint: string;
  };
};

function truncate(value: string | undefined, max = 2000): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function shouldCollectPrompts(): boolean {
  return process.env.FUN_COLLECT_PROMPTS === "true";
}

function exclusionFingerprint(titles: string[]): string {
  const canonical = [...new Set(titles
    .map((title) => title.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " "))
    .filter(Boolean))]
    .sort()
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compactRequest(request: RecommendRequest | undefined, includePromptText: boolean): CompactRequest {
  if (!request) return {};
  const excludedTitles = request.excludedTitles?.slice(0, 200) ?? [];
  return {
    mode: request.mode,
    mood: request.mood,
    wants: request.wants,
    avoids: request.avoids,
    time: request.time,
    energy: request.energy,
    viewingContext: request.viewingContext,
    country: request.country,
    languagePreferences: request.languagePreferences,
    platforms: request.platforms,
    selfText: includePromptText ? truncate(request.selfText) : undefined,
    reference: includePromptText ? truncate(request.reference) : undefined,
    platformFilter: request.platformFilter,
    discoveryMode: request.discoveryMode,
    contextHint: request.contextHint,
    craziness: request.craziness,
    seenTitles: request.seenTitles?.slice(0, 40),
    recentTitles: request.recentTitles?.slice(0, 8),
    exclusionSnapshot: {
      count: excludedTitles.length,
      recentSample: excludedTitles.slice(0, 20),
      fingerprint: exclusionFingerprint(excludedTitles),
    },
    feedbackContext: request.feedbackContext,
  };
}

function compactRecommendation(recommendation: Recommendation | undefined) {
  if (!recommendation) return null;
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
      notOnUserPlatforms: recommendation.whereToWatch.notOnUserPlatforms,
      providers: recommendation.whereToWatch.providers?.map((provider) => ({
        name: provider.name,
        access: provider.access,
        urlKind: provider.urlKind,
      })),
      country: recommendation.whereToWatch.country,
      verifiedAt: recommendation.whereToWatch.verifiedAt,
    },
    hiddenLayer: {
      headline: recommendation.hiddenLayer.headline,
      insight: recommendation.hiddenLayer.insight,
      titles: recommendation.hiddenLayer.titles?.map((item) => ({ title: item.title, year: item.year, platform: item.platform })),
    },
    alternatives: recommendation.alternatives,
  };
}

async function writeToKv(event: RecommendationRunEvent): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.log("[FUN recommendation run]", JSON.stringify(event));
    return;
  }

  await fetch(`${url}/lpush/fun:recommendation-runs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([JSON.stringify(event)]),
    signal: AbortSignal.timeout(2000),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as RecommendationRunBody;
    const includePromptText = shouldCollectPrompts();
    const compactBatch = (body.batch ?? []).map(compactRecommendation).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const primary = compactRecommendation(body.recommendation);

    const event: RecommendationRunEvent = {
      sessionId: typeof body.sessionId === "string" ? body.sessionId : "unknown",
      runId: typeof body.runId === "string" ? body.runId : `run-${Date.now().toString(36)}`,
      source: typeof body.source === "string" ? body.source : "unknown",
      request: compactRequest(body.request, includePromptText),
      recommendation: primary,
      batch: compactBatch,
      displayState: body.displayState,
      promptCollection: includePromptText ? "full" : "structured-only",
      clientCreatedAt: typeof body.clientCreatedAt === "string" ? body.clientCreatedAt : undefined,
      receivedAt: new Date().toISOString(),
    };

    after(async () => {
      try {
        await Promise.all([
          writeToKv(event),
          primary ? appendProfileRecommendation(event.sessionId, {
            runId: event.runId,
            source: event.source,
            title: primary.title,
            year: primary.year,
            format: primary.format,
            confidence: primary.confidence,
            displayState: event.displayState,
            createdAt: event.receivedAt,
          }) : Promise.resolve(),
        ]);
      } catch (error) {
        console.warn("[FUN recommendation run write failed]", error);
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
