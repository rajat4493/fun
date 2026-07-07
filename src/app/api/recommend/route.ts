import { NextResponse } from "next/server";
import { filterFalsePositiveRecommendations, localFallback } from "@/lib/fallbacks";
import { recommendWithAnthropic, recommendWithOpenAI } from "@/lib/llm";
import { enrichRecommendation } from "@/lib/metadata";
import { buildRecommendationPrompt } from "@/lib/prompt";
import { applyTrustFilter, rejectionPrompt, safeFallback, TrustRejection } from "@/lib/recommendation-trust";
import { RawRecommendation, RecommendRequest, Recommendation } from "@/lib/types";

function hasSubscriptionProvider(recommendation: Recommendation): boolean {
  return recommendation.whereToWatch.status === "verified" &&
    !recommendation.whereToWatch.notOnUserPlatforms &&
    (recommendation.whereToWatch.providers ?? []).some((provider) => provider.access === "subscription");
}

function wantsHindi(input: RecommendRequest): boolean {
  const text = [input.selfText, input.reference, ...(input.languagePreferences ?? [])].filter(Boolean).join(" ");
  return /\bhindi\b/i.test(text);
}

function shouldUseCuratedReferenceFallback(input: RecommendRequest): boolean {
  if (!wantsHindi(input)) return false;
  const text = [input.selfText, input.reference].filter(Boolean).join(" ");
  return /\b(friends|shameless)\b/i.test(text);
}

function matchesLanguageRequest(input: RecommendRequest, recommendation: Recommendation): boolean {
  if (!wantsHindi(input)) return true;
  const metadata = recommendation.contentMetadata;
  if (metadata?.originalLanguage === "hi") return true;
  if (metadata?.originCountry?.includes("IN")) return true;
  // If TMDB had no data, give the pick benefit of the doubt; don't reject a valid Hindi title just because TMDB lookup failed.
  if (!metadata?.originalLanguage && !metadata?.originCountry?.length) return true;
  // TMDB found it and confirmed it's non-Indian.
  return false;
}

function llmTemperature(input: RecommendRequest): number {
  return input.craziness === 3 ? 1 : 0.85;
}

// CHANGED: OpenAI is now primary, Anthropic is fallback. Anthropic key is optional — add it
// to .env.local when budget allows for better recommendation quality.
async function getRecommendations(input: RecommendRequest, prompt: string): Promise<RawRecommendation[]> {
  const temperature = llmTemperature(input);

  if (process.env.OPENAI_API_KEY) {
    try {
      return await recommendWithOpenAI(prompt, temperature);
    } catch (error) {
      console.warn("OpenAI failed, trying Anthropic:", error instanceof Error ? error.message : String(error));
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await recommendWithAnthropic(prompt, temperature);
    } catch (error) {
      console.warn("Anthropic failed, using local fallback:", error instanceof Error ? error.message : String(error));
    }
  }

  return filteredLocalFallback(input);
}

function filteredLocalFallback(input: RecommendRequest): RawRecommendation[] {
  const filtered = filterFalsePositiveRecommendations(input, localFallback(input));
  return filtered.length > 0 ? filtered : [];
}

// NEW: Trust filter with retry loop. If all picks are rejected (wrong language, seen titles, etc.)
// the prompt is extended with a rejection note and the LLM gets one more attempt before
// falling back to local curated picks.
async function trustedRawBatch(input: RecommendRequest, basePrompt: string): Promise<{
  batch: RawRecommendation[];
  rejections: TrustRejection[];
}> {
  const allRejections: TrustRejection[] = [];
  let prompt = basePrompt;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rawBatch = await getRecommendations(input, prompt);
    let normalizedBatch = filterFalsePositiveRecommendations(input, rawBatch).slice(0, 3);

    if (shouldUseCuratedReferenceFallback(input)) {
      normalizedBatch = filteredLocalFallback(input).slice(0, 3);
    }

    const trusted = applyTrustFilter(input, normalizedBatch);
    allRejections.push(...trusted.rejected);
    if (trusted.accepted.length > 0) {
      return { batch: trusted.accepted.slice(0, 3), rejections: allRejections };
    }

    prompt = `${basePrompt}${rejectionPrompt(allRejections)}`;
  }

  const localTrusted = applyTrustFilter(input, filteredLocalFallback(input));
  allRejections.push(...localTrusted.rejected);
  if (localTrusted.accepted.length > 0) {
    return { batch: localTrusted.accepted.slice(0, 3), rejections: allRejections };
  }

  return { batch: [safeFallback(input)], rejections: allRejections };
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

  const fallback = await enrichBatch(filteredLocalFallback(input), country, platforms);
  const verifiedFallback = fallback.filter(hasSubscriptionProvider);
  if (verifiedFallback.length > 0) return verifiedFallback;

  // Do not collapse to the same safe title just because subscription availability
  // could not be verified. Keep the trusted recommendation and let the UI state
  // clearly say that availability is not verified inside the user's apps yet.
  return enriched.length > 0 ? enriched.map((item) => unavailableSubscriptionFallback(item, country)) : [];
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
    const trustedRaw = await trustedRawBatch(input, prompt);
    let normalizedBatch = trustedRaw.batch;

    let enrichedBatch = input.platformFilter === "mine"
      ? await verifiedSubscriptionBatch(normalizedBatch, input, country)
      : await enrichBatch(normalizedBatch, country, platforms);

    const trustedEnriched = applyTrustFilter(input, enrichedBatch);
    if (trustedEnriched.rejected.length > 0) {
      console.warn("[FUN trust filter rejected enriched picks]", JSON.stringify(trustedEnriched.rejected));
    }
    enrichedBatch = trustedEnriched.accepted;

    const languageMatchedBatch = enrichedBatch.filter((recommendation) => matchesLanguageRequest(input, recommendation));
    if (languageMatchedBatch.length > 0) {
      enrichedBatch = languageMatchedBatch;
    } else if (wantsHindi(input)) {
      const fallback = await enrichBatch(filteredLocalFallback(input), country, platforms);
      const filteredFallback = fallback.filter((recommendation) => matchesLanguageRequest(input, recommendation));
      enrichedBatch = filteredFallback.length > 0 ? filteredFallback : fallback;
    }

    if (enrichedBatch.length === 0) {
      const fallbackRaw = applyTrustFilter(input, [safeFallback(input)]).accepted[0] ?? safeFallback(input);
      const fallback = await enrichRecommendation(fallbackRaw, country, platforms);
      enrichedBatch = hasSubscriptionProvider(fallback)
        ? [fallback]
        : [unavailableSubscriptionFallback(fallback, country)];
    }

    const firstPick = enrichedBatch[0];
    return NextResponse.json({
      ...firstPick,
      _batch: enrichedBatch,
      _batchIndex: 0,
      _trust: {
        rejections: trustedRaw.rejections,
        fallbackUsed: normalizedBatch.length === 1 && normalizedBatch[0]?.title === safeFallback(input).title,
      },
    });
  } catch (error) {
    console.error("Recommendation route failed:", error);
    return NextResponse.json(
      { error: "Recommendation failed. Check API keys or model output." },
      { status: 500 },
    );
  }
}
