import { NextResponse } from "next/server";
import { filterFalsePositiveRecommendations, localFallback } from "@/lib/fallbacks";
import { recommendWithAnthropic, recommendWithOpenAI } from "@/lib/llm";
import { enrichRecommendation } from "@/lib/metadata";
import { buildRecommendationPrompt } from "@/lib/prompt";
import { RawRecommendation, RecommendRequest, Recommendation } from "@/lib/types";

function hasSubscriptionProvider(recommendation: Recommendation): boolean {
  return recommendation.whereToWatch.status === "verified" &&
    !recommendation.whereToWatch.notOnUserPlatforms &&
    (recommendation.whereToWatch.providers ?? []).some((provider) => provider.access === "subscription");
}

async function getRecommendations(input: RecommendRequest, prompt: string): Promise<RawRecommendation[]> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await recommendWithAnthropic(prompt);
    } catch (error) {
      console.warn("Anthropic failed, trying OpenAI:", error instanceof Error ? error.message : String(error));
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      return await recommendWithOpenAI(prompt);
    } catch (error) {
      console.warn("OpenAI failed, using local fallback:", error instanceof Error ? error.message : String(error));
    }
  }

  return localFallback(input);
}

async function enrichBatch(
  batch: RawRecommendation[],
  country: string,
  platforms: string[],
): Promise<Recommendation[]> {
  return Promise.all(batch.map((pick) => enrichRecommendation(pick, country, platforms)));
}

async function verifiedSubscriptionBatch(
  batch: RawRecommendation[],
  input: RecommendRequest,
  country: string,
): Promise<Recommendation[]> {
  const platforms = input.platforms ?? [];
  const enriched = await enrichBatch(batch, country, platforms);
  const verified = enriched.filter(hasSubscriptionProvider);
  if (verified.length > 0) return verified;

  const fallback = await enrichBatch(localFallback(input), country, platforms);
  return fallback.filter(hasSubscriptionProvider);
}

function unavailableSubscriptionFallback(
  recommendation: Recommendation,
  country: string,
): Recommendation {
  return {
    ...recommendation,
    whereToWatch: {
      status: "unverified",
      primary: "No verified match inside your subscriptions yet",
      note: "Try another mood or search beyond your subscriptions.",
      providers: [],
      country,
      notOnUserPlatforms: false,
    },
  };
}

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as RecommendRequest;
    const country = input.country || "Poland";
    const platforms = input.platforms ?? [];
    const prompt = buildRecommendationPrompt(input);
    const rawBatch = await getRecommendations(input, prompt);

    let normalizedBatch = filterFalsePositiveRecommendations(input, rawBatch).slice(0, 3);
    if (normalizedBatch.length < 3) {
      console.warn(`Expected 3 recommendations, got ${normalizedBatch.length}`);
    }
    if (normalizedBatch.length === 0) {
      normalizedBatch = localFallback(input).slice(0, 3);
    }

    let enrichedBatch = input.platformFilter === "mine"
      ? await verifiedSubscriptionBatch(normalizedBatch, input, country)
      : await enrichBatch(normalizedBatch, country, platforms);

    if (enrichedBatch.length === 0 && normalizedBatch[0]) {
      const fallback = await enrichRecommendation(normalizedBatch[0], country, platforms);
      enrichedBatch = [unavailableSubscriptionFallback(fallback, country)];
    }

    const firstPick = enrichedBatch[0];
    return NextResponse.json({
      ...firstPick,
      _batch: enrichedBatch,
      _batchIndex: 0,
    });
  } catch (error) {
    console.error("Recommendation route failed:", error);
    return NextResponse.json(
      { error: "Recommendation failed. Check API keys or model output." },
      { status: 500 },
    );
  }
}
