import { NextResponse } from "next/server";
import { filterFalsePositiveRecommendations, localFallback } from "@/lib/fallbacks";
import { recommendWithAnthropic, recommendWithGenericLLM, recommendWithOpenAI } from "@/lib/llm";
import { enrichRecommendation } from "@/lib/metadata";
import { buildRecommendationPrompt } from "@/lib/prompt";
import { applyTrustFilter, rejectionPrompt, safeFallback, TrustRejection } from "@/lib/recommendation-trust";
import { RawRecommendation, RecommendRequest, Recommendation } from "@/lib/types";

// TMDB genre IDs that map to user avoidances.
// Only genres with clear, unambiguous mapping are included — Action (28) is too broad.
const AVOIDANCE_GENRE_MAP: Record<string, number[]> = {
  horror: [27],
  gore: [27],
};

// Text keywords used as a secondary safety net when TMDB has no genre data.
// Deliberately narrow — only flag obvious matches, not borderline ones.
const AVOIDANCE_SUSPICION_KEYWORDS: Record<string, string[]> = {
  horror: ["horror", "haunted", "ghost", "demon", "slasher", "zombie", "terrifying", "supernatural horror"],
  gore: ["gore", "gory", "torture", "visceral", "graphic violence", "brutal killing"],
};

function genreViolatesAvoidance(avoids: string[], genreIds: number[]): boolean {
  if (!genreIds.length || !avoids.length) return false;
  return avoids.some((avoid) => {
    const mapped = AVOIDANCE_GENRE_MAP[avoid.toLowerCase().trim()];
    return mapped ? mapped.some((id) => genreIds.includes(id)) : false;
  });
}

function textSuggestsAvoidance(avoids: string[], rec: Recommendation): boolean {
  const text = [rec.title, rec.vibe, rec.oneLine].filter(Boolean).join(" ").toLowerCase();
  return avoids.some((avoid) => {
    const keywords = AVOIDANCE_SUSPICION_KEYWORDS[avoid.toLowerCase().trim()] ?? [];
    return keywords.some((keyword) => text.includes(keyword));
  });
}

function hasSubscriptionProvider(recommendation: Recommendation): boolean {
  return recommendation.whereToWatch.status === "verified" &&
    !recommendation.whereToWatch.notOnUserPlatforms &&
    (recommendation.whereToWatch.providers ?? []).some((provider) => provider.access === "subscription");
}

function wantsHindi(input: RecommendRequest): boolean {
  const text = [input.selfText, input.reference, ...(input.languagePreferences ?? [])].filter(Boolean).join(" ");
  return /\bhindi\b/i.test(text);
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

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hash(value: string): number {
  return value.split("").reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0);
}

function diversifyFallbackBatch(input: RecommendRequest, batch: RawRecommendation[]): RawRecommendation[] {
  if (batch.length <= 1) return batch;
  const excluded = new Set([...(input.recentTitles ?? []), ...(input.seenTitles ?? [])].map(normalizeTitle));
  const available = batch.filter((item) => !excluded.has(normalizeTitle(item.title)));
  const source = available.length > 0 ? available : batch;
  const requestSeed = [
    input.selfText,
    input.reference,
    input.mood?.join(","),
    input.wants?.join(","),
    input.avoids?.join(","),
    input.time,
    input.energy,
    input.viewingContext,
    input.country,
    input.languagePreferences?.join(","),
    input.platformFilter,
    input.discoveryMode,
    input.craziness,
    input.recentTitles?.length ?? 0,
    new Date().toISOString().slice(0, 10),
  ].filter(Boolean).join("|");
  const start = Math.abs(hash(requestSeed)) % source.length;
  return [...source.slice(start), ...source.slice(0, start)];
}

function llmTemperature(input: RecommendRequest): number {
  return input.craziness === 3 ? 1 : 0.85;
}

// Provider chain: Anthropic → generic OpenAI-compatible (Groq/Mistral/Ollama/etc.) → OpenAI → local fallback.
// Each provider is tried only when its required env vars are set.
async function getRecommendations(input: RecommendRequest, prompt: string): Promise<RawRecommendation[]> {
  const temperature = llmTemperature(input);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await recommendWithAnthropic(prompt, temperature);
    } catch (error) {
      console.warn("Anthropic failed:", error instanceof Error ? error.message : String(error));
    }
  }

  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    try {
      return await recommendWithGenericLLM(prompt, temperature);
    } catch (error) {
      console.warn("Generic LLM failed:", error instanceof Error ? error.message : String(error));
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      return await recommendWithOpenAI(prompt, temperature);
    } catch (error) {
      console.warn("OpenAI failed:", error instanceof Error ? error.message : String(error));
    }
  }

  return filteredLocalFallback(input);
}

function filteredLocalFallback(input: RecommendRequest): RawRecommendation[] {
  const diversified = diversifyFallbackBatch(input, localFallback(input));
  const filtered = filterFalsePositiveRecommendations(input, diversified);
  return filtered.length > 0 ? diversifyFallbackBatch(input, filtered) : diversified;
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
    const normalizedBatch = filterFalsePositiveRecommendations(input, rawBatch).slice(0, 3);

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
  // Verified subscription picks exist — use them.
  if (verified.length > 0) return verified;
  // No verified picks: keep the LLM's picks with unverified status.
  // Do NOT fall back to curated safe titles — that's what causes repeated picks.
  // The UI will show "Availability not verified yet" which is honest.
  return enriched.map((item) => unavailableSubscriptionFallback(item, country));
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

    // Trust filter already ran on raw picks in trustedRawBatch — do not run it again here.
    // A second pass on enriched picks causes false rejections because TMDB metadata
    // can add text that triggers avoidance regex on otherwise valid picks.
    let enrichedBatch = input.platformFilter === "mine"
      ? await verifiedSubscriptionBatch(normalizedBatch, input, country)
      : await enrichBatch(normalizedBatch, country, platforms);

    // Three-bucket genre gate:
    //   verifiedClean  — TMDB returned genre data AND no avoidance violation → serve first
    //   textSafeUnknown — TMDB had no genre data AND title/vibe text isn't suspicious → serve if no verifiedClean
    //   everything else  — confirmed violation OR suspicious text without genre data → fail closed
    const avoids = input.avoids ?? [];
    if (avoids.length > 0) {
      const withGenreData = enrichedBatch.filter((rec) => (rec.contentMetadata?.genreIds?.length ?? 0) > 0);
      const withoutGenreData = enrichedBatch.filter((rec) => (rec.contentMetadata?.genreIds?.length ?? 0) === 0);
      const verifiedClean = withGenreData.filter((rec) => !genreViolatesAvoidance(avoids, rec.contentMetadata!.genreIds!));
      const textSafeUnknown = withoutGenreData.filter((rec) => !textSuggestsAvoidance(avoids, rec));

      if (verifiedClean.length > 0) {
        enrichedBatch = verifiedClean;
      } else if (textSafeUnknown.length > 0) {
        enrichedBatch = textSafeUnknown;
      } else {
        // All picks are either confirmed genre violations or text-suspicious with no genre data.
        const fallbackRaw = safeFallback(input);
        const fallback = await enrichRecommendation(fallbackRaw, country, platforms);
        enrichedBatch = [hasSubscriptionProvider(fallback) ? fallback : unavailableSubscriptionFallback(fallback, country)];
      }
    }

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
