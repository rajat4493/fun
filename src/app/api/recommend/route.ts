import { NextResponse } from "next/server";
import { filterFalsePositiveRecommendations, localFallback } from "@/lib/fallbacks";
import { recommendWithAnthropic, recommendWithGenericLLM, recommendWithOpenAI } from "@/lib/llm";
import { enrichRecommendation } from "@/lib/metadata";
import { buildRecommendationPrompt } from "@/lib/prompt";
import { applyTrustFilter, rejectionPrompt, safeFallback, TrustRejection } from "@/lib/recommendation-trust";
import { RawRecommendation, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

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

type SubscriptionChainResult = {
  picks: Recommendation[];
  displayState: Extract<RecommendationDisplayState, "verified" | "no-subscription-match">;
  rejections: TrustRejection[];
};

// Four-step verified subscription chain.
// Step 1: Regular LLM prompt → trust filter → TMDB verify subscription.
// Step 2: Strict subscription prompt → single LLM call → trust filter → TMDB verify.
// Step 3: Curated local fallback → TMDB verify subscription.
// Step 4: No match — return best unverified picks with no-subscription-match state.
async function subscriptionVerifiedChain(
  input: RecommendRequest,
  basePrompt: string,
  country: string,
): Promise<SubscriptionChainResult> {
  const platforms = input.platforms ?? [];

  // Step 1
  const trusted1 = await trustedRawBatch(input, basePrompt);
  const enriched1 = await enrichBatch(trusted1.batch, country, platforms);
  const verified1 = enriched1.filter(hasSubscriptionProvider);
  if (verified1.length > 0) {
    return { picks: verified1, displayState: "verified", rejections: trusted1.rejections };
  }

  // Step 2 — strict retry; failure is non-fatal.
  // If trust filter rejects ALL strict retry picks, skip enrichment and fall through to step 3.
  // Never serve a trust-rejected pick just because TMDB might verify it.
  let enriched2: Recommendation[] = [];
  try {
    const strictPrompt = buildRecommendationPrompt(input, { strictSubscription: true });
    const raw2 = await getRecommendations(input, strictPrompt);
    const filtered2 = applyTrustFilter(input, filterFalsePositiveRecommendations(input, raw2).slice(0, 3));
    if (filtered2.accepted.length > 0) {
      enriched2 = await enrichBatch(filtered2.accepted, country, platforms);
      const verified2 = enriched2.filter(hasSubscriptionProvider);
      if (verified2.length > 0) {
        return { picks: verified2, displayState: "verified", rejections: trusted1.rejections };
      }
    }
  } catch {
    // fall through to step 3
  }

  // Step 3 — curated fallback verified against subscription.
  // Check the full curated pool (not artificially capped at 3).
  const curated = filteredLocalFallback(input);
  const enrichedCurated = await enrichBatch(curated, country, platforms);
  const verifiedCurated = enrichedCurated.filter(hasSubscriptionProvider);
  if (verifiedCurated.length > 0) {
    return { picks: verifiedCurated, displayState: "verified", rejections: trusted1.rejections };
  }

  // Step 4 — no subscription match.
  // Return a single placeholder pick (not the full teaser batch) so the API response is well-formed.
  // The UI shows a clean no-match state; the pick title is used in the description only.
  const firstAttempted = enriched1[0] ?? enriched2[0] ?? enrichedCurated[0] ?? await enrichRecommendation(safeFallback(input), country, platforms);
  return {
    picks: [{
      ...firstAttempted,
      whereToWatch: {
        status: "unverified" as const,
        primary: "No confident match found on your subscriptions",
        note: "Search all cinema for the best mood match, or refine your selection.",
        providers: [],
        country,
        notOnUserPlatforms: true,
      },
    }],
    displayState: "no-subscription-match",
    rejections: trusted1.rejections,
  };
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
    const avoids = input.avoids ?? [];
    const subscriptionOnly = input.platformFilter === "mine";
    const prompt = buildRecommendationPrompt(input);

    let enrichedBatch: Recommendation[];
    let displayState: RecommendationDisplayState;
    let trustRejections: TrustRejection[];
    let fallbackUsed = false;

    if (subscriptionOnly) {
      // Full verified chain: LLM → strict retry → curated → no-match
      const chain = await subscriptionVerifiedChain(input, prompt, country);
      enrichedBatch = chain.picks;
      displayState = chain.displayState;
      trustRejections = chain.rejections;
    } else {
      // All-cinema: single LLM pass with trust-filter retry, then TMDB enrich
      const trustedRaw = await trustedRawBatch(input, prompt);
      const normalizedBatch = trustedRaw.batch;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = normalizedBatch.length === 1 && normalizedBatch[0]?.title === safeFallback(input).title;
      enrichedBatch = await enrichBatch(normalizedBatch, country, platforms);
      displayState = "unverified";
    }

    // Post-chain gates are skipped when the subscription chain already concluded no-subscription-match.
    // Avoidance and language fallbacks must not quietly replace a declared no-match state
    // with another unverified pick that would confuse the UI.

    // Three-bucket genre gate:
    //   verifiedClean    — TMDB returned genre data AND no avoidance violation → serve first
    //   textSafeUnknown  — TMDB had no genre data AND title/vibe text isn't suspicious → serve if no verifiedClean
    //   everything else  — confirmed violation OR suspicious text → fail closed with safe fallback
    if (avoids.length > 0 && displayState !== "no-subscription-match") {
      const withGenreData = enrichedBatch.filter((rec) => (rec.contentMetadata?.genreIds?.length ?? 0) > 0);
      const withoutGenreData = enrichedBatch.filter((rec) => (rec.contentMetadata?.genreIds?.length ?? 0) === 0);
      const verifiedClean = withGenreData.filter((rec) => !genreViolatesAvoidance(avoids, rec.contentMetadata!.genreIds!));
      const textSafeUnknown = withoutGenreData.filter((rec) => !textSuggestsAvoidance(avoids, rec));

      if (verifiedClean.length > 0) {
        enrichedBatch = verifiedClean;
      } else if (textSafeUnknown.length > 0) {
        enrichedBatch = textSafeUnknown;
      } else {
        const fallbackRaw = safeFallback(input);
        const fallback = await enrichRecommendation(fallbackRaw, country, platforms);
        enrichedBatch = [hasSubscriptionProvider(fallback) ? fallback : unavailableSubscriptionFallback(fallback, country)];
        displayState = "avoidance-fallback";
      }
    }

    if (displayState !== "no-subscription-match") {
      const languageMatchedBatch = enrichedBatch.filter((recommendation) => matchesLanguageRequest(input, recommendation));
      if (languageMatchedBatch.length > 0) {
        enrichedBatch = languageMatchedBatch;
      } else if (wantsHindi(input)) {
        const fallback = await enrichBatch(filteredLocalFallback(input), country, platforms);
        const filteredFallback = fallback.filter((recommendation) => matchesLanguageRequest(input, recommendation));
        enrichedBatch = filteredFallback.length > 0 ? filteredFallback : fallback;
      }
    }

    if (enrichedBatch.length === 0) {
      const fallbackRaw = applyTrustFilter(input, [safeFallback(input)]).accepted[0] ?? safeFallback(input);
      const fallback = await enrichRecommendation(fallbackRaw, country, platforms);
      enrichedBatch = hasSubscriptionProvider(fallback)
        ? [fallback]
        : [unavailableSubscriptionFallback(fallback, country)];
    }

    if (subscriptionOnly && !hasSubscriptionProvider(enrichedBatch[0])) {
      displayState = "no-subscription-match";
      enrichedBatch = enrichedBatch.map((item) => ({
        ...item,
        whereToWatch: {
          status: "unverified" as const,
          primary: "No confident match found on your subscriptions",
          note: "Search all cinema for the best mood match, or refine your selection.",
          providers: [],
          country,
          notOnUserPlatforms: true,
        },
      }));
    }

    const firstPick = enrichedBatch[0];
    if (displayState !== "no-subscription-match" && displayState !== "avoidance-fallback") {
      displayState = firstPick.whereToWatch.status === "verified" ? "verified" : "unverified";
    }

    return NextResponse.json({
      ...firstPick,
      _batch: enrichedBatch,
      _batchIndex: 0,
      _trust: {
        rejections: trustRejections,
        displayState,
        fallbackUsed,
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
