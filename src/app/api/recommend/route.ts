import { NextResponse } from "next/server";
import { filterFalsePositiveRecommendations, localFallback } from "@/lib/fallbacks";
import {
  interpretIntentWithAnthropic,
  interpretIntentWithGenericLLM,
  interpretIntentWithOpenAI,
  recommendWithAnthropic,
  recommendWithGenericLLM,
  recommendWithOpenAI,
} from "@/lib/llm";
import { enrichRecommendation } from "@/lib/metadata";
import { buildCompactRetryPrompt, buildRecommendationPrompt } from "@/lib/prompt";
import { activeHardAvoidanceKeys, applyTrustFilter, safeFallback, TrustRejection } from "@/lib/recommendation-trust";
import { buildIntentContractPrompt, localIntentContract, normalizeIntentContract } from "@/lib/intent-contract";
import { IntentContract, RawRecommendation, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

// TMDB genre IDs that map to user avoidances.
// Only genres with clear, unambiguous mapping are included — Action (28) is too broad.
const AVOIDANCE_GENRE_MAP: Record<string, number[]> = {
  horror: [27],
  gore: [27],
};

// Text keywords used as a secondary safety net when TMDB has no genre data.
// Deliberately narrow — only flag obvious matches, not borderline ones.
const AVOIDANCE_SUSPICION_KEYWORDS: Record<string, string[]> = {
  horror: ["horror", "haunted", "haunting", "ghost", "demon", "slasher", "zombie", "terrifying", "nightmarish", "supernatural horror"],
  gore: ["gore", "gory", "torture", "visceral", "graphic violence", "brutal killing"],
  violence: ["disturbing violence", "graphic violence", "brutal", "brutality", "torture", "massacre"],
  "graphic violence": ["disturbing violence", "graphic violence", "brutal", "brutality", "torture", "massacre"],
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

function parseRelatedTitle(value: string): { title: string; year: string } {
  const match = value.match(/^(.+?)\s*\((\d{4})\)$/);
  return match ? { title: match[1].trim(), year: match[2] } : { title: value.trim(), year: "" };
}

const unsafeRelatedWhenAvoidingDarkness = new Set([
  "aserbianfilm",
  "antichrist",
  "eraserhead",
  "enterthevoid",
  "tetsuo",
  "tetsuotheironman",
  "thecookthethiefhiswifeherlover",
  "martyrs",
  "inside",
  "thesadness",
  "terrifier2",
  "raw",
  "titane",
  "dogtooth",
]);

const tenseRelatedWhenFunnyGroup = new Set([
  "coherence",
  "theinvitation",
  "blueruin",
  "calibre",
  "theclovehitchkiller",
  "theguilty",
]);

function shouldHideRelatedTitle(input: RecommendRequest, title: string): boolean {
  const key = normalizeTitle(title);
  const request = [
    input.selfText,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.avoids?.join(" "),
  ].filter(Boolean).join(" ");
  const hardAvoids = activeHardAvoidanceKeys(input);
  const avoidingDarkness = hardAvoids.some((avoid) => ["horror", "gore", "violence", "graphic violence"].includes(avoid));
  if (avoidingDarkness && unsafeRelatedWhenAvoidingDarkness.has(key)) return true;

  const funnyOrGroup = /\b(funny|comedy|laugh|friends|group|party|hangout)\b/i.test(request);
  if (funnyOrGroup && tenseRelatedWhenFunnyGroup.has(key)) return true;

  return false;
}

function sanitizeRelatedForRequest(input: RecommendRequest, recommendation: Recommendation): Recommendation {
  const hiddenTitles = (recommendation.hiddenLayer.titles ?? []).filter((item) => !shouldHideRelatedTitle(input, item.title));
  const alternatives = recommendation.alternatives
    .map((item, index) => ({ ...parseRelatedTitle(item), posterUrl: recommendation.alternativePosterUrls?.[index] }))
    .filter((item) => !shouldHideRelatedTitle(input, item.title));

  return {
    ...recommendation,
    alternatives: alternatives.map((item) => item.year ? `${item.title} (${item.year})` : item.title),
    alternativePosterUrls: alternatives.map((item) => item.posterUrl ?? ""),
    hiddenLayer: {
      ...recommendation.hiddenLayer,
      titles: hiddenTitles.length > 0 ? hiddenTitles : undefined,
    },
  };
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

type ProviderTrace = {
  provider: string;
  durationMs: number;
  ok: boolean;
  promptChars: number;
  error?: string;
  count?: number;
};

async function resolveIntentContract(input: RecommendRequest, trace: ProviderTrace[]): Promise<IntentContract> {
  const local = localIntentContract(input);
  const prompt = buildIntentContractPrompt(input);
  const started = Date.now();

  const tryIntent = async (provider: string, run: () => Promise<Record<string, unknown>>) => {
    try {
      const raw = await run();
      const contract = normalizeIntentContract(raw, input);
      trace.push({
        provider,
        durationMs: Date.now() - started,
        ok: true,
        promptChars: prompt.length,
      });
      return contract;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace.push({
        provider,
        durationMs: Date.now() - started,
        ok: false,
        promptChars: prompt.length,
        error: message,
      });
      console.warn(`${provider} failed:`, message);
      return null;
    }
  };

  // Try only one configured provider for intent classification to avoid adding another long sequential chain.
  if (process.env.ANTHROPIC_API_KEY) {
    return await tryIntent("Intent Anthropic", () => interpretIntentWithAnthropic(prompt)) ?? local;
  }
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return await tryIntent(`Intent Generic LLM (${process.env.LLM_MODEL})`, () => interpretIntentWithGenericLLM(prompt)) ?? local;
  }
  if (process.env.OPENAI_API_KEY) {
    return await tryIntent(`Intent OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`, () => interpretIntentWithOpenAI(prompt)) ?? local;
  }

  trace.push({
    provider: "Intent local",
    durationMs: 0,
    ok: true,
    promptChars: prompt.length,
  });
  return local;
}

async function tryProvider(
  trace: ProviderTrace[],
  provider: string,
  prompt: string,
  run: () => Promise<RawRecommendation[]>,
): Promise<RawRecommendation[] | null> {
  const started = Date.now();
  try {
    const batch = await run();
    trace.push({
      provider,
      durationMs: Date.now() - started,
      ok: true,
      promptChars: prompt.length,
      count: batch.length,
    });
    return batch;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace.push({
      provider,
      durationMs: Date.now() - started,
      ok: false,
      promptChars: prompt.length,
      error: message,
    });
    console.warn(`${provider} failed:`, message);
    return null;
  }
}

// Provider chain: Anthropic → generic OpenAI-compatible (Groq/Mistral/Ollama/etc.) → OpenAI → local fallback.
// Each provider is tried only when its required env vars are set.
async function getRecommendations(input: RecommendRequest, prompt: string, trace: ProviderTrace[], intentContract?: IntentContract): Promise<RawRecommendation[]> {
  const temperature = llmTemperature(input);

  if (process.env.ANTHROPIC_API_KEY) {
    const batch = await tryProvider(trace, "Anthropic", prompt, () => recommendWithAnthropic(prompt, temperature));
    if (batch) return batch;
  }

  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    const batch = await tryProvider(trace, `Generic LLM (${process.env.LLM_MODEL})`, prompt, () => recommendWithGenericLLM(prompt, temperature));
    if (batch) return batch;
  }

  if (process.env.OPENAI_API_KEY) {
    const batch = await tryProvider(trace, `OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`, prompt, () => recommendWithOpenAI(prompt, temperature));
    if (batch) return batch;
  }

  trace.push({
    provider: "local fallback",
    durationMs: 0,
    ok: true,
    promptChars: prompt.length,
  });
  return filteredLocalFallback(input, intentContract);
}

const fallbackStructuredLabelMap: Record<string, { contentCategory: string[]; emotionalEffect: string[] }> = {
  scare: {
    contentCategory: ["horror", "thriller"],
    emotionalEffect: ["fear", "dread", "tension"],
  },
  gore: {
    contentCategory: ["horror", "body-horror", "graphic-violence"],
    emotionalEffect: ["shock", "dread", "visceral intensity"],
  },
  thriller: {
    contentCategory: ["thriller", "suspense", "crime"],
    emotionalEffect: ["tension", "suspense"],
  },
  comedy: {
    contentCategory: ["comedy"],
    emotionalEffect: ["laughter", "warmth"],
  },
  romance: {
    contentCategory: ["romance", "drama"],
    emotionalEffect: ["warmth", "chemistry"],
  },
  cry: {
    contentCategory: ["drama", "emotional"],
    emotionalEffect: ["catharsis", "moving", "heartbreak"],
  },
  drama: {
    contentCategory: ["drama"],
    emotionalEffect: ["emotional", "serious"],
  },
  weird: {
    contentCategory: ["weird", "surreal", "offbeat"],
    emotionalEffect: ["surprise", "curiosity"],
  },
  comfort: {
    contentCategory: ["comfort", "comedy", "drama"],
    emotionalEffect: ["warmth", "reassurance"],
  },
  discovery: {
    contentCategory: ["discovery", "hidden-gem"],
    emotionalEffect: ["curiosity"],
  },
};

function normalizeSignal(value: string | undefined): string {
  return (value ?? "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-");
}

function structuredFallbackLabels(rec: RawRecommendation): { contentCategory: string[]; emotionalEffect: string[] } {
  const labels = [
    normalizeSignal(rec.parsedIntent?.primary),
    ...(rec.parsedIntent?.secondary ?? []).map(normalizeSignal),
  ]
    .map((signal) => fallbackStructuredLabelMap[signal])
    .filter((value): value is { contentCategory: string[]; emotionalEffect: string[] } => Boolean(value));

  return {
    contentCategory: [...new Set(labels.flatMap((label) => label.contentCategory))],
    emotionalEffect: [...new Set(labels.flatMap((label) => label.emotionalEffect))],
  };
}

function withStructuredFallbackLabels(rec: RawRecommendation): RawRecommendation {
  const labels = structuredFallbackLabels(rec);
  return {
    ...rec,
    contentCategory: rec.contentCategory?.length ? rec.contentCategory : labels.contentCategory,
    emotionalEffect: rec.emotionalEffect?.length ? rec.emotionalEffect : labels.emotionalEffect,
  };
}

function fallbackIntentScore(rec: RawRecommendation, intentContract?: IntentContract): number {
  if (!intentContract || intentContract.primary === "unknown") return 0;
  const primary = normalizeSignal(intentContract.primary);
  const secondary = new Set(intentContract.secondary.map(normalizeSignal));
  const labels = new Set([
    normalizeSignal(rec.parsedIntent?.primary),
    ...(rec.parsedIntent?.secondary ?? []).map(normalizeSignal),
    ...(rec.contentCategory ?? []).map(normalizeSignal),
    ...(rec.emotionalEffect ?? []).map(normalizeSignal),
  ]);

  let score = labels.has(primary) ? 20 : 0;
  for (const item of secondary) {
    if (labels.has(item)) score += 4;
  }
  if (intentContract.format !== "any" && rec.parsedIntent?.format === intentContract.format) score += 3;
  return score;
}

function rankFallbacksByContract(batch: RawRecommendation[], intentContract?: IntentContract): RawRecommendation[] {
  if (!intentContract || intentContract.primary === "unknown") return batch;
  return batch
    .map((rec, index) => ({ rec, index, score: fallbackIntentScore(rec, intentContract) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.rec);
}

function filteredLocalFallback(input: RecommendRequest, intentContract?: IntentContract): RawRecommendation[] {
  const diversified = diversifyFallbackBatch(input, localFallback(input, intentContract).map(withStructuredFallbackLabels));
  const filtered = filterFalsePositiveRecommendations(input, diversified);
  const batch = filtered.length > 0 ? diversifyFallbackBatch(input, filtered) : diversified;
  return rankFallbacksByContract(batch, intentContract);
}

// NEW: Trust filter with retry loop. If all picks are rejected (wrong language, seen titles, etc.)
// the prompt is extended with a rejection note and the LLM gets one more attempt before
// falling back to local curated picks.
async function trustedRawBatch(input: RecommendRequest, basePrompt: string, trace: ProviderTrace[], intentContract?: IntentContract): Promise<{
  batch: RawRecommendation[];
  rejections: TrustRejection[];
}> {
  const allRejections: TrustRejection[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? basePrompt : buildCompactRetryPrompt(input, allRejections, intentContract);
    const rawBatch = await getRecommendations(input, prompt, trace, intentContract);
    const normalizedBatch = filterFalsePositiveRecommendations(input, rawBatch).slice(0, 3);

    const trusted = applyTrustFilter(input, normalizedBatch, intentContract);
    allRejections.push(...trusted.rejected);
    if (trusted.accepted.length > 0) {
      return { batch: trusted.accepted.slice(0, 3), rejections: allRejections };
    }

  }

  const localTrusted = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
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
  trace: ProviderTrace[],
  intentContract?: IntentContract,
): Promise<SubscriptionChainResult> {
  const platforms = input.platforms ?? [];

  // Step 1
  const trusted1 = await trustedRawBatch(input, basePrompt, trace, intentContract);
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
    const strictPrompt = buildRecommendationPrompt(input, { strictSubscription: true, intentContract });
    const raw2 = await getRecommendations(input, strictPrompt, trace, intentContract);
    const filtered2 = applyTrustFilter(input, filterFalsePositiveRecommendations(input, raw2).slice(0, 3), intentContract);
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
  const curatedTrusted = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
  const curated = curatedTrusted.accepted.length > 0 ? curatedTrusted.accepted : [safeFallback(input)];
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
    const avoids = activeHardAvoidanceKeys(input);
    const subscriptionOnly = input.platformFilter === "mine";
    const providerTrace: ProviderTrace[] = [];
    const intentContract = await resolveIntentContract(input, providerTrace);
    const prompt = buildRecommendationPrompt(input, { intentContract });

    let enrichedBatch: Recommendation[];
    let displayState: RecommendationDisplayState;
    let trustRejections: TrustRejection[];
    let fallbackUsed = false;

    if (subscriptionOnly) {
      // Full verified chain: LLM → strict retry → curated → no-match
      const chain = await subscriptionVerifiedChain(input, prompt, country, providerTrace, intentContract);
      enrichedBatch = chain.picks;
      displayState = chain.displayState;
      trustRejections = chain.rejections;
    } else {
      // All-cinema: single LLM pass with trust-filter retry, then TMDB enrich
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract);
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
        const fallback = await enrichBatch(filteredLocalFallback(input, intentContract), country, platforms);
        const filteredFallback = fallback.filter((recommendation) => matchesLanguageRequest(input, recommendation));
        enrichedBatch = filteredFallback.length > 0 ? filteredFallback : fallback;
      }
    }

    if (enrichedBatch.length === 0) {
      const fallbackRaw = applyTrustFilter(input, [safeFallback(input)], intentContract).accepted[0] ?? safeFallback(input);
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

    enrichedBatch = enrichedBatch.map((item) => sanitizeRelatedForRequest(input, item));

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
        ...(process.env.NODE_ENV !== "production" || process.env.FUN_DEBUG_TRACES === "1" ? { providerTrace } : {}),
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
