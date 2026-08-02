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
import { extractIntent } from "@/lib/intent";
import { enrichRecommendation } from "@/lib/metadata";
import { buildCompactRetryPrompt, buildRecommendationPrompt } from "@/lib/prompt";
import { activeHardAvoidanceKeys, applyTrustFilter, relatedTitleUnsafe, safeFallback, TrustRejection } from "@/lib/recommendation-trust";
import { buildIntentContractPrompt, localIntentContract, normalizeIntentContract } from "@/lib/intent-contract";
import { matchesLanguageRequest, wantsSpecificLanguage } from "@/lib/language-lane";
import { countryCodeMap, isPlotIdentificationRequest, normalizeRecommendRequest, requestText } from "@/lib/recommendation-utils";
import { isPreviewCountry } from "@/lib/launch-scope";
import { callerIp, checkRateLimit } from "@/lib/rate-limit";
import { IntentContract, RawRecommendation, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

// Disabled by default while production credentials and fallback behavior are reviewed.
// Re-enable deliberately after validation with FUN_ENABLE_ANTHROPIC=1.
const anthropicEnabled = process.env.FUN_ENABLE_ANTHROPIC === "1";
const MAX_RECOMMEND_REQUEST_BYTES = 131_072;

class RequestTooLargeError extends Error {}

async function readJsonBodyWithLimit(req: Request): Promise<unknown> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RECOMMEND_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }

  if (!req.body) return {};

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RECOMMEND_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(body));
}

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

function requiresConfirmedHorror(input: RecommendRequest, contract: IntentContract): boolean {
  if (contract.primary !== "scare") return false;
  const text = [input.selfText, ...(input.wants ?? [])].filter(Boolean).join(" ");
  return /\b(really|genuinely|properly|extremely|absolutely|deeply|shit)\s+(?:scary|scared|terrifying|frightening)|\bterrify\s+(?:me|us|my)|\bmake\s+(?:me|us|my partner|them)\s+(?:really\s+)?(?:scared|terrified)|\bscariest\b/i.test(text);
}

function metadataConfirmsHorror(rec: Recommendation): boolean {
  return rec.contentMetadata?.genreIds?.includes(27) === true;
}

function hasSubscriptionProvider(recommendation: Recommendation): boolean {
  return recommendation.whereToWatch.status === "verified" &&
    !recommendation.whereToWatch.notOnUserPlatforms &&
    (recommendation.whereToWatch.providers ?? []).some((provider) => provider.access === "subscription");
}

function catalogConfirmed(recommendation: Recommendation): boolean {
  return recommendation.contentMetadata?.catalogConfirmed !== false;
}

function genreNeutralBingeShouldAvoidHorror(input: RecommendRequest, contract: IntentContract): boolean {
  const request = requestText(input).toLowerCase();
  const asksForBinge = /\b(binge|weekend binge|hook me fast|hooks? me fast|easy to binge|one more episode)\b/.test(request);
  if (!asksForBinge) return false;
  if (["scare", "gore", "thriller"].includes(contract.primary)) return false;
  if (/\b(horror|scary|scare|terrify|terrifying|gore|gory|bloody|ghost|haunted|demon|supernatural)\b/.test(request)) return false;
  if (/\b(thriller|crime|mystery|detective|murder|suspense)\b/.test(request)) return false;
  return true;
}


function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseRelatedTitle(value: string): { title: string; year: string } {
  const match = value.match(/^(.+?)\s*\((\d{4})\)$/);
  return match ? { title: match[1].trim(), year: match[2] } : { title: value.trim(), year: "" };
}

const tenseRelatedWhenFunnyGroup = new Set([
  "coherence",
  "theinvitation",
  "blueruin",
  "calibre",
  "theclovehitchkiller",
  "theguilty",
]);

function shouldHideRelatedTitle(input: RecommendRequest, title: string, intentContract?: IntentContract): boolean {
  const key = normalizeTitle(title);
  const request = [
    input.selfText,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.avoids?.join(" "),
  ].filter(Boolean).join(" ");

  // Shared safety denylists (horror/gore avoidance, panic/grief sensitivity) — same trust checks
  // applied to the main pick, now applied to hiddenTitles/alternatives too.
  if (relatedTitleUnsafe(input, title, intentContract)) return true;

  // Narrow tone check (not a safety concern, just avoids a tense/violent adjacent pick surfacing
  // next to a funny/group-watch main pick) — kept separate from the safety denylists above.
  const funnyOrGroup = /\b(funny|comedy|laugh|friends|group|party|hangout)\b/i.test(request);
  if (funnyOrGroup && tenseRelatedWhenFunnyGroup.has(key)) return true;

  return false;
}

function sanitizeRelatedForRequest(input: RecommendRequest, recommendation: Recommendation, intentContract?: IntentContract): Recommendation {
  const seen = new Set<string>([
    recommendation.title,
    ...(input.excludedTitles ?? []).slice(0, 200),
    ...(input.seenTitles ?? []).slice(0, 40),
    ...(input.recentTitles ?? []).slice(0, 8),
  ].map(normalizeTitle));
  const keepRelatedTitle = (title: string) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key) || shouldHideRelatedTitle(input, title, intentContract)) return false;
    seen.add(key);
    return true;
  };
  const hiddenTitles = (recommendation.hiddenLayer.titles ?? []).filter((item) => keepRelatedTitle(item.title));
  const alternatives = recommendation.alternatives
    .map((item, index) => ({ ...parseRelatedTitle(item), posterUrl: recommendation.alternativePosterUrls?.[index] }))
    .filter((item) => keepRelatedTitle(item.title));

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
  const excluded = new Set([
    ...(input.excludedTitles ?? []),
    ...(input.recentTitles ?? []),
    ...(input.seenTitles ?? []),
  ].map(normalizeTitle));
  const available = batch.filter((item) => !excluded.has(normalizeTitle(item.title)));
  if (available.length === 0 && batch.length > 0) {
    // Escape hatch firing: every candidate in this curated bucket has already been shown to this
    // user, so we're about to re-surface one anyway. Logged (not suppressed — there's a hard floor
    // on how many curated titles exist per category) so same-user repetition from this path is
    // measurable instead of silent.
    console.log(`[FUN fallback] diversifyFallbackBatch exhausted, re-surfacing an already-excluded title from ${batch.length} candidates`);
  }
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

// Scoped to "one episode" requests only — this is the one case with actual evidence behind it
// (6/6 first-attempt success at temperature 0.05, vs ~50% at the default temperature). A runtime-
// ceiling trigger (e.g. "under 45 min") was tested too and did NOT show the same reliable gain
// (1/4 and 2/4 across two mood combinations), so it's deliberately left out rather than extended
// on unproven evidence. Do not broaden this trigger without the same kind of before/after
// measurement — see conversation history for why temperature is not a uniform lever across moods.
function isHardFormatRequest(input: RecommendRequest): boolean {
  return extractIntent(input).requestedFormat === "episode";
}

function llmTemperature(input: RecommendRequest): number {
  if (isHardFormatRequest(input)) return 0.05;
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

type RecommendationTimings = {
  intentMs: number;
  recommendationMs: number;
  verificationMs: number;
  postProcessingMs: number;
  totalMs: number;
};

const CORE_REQUEST_BUDGET_MS = 24000;
const FULL_REQUEST_BUDGET_MS = 32000;

function applyIntentExclusions(input: RecommendRequest, contract: IntentContract): RecommendRequest {
  const combined = [
    ...(contract.negativeReferences ?? []),
    ...(input.excludedTitles ?? []),
  ];
  const seen = new Set<string>();
  const excludedTitles = combined.filter((title) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
  return excludedTitles.length ? { ...input, excludedTitles } : input;
}

async function resolveIntentContract(input: RecommendRequest, trace: ProviderTrace[]): Promise<IntentContract> {
  // Background fill calls (recommendationCount: 2) pass back phase 1's already-resolved contract —
  // skip re-running intent classification entirely rather than paying for a second LLM call.
  if (input.precomputedIntentContract) {
    trace.push({
      provider: "Intent precomputed (reused from phase 1)",
      durationMs: 0,
      ok: true,
      promptChars: 0,
    });
    return input.precomputedIntentContract;
  }

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
  if (process.env.OPENAI_API_KEY) {
    return await tryIntent(`Intent OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`, () => interpretIntentWithOpenAI(prompt)) ?? local;
  }
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return await tryIntent(`Intent Generic LLM (${process.env.LLM_MODEL})`, () => interpretIntentWithGenericLLM(prompt)) ?? local;
  }
  if (anthropicEnabled && process.env.ANTHROPIC_API_KEY) {
    return await tryIntent("Intent Anthropic", () => interpretIntentWithAnthropic(prompt)) ?? local;
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

// Provider chain: OpenAI → generic OpenAI-compatible (Groq/Mistral/Ollama/etc.) →
// opt-in Anthropic → local fallback.
// Each provider is tried only when its required env vars are set.
async function getRecommendations(
  input: RecommendRequest,
  prompt: string,
  trace: ProviderTrace[],
  intentContract?: IntentContract,
  deadlineAt?: number,
): Promise<RawRecommendation[]> {
  const temperature = llmTemperature(input);
  const count = input.recommendationCount ?? 3;
  const includeDiscovery = input.responseDetail !== "core";
  // Bound the complete provider chain. Previously OpenAI and Anthropic could each
  // consume 25 seconds serially, producing 50–75 second requests on a degraded
  // serverless instance. Core UI calls get a fast primary window while full
  // backward-compatible batches retain more generation time.
  const chainStarted = Date.now();
  const chainBudgetMs = includeDiscovery ? 30000 : 24000;
  const primaryBudgetMs = includeDiscovery ? 20000 : 12000;
  const remainingBudget = () => Math.max(
    0,
    Math.min(
      chainBudgetMs - (Date.now() - chainStarted),
      deadlineAt ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY,
    ),
  );
  const providerBudget = (preferred: number) => Math.min(preferred, remainingBudget());
  const canTryProvider = () => remainingBudget() >= 3000;

  if (process.env.OPENAI_API_KEY && canTryProvider()) {
    const timeoutMs = providerBudget(primaryBudgetMs);
    const batch = await tryProvider(trace, `OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`, prompt, () => recommendWithOpenAI(prompt, temperature, count, includeDiscovery, timeoutMs));
    if (batch) return batch;
  }

  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL && canTryProvider()) {
    const timeoutMs = providerBudget(8000);
    const batch = await tryProvider(trace, `Generic LLM (${process.env.LLM_MODEL})`, prompt, () => recommendWithGenericLLM(prompt, temperature, count, includeDiscovery, timeoutMs));
    if (batch) return batch;
  }

  if (anthropicEnabled && process.env.ANTHROPIC_API_KEY && canTryProvider()) {
    const timeoutMs = providerBudget(16000);
    const batch = await tryProvider(trace, "Anthropic", prompt, () => recommendWithAnthropic(prompt, temperature, count, includeDiscovery, timeoutMs));
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

// The JSON schema only declares confidence as `{ type: "number" }` — the prompt asks for a 0-100
// scale, but the model occasionally returns a 0-1 fraction (e.g. 0.95) instead. Previously only
// confidenceViolation's own local check normalized this (for its <60 rejection threshold), leaving
// the actual Recommendation object's confidence field untouched — the frontend then rendered the
// raw fractional value directly ("0.95%" instead of "95%"). Normalized once here, at the single
// choke point every batch passes through regardless of provider or fallback source, so every
// downstream consumer (trust filter, ranking, the UI) sees a consistent 0-100 scale.
function normalizeConfidenceScale(batch: RawRecommendation[]): RawRecommendation[] {
  return batch.map((rec) =>
    typeof rec.confidence === "number" && rec.confidence > 0 && rec.confidence <= 1
      ? { ...rec, confidence: Math.round(rec.confidence * 100) }
      : rec,
  );
}

function withStructuredFallbackLabels(rec: RawRecommendation): RawRecommendation {
  const labels = structuredFallbackLabels(rec);
  return {
    ...rec,
    contentCategory: rec.contentCategory?.length ? rec.contentCategory : labels.contentCategory,
    emotionalEffect: rec.emotionalEffect?.length ? rec.emotionalEffect : labels.emotionalEffect,
  };
}

// Scoring order: primary intent match (20) > secondary matches (4 each) > format match (3).
// Language match isn't scored here — localFallback already routes to a language-specific curated
// bucket (see language-lane.ts), so every candidate in a given batch already shares the same
// language lane; there's nothing to differentiate. Sensitivity safety isn't scored either — it's
// enforced as a hard reject in applyTrustFilter downstream, so an unsafe pick never survives to
// become the served result regardless of its rank here.
// The recent/seen penalty IS needed here: diversifyFallbackBatch excludes seen/recent titles when
// possible, but falls back to the full (unfiltered) batch when EVERY candidate has been shown
// before (small curated buckets make this reachable). In that edge case this penalty still orders
// the least-recently-shown title first instead of an arbitrary one, avoiding a static-feeling repeat.
function fallbackIntentScore(rec: RawRecommendation, intentContract?: IntentContract, input?: RecommendRequest): number {
  let score = 0;

  if (intentContract && intentContract.primary !== "unknown") {
    const primary = normalizeSignal(intentContract.primary);
    const secondary = new Set(intentContract.secondary.map(normalizeSignal));
    const labels = new Set([
      normalizeSignal(rec.parsedIntent?.primary),
      ...(rec.parsedIntent?.secondary ?? []).map(normalizeSignal),
      ...(rec.contentCategory ?? []).map(normalizeSignal),
      ...(rec.emotionalEffect ?? []).map(normalizeSignal),
    ]);

    if (labels.has(primary)) score += 20;
    for (const item of secondary) {
      if (labels.has(item)) score += 4;
    }
    if (intentContract.format !== "any" && rec.parsedIntent?.format === intentContract.format) score += 3;
  }

  if (input) {
    const key = normalizeTitle(rec.title);
    const seen = new Set([
      ...(input.excludedTitles ?? []),
      ...(input.recentTitles ?? []),
      ...(input.seenTitles ?? []),
    ].map(normalizeTitle));
    if (seen.has(key)) score -= 50;
  }

  return score;
}

function acceptedBatchScore(rec: RawRecommendation, intentContract?: IntentContract, input?: RecommendRequest): number {
  let score = fallbackIntentScore(rec, intentContract, input);
  const labels = new Set([
    normalizeSignal(rec.parsedIntent?.primary),
    ...(rec.parsedIntent?.secondary ?? []).map(normalizeSignal),
    ...(rec.contentCategory ?? []).map(normalizeSignal),
    ...(rec.emotionalEffect ?? []).map(normalizeSignal),
  ]);

  if (intentContract) {
    const isReliefState = intentContract.situation.some((value) => value.includes("breakup-recovery") || value.includes("grief-relief") || value.includes("panic"));
    if (intentContract.primary === "comfort" || isReliefState) {
      if (["comedy", "funny", "laughter", "light", "warm", "warmth", "gentle", "reassurance", "reassuring", "easy", "feel-good"].some((label) => labels.has(label))) score += 8;
      if (["heartbreak", "heartbreaking", "grief", "loss", "bleak", "harrowing", "melancholy", "devastating", "existential", "self-destructive", "self-destruction", "depression", "depressive", "addiction", "dark-comedy", "bittersweet", "nihilistic", "despair", "self-loathing", "midlife-crisis"].some((label) => labels.has(label))) score -= 10;
      if (labels.has("drama") && !labels.has("comedy")) score -= 6;
    }

    if (intentContract.primary === "thriller") {
      if (["thriller", "suspense", "mystery", "crime", "tension", "tense", "paranoid", "investigation"].some((label) => labels.has(label))) score += 8;
      if (labels.has("drama") && !["thriller", "suspense", "mystery", "crime", "tension", "tense"].some((label) => labels.has(label))) score -= 8;
    }

    if (intentContract.primary === "cry") {
      if (["cry", "tearjerker", "catharsis", "cathartic", "moving", "poignant", "grief", "loss", "heartbreaking"].some((label) => labels.has(label))) score += 8;
      if (["comfort", "warm", "warmth", "easy", "feel-good"].some((label) => labels.has(label)) && !["cry", "catharsis", "heartbreaking", "moving", "poignant"].some((label) => labels.has(label))) score -= 8;
      if (intentContract.format === "any") {
        if (rec.format === "Film") score += 4;
        if (rec.format === "Series" || rec.format === "Episode") score -= 4;
      }
    }

    // Same pattern as comfort/thriller/cry above: prefer candidates whose own labels actually
    // support the primary intent, and penalize a softer register that would quietly dilute it —
    // the exact "safe pick softens the ask" drift this session repeatedly found bugs in.
    if (intentContract.primary === "scare") {
      if (["scare", "scary", "horror", "fear", "dread", "terror", "terrifying", "frightening", "nightmare", "haunted"].some((label) => labels.has(label))) score += 8;
      if (["comfort", "warm", "warmth", "feel-good", "gentle", "cozy"].some((label) => labels.has(label))) score -= 10;
    }

    if (intentContract.primary === "gore") {
      if (["gore", "gory", "body-horror", "splatter", "graphic-violence", "visceral"].some((label) => labels.has(label))) score += 8;
      if (["comfort", "warm", "warmth", "feel-good", "gentle"].some((label) => labels.has(label))) score -= 10;
    }

    if (intentContract.primary === "romance") {
      if (["romance", "romantic", "love-story", "chemistry", "tender"].some((label) => labels.has(label))) score += 8;
    }

    if (intentContract.primary === "weird") {
      if (["weird", "surreal", "absurd", "offbeat", "bizarre", "experimental", "strange"].some((label) => labels.has(label))) score += 8;
    }

    if (intentContract.primary === "drama") {
      if (["drama", "character-study", "serious", "emotional", "prestige"].some((label) => labels.has(label))) score += 6;
    }

    if (intentContract.primary === "discovery" || intentContract.discoveryPreference === "non-mainstream") {
      if (["hidden-gem", "underrated", "discovery", "overlooked"].some((label) => labels.has(label))) score += 6;
    }
  }

  return score;
}

function rankAcceptedBatch(batch: RawRecommendation[], intentContract?: IntentContract, input?: RecommendRequest): RawRecommendation[] {
  if (batch.length <= 1) return batch;
  return batch
    .map((rec, index) => ({ rec, index, score: acceptedBatchScore(rec, intentContract, input) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.rec);
}

function rankFallbacksByContract(batch: RawRecommendation[], intentContract?: IntentContract, input?: RecommendRequest): RawRecommendation[] {
  if ((!intentContract || intentContract.primary === "unknown") && !input) return batch;
  return batch
    .map((rec, index) => ({ rec, index, score: fallbackIntentScore(rec, intentContract, input) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.rec);
}

function filteredLocalFallback(input: RecommendRequest, intentContract?: IntentContract): RawRecommendation[] {
  const diversified = diversifyFallbackBatch(input, localFallback(input, intentContract).map(withStructuredFallbackLabels));
  const filtered = filterFalsePositiveRecommendations(input, diversified);
  const batch = filtered.length > 0 ? diversifyFallbackBatch(input, filtered) : diversified;
  return rankFallbacksByContract(batch, intentContract, input);
}

// Trust filter with retry loop. If all picks are rejected the prompt is extended with a rejection
// note and the LLM gets one more attempt before falling back to local curated picks.
// precomputedBatch: skip the first LLM call — used when intent and first rec ran in parallel.
async function trustedRawBatch(
  input: RecommendRequest,
  basePrompt: string,
  trace: ProviderTrace[],
  intentContract?: IntentContract,
  precomputedBatch?: RawRecommendation[] | null,
  count = 3,
  deadlineAt?: number,
): Promise<{
  batch: RawRecommendation[];
  rejections: TrustRejection[];
  fallbackUsed: boolean;
}> {
  const allRejections: TrustRejection[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let rawBatch: RawRecommendation[];
    const traceStart = trace.length;
    if (attempt === 0 && precomputedBatch) {
      rawBatch = precomputedBatch; // reuse batch from parallel call
    } else {
      const prompt = attempt === 0 ? basePrompt : buildCompactRetryPrompt(input, allRejections, intentContract, count);
      rawBatch = await getRecommendations(input, prompt, trace, intentContract, deadlineAt);
    }
    const normalizedBatch = normalizeConfidenceScale(filterFalsePositiveRecommendations(input, rawBatch)).slice(0, count);

    const trusted = applyTrustFilter(input, normalizedBatch, intentContract);
    allRejections.push(...trusted.rejected);
    if (trusted.accepted.length > 0) {
      const rankedAccepted = rankAcceptedBatch(trusted.accepted, intentContract, input);
      return {
        batch: rankedAccepted.slice(0, count),
        rejections: allRejections,
        fallbackUsed: trace.slice(traceStart).some((item) => item.provider === "local fallback"),
      };
    }
  }

  const localTrusted = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
  allRejections.push(...localTrusted.rejected);
  if (localTrusted.accepted.length > 0) {
    return { batch: localTrusted.accepted.slice(0, count), rejections: allRejections, fallbackUsed: true };
  }

  if (allRejections.length === 0) {
    allRejections.push({
      title: "all candidates",
      reasons: ["pipeline: no candidates survived mechanical+semantic review"],
    });
  }

  return { batch: [safeFallback(input)], rejections: allRejections, fallbackUsed: true };
}

async function enrichBatch(
  batch: RawRecommendation[],
  country: string,
  platforms: string[],
  timings?: RecommendationTimings,
): Promise<Recommendation[]> {
  const started = Date.now();
  const recommendations = await Promise.all(batch.map(async (pick) => {
    try {
      return await enrichRecommendation(pick, country, platforms);
    } catch {
      return {
        ...pick,
        whereToWatch: {
          status: "unverified" as const,
          primary: "Availability not verified yet",
          note: "Check your apps — metadata lookup timed out.",
          providers: [],
          country,
          notOnUserPlatforms: false,
        },
      };
    }
  }));
  if (timings) timings.verificationMs += Date.now() - started;
  return recommendations;
}

type SubscriptionChainResult = {
  picks: Recommendation[];
  displayState: Extract<RecommendationDisplayState, "verified" | "no-subscription-match">;
  rejections: TrustRejection[];
  fallbackUsed: boolean;
};

// Four-step verified subscription chain.
// Step 1: Regular LLM prompt → trust filter → TMDB verify subscription.
// Step 2: Strict subscription prompt → single LLM call → trust filter → TMDB verify.
// Step 3: Curated local fallback → TMDB verify subscription.
// Step 4: No match — return best unverified picks with no-subscription-match state.
async function subscriptionVerifiedChain(
  input: RecommendRequest,
  country: string,
  trace: ProviderTrace[],
  intentContract?: IntentContract,
  count = 3,
  deadlineAt?: number,
  timings?: RecommendationTimings,
): Promise<SubscriptionChainResult> {
  const platforms = input.platforms ?? [];
  // The UI deliberately asks for one visible pick first. Subscription verification needs a
  // wider internal candidate set, otherwise one unavailable title makes the whole search fail.
  const candidateCount = Math.max(3, count);
  const candidateInput = { ...input, recommendationCount: candidateCount };
  const candidatePrompt = buildRecommendationPrompt(candidateInput, {
    intentContract,
    count: candidateCount,
  });

  // Step 1
  const trusted1 = await trustedRawBatch(
    candidateInput,
    candidatePrompt,
    trace,
    intentContract,
    null,
    candidateCount,
    deadlineAt,
  );
  const enriched1 = await enrichBatch(trusted1.batch, country, platforms, timings);
  const verified1 = enriched1.filter(hasSubscriptionProvider).slice(0, count);
  if (verified1.length > 0) {
    return { picks: verified1, displayState: "verified", rejections: trusted1.rejections, fallbackUsed: trusted1.fallbackUsed };
  }

  // Step 2 — strict retry; failure is non-fatal.
  // If trust filter rejects ALL strict retry picks, skip enrichment and fall through to step 3.
  // Never serve a trust-rejected pick just because TMDB might verify it.
  let enriched2: Recommendation[] = [];
  let strictFallbackUsed = false;
  try {
    const failedTitles = trusted1.batch.map((rec) => rec.title);
    const strictPrompt = buildRecommendationPrompt(candidateInput, {
      strictSubscription: true,
      intentContract,
      count: candidateCount,
      failedTitles,
    });
    const traceStart = trace.length;
    const raw2 = await getRecommendations(candidateInput, strictPrompt, trace, intentContract, deadlineAt);
    strictFallbackUsed = trace.slice(traceStart).some((item) => item.provider === "local fallback");
    const filtered2 = applyTrustFilter(
      candidateInput,
      filterFalsePositiveRecommendations(candidateInput, raw2).slice(0, candidateCount),
      intentContract,
    );
    if (filtered2.accepted.length > 0) {
      enriched2 = await enrichBatch(filtered2.accepted, country, platforms, timings);
      const verified2 = enriched2.filter(hasSubscriptionProvider).slice(0, count);
      if (verified2.length > 0) {
        return { picks: verified2, displayState: "verified", rejections: trusted1.rejections, fallbackUsed: strictFallbackUsed };
      }
    }
  } catch {
    // fall through to step 3
  }

  // Step 3 — curated fallback verified against subscription.
  // Check the full curated pool (not artificially capped at 3).
  const curatedTrusted = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
  const curated = curatedTrusted.accepted.length > 0 ? curatedTrusted.accepted : [safeFallback(input)];
  const enrichedCurated = await enrichBatch(curated, country, platforms, timings);
  const verifiedCurated = enrichedCurated.filter(hasSubscriptionProvider).slice(0, count);
  if (verifiedCurated.length > 0) {
    return { picks: verifiedCurated, displayState: "verified", rejections: trusted1.rejections, fallbackUsed: true };
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
    fallbackUsed: trusted1.fallbackUsed || strictFallbackUsed,
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

// F.U.N matches a mood to a title; it does not identify a specific half-remembered film from
// plot fragments. Rather than force that request through the mood pipeline and risk the model
// fabricating a plausible-sounding but nonexistent title, decline honestly and say what this
// product actually does. See isPlotIdentificationRequest for the detection heuristic.
function plotIdentificationDeclineResponse(country: string): Recommendation {
  return {
    title: "F.U.N can't identify a movie from a plot description",
    year: "",
    format: "Unknown",
    runtime: "",
    vibe: "",
    confidence: 0,
    oneLine: "F.U.N matches how you want to feel tonight to a title — it doesn't identify a specific half-remembered movie from a scene or plot fragment.",
    whyItFits: [
      "Try describing the mood or vibe you're after instead, and F.U.N will find a real match.",
      "For identifying a specific half-remembered film, a dedicated tip-of-my-tongue community or search is a better fit.",
    ],
    whereToWatch: {
      status: "unverified",
      primary: "Not applicable",
      note: "This request needs film identification, not mood matching.",
      providers: [],
      country,
    },
    hiddenLayer: { headline: "", insight: "", classyJab: "" },
    alternatives: [],
    contentCategory: [],
    emotionalEffect: [],
  };
}

export async function POST(req: Request) {
  try {
    const requestStarted = Date.now();

    // Checked before any body parsing or LLM call — a blocked request must cost nothing.
    const rateLimit = await checkRateLimit(callerIp(req));
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: "You've reached today's free limit. Please try again tomorrow." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    let rawInput: unknown;
    try {
      rawInput = await readJsonBodyWithLimit(req);
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return NextResponse.json({ error: "Request is too large." }, { status: 413 });
      }
      return NextResponse.json({ error: "Invalid recommendation request." }, { status: 400 });
    }
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      return NextResponse.json({ error: "Invalid recommendation request." }, { status: 400 });
    }
    let input = normalizeRecommendRequest(rawInput as RecommendRequest);
    const country = input.country || "Poland";

    // Public preview is scoped to launch-scope.ts's PREVIEW_COUNTRY_CODES. The onboarding picker
    // already only offers preview countries, but this is server-authoritative defense-in-depth
    // against a direct API call bypassing the UI. Production-only, same as the rate limiter: local
    // dev and the QA gate/regression suites deliberately exercise many countries to validate
    // language-lane and subscription logic unrelated to public-preview access control.
    if (process.env.NODE_ENV === "production") {
      const countryCode = countryCodeMap[country.trim().toLowerCase()];
      if (!countryCode || !isPreviewCountry(countryCode)) {
        return NextResponse.json(
          { error: "F.U.N is in a limited preview for the UK and Ireland right now — more regions coming soon." },
          { status: 403 },
        );
      }
    }

    // Bail out before any LLM call — this request type is out of scope for mood matching,
    // and attempting it anyway is exactly what produced a fabricated, nonexistent title.
    if (input.selfText && isPlotIdentificationRequest(input.selfText)) {
      return NextResponse.json({
        ...plotIdentificationDeclineResponse(country),
        displayState: "unverified",
        _trust: { diagnostics: { source: "declined", degraded: false, retryCount: 0 } },
      });
    }

    const platforms = input.platforms ?? [];
    const avoids = activeHardAvoidanceKeys(input);
    const subscriptionOnly = input.platformFilter === "mine";
    const providerTrace: ProviderTrace[] = [];
    // Two-phase fetch: client sends 1 for the fast initial pick, 2 for the background fill call
    // that tops the batch up to 3. Omitted (undefined) keeps today's single 3-at-once behavior.
    const count = input.recommendationCount ?? 3;
    const deadlineAt = requestStarted + (input.responseDetail === "core" ? CORE_REQUEST_BUDGET_MS : FULL_REQUEST_BUDGET_MS);
    const timings: RecommendationTimings = {
      intentMs: 0,
      recommendationMs: 0,
      verificationMs: 0,
      postProcessingMs: 0,
      totalMs: 0,
    };

    let intentContract: IntentContract;
    let prompt: string;
    let enrichedBatch: Recommendation[];
    let displayState: RecommendationDisplayState;
    let trustRejections: TrustRejection[];
    let fallbackUsed = false;

    if (subscriptionOnly) {
      // Subscription chain has multiple sequential LLM steps — keep intent sequential
      // to avoid extra concurrent Anthropic calls that push total time past limits.
      const intentStarted = Date.now();
      intentContract = await resolveIntentContract(input, providerTrace);
      input = applyIntentExclusions(input, intentContract);
      timings.intentMs += Date.now() - intentStarted;
      const recommendationStarted = Date.now();
      const chain = await subscriptionVerifiedChain(input, country, providerTrace, intentContract, count, deadlineAt, timings);
      timings.recommendationMs += Date.now() - recommendationStarted - timings.verificationMs;
      enrichedBatch = chain.picks;
      displayState = chain.displayState;
      trustRejections = chain.rejections;
      fallbackUsed = chain.fallbackUsed;
    } else if (input.mode === "self" || input.precomputedIntentContract) {
      // Free-text Describe requests need the semantic intent contract to shape the actual pick,
      // not merely validate a speculative pick afterward. Background fills already carry that
      // resolved contract, so this path still costs only one recommendation call for them.
      const intentStarted = Date.now();
      intentContract = await resolveIntentContract(input, providerTrace);
      input = applyIntentExclusions(input, intentContract);
      timings.intentMs += Date.now() - intentStarted;
      prompt = buildRecommendationPrompt(input, { intentContract, count });
      const recommendationStarted = Date.now();
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract, null, count, deadlineAt);
      timings.recommendationMs += Date.now() - recommendationStarted;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = trustedRaw.fallbackUsed;
      enrichedBatch = await enrichBatch(trustedRaw.batch, country, platforms, timings);
      displayState = "unverified";
    } else {
      // Fresh structured Choose requests can safely run intent classification and recommendation
      // generation in parallel. Their controls already provide an explicit local contract; the
      // resolved LLM contract remains the trust authority before anything is served.
      const localContract = localIntentContract(input);
      const localPrompt = buildRecommendationPrompt(input, { intentContract: localContract, count });
      const parallelTrace: ProviderTrace[] = [];

      const [resolvedContract, precomputedBatch] = await Promise.all([
        resolveIntentContract(input, providerTrace),
        getRecommendations(input, localPrompt, parallelTrace, localContract, deadlineAt).catch(() => null as RawRecommendation[] | null),
      ]);
      timings.intentMs += providerTrace
        .filter((item) => item.provider.startsWith("Intent "))
        .reduce((total, item) => total + item.durationMs, 0);
      timings.recommendationMs += parallelTrace.reduce((total, item) => total + item.durationMs, 0);
      providerTrace.push(...parallelTrace);
      intentContract = resolvedContract;
      input = applyIntentExclusions(input, intentContract);

      // Quality gate for the speed optimization: only reuse the precomputed batch (generated from
      // the local contract) when local and LLM intent agree on the primary outcome. On disagreement
      // — e.g. local read "comfort" but the LLM read "bleak" — discard it and let trustedRawBatch
      // regenerate from the richer LLM-contract prompt. Costs one extra LLM call only on disagreement.
      const intentsAgree =
        intentContract.source !== "llm" ||
        intentContract.primary === "unknown" ||
        localContract.primary === intentContract.primary ||
        localContract.secondary.includes(intentContract.primary) ||
        intentContract.secondary.includes(localContract.primary);
      const usableBatch = intentsAgree ? precomputedBatch : null;
      if (!intentsAgree) {
        providerTrace.push({
          provider: "parallel-batch discarded (intent disagreement)",
          durationMs: 0,
          ok: true,
          promptChars: 0,
        });
      }

      // LLM-contract prompt for retry if the precomputed batch fails trust
      prompt = buildRecommendationPrompt(input, { intentContract, count });
      const retryStarted = Date.now();
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract, usableBatch, count, deadlineAt);
      timings.recommendationMs += Date.now() - retryStarted;
      const normalizedBatch = trustedRaw.batch;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = trustedRaw.fallbackUsed;
      enrichedBatch = await enrichBatch(normalizedBatch, country, platforms, timings);
      displayState = "unverified";
    }

    // Post-chain gates are skipped when the subscription chain already concluded no-subscription-match.
    // Avoidance and language fallbacks must not quietly replace a declared no-match state
    // with another unverified pick that would confuse the UI.

    if (displayState !== "no-subscription-match") {
      const confirmed = enrichedBatch.filter(catalogConfirmed);
      if (confirmed.length > 0 && confirmed.length < enrichedBatch.length) {
        trustRejections.push(...enrichedBatch
          .filter((rec) => !catalogConfirmed(rec))
          .map((rec) => ({
            title: rec.title,
            reasons: ["metadata: title not confirmed in TMDB/OMDb/catalogue data"],
          })));
        enrichedBatch = confirmed;
      }
    }

    if (displayState !== "no-subscription-match" && genreNeutralBingeShouldAvoidHorror(input, intentContract)) {
      const nonHorror = enrichedBatch.filter((rec) =>
        !(rec.contentMetadata?.genreIds?.includes(27) || textSuggestsAvoidance(["horror"], rec))
      );
      if (nonHorror.length > 0) {
        trustRejections.push(...enrichedBatch
          .filter((rec) => rec.contentMetadata?.genreIds?.includes(27) || textSuggestsAvoidance(["horror"], rec))
          .map((rec) => ({
            title: rec.title,
            reasons: ["intent: genre-neutral binge request defaulted to horror"],
          })));
        enrichedBatch = nonHorror;
      }
    }

    // For an explicitly strong fear request, do not trust the model's self-label alone. Confirm
    // horror against the metadata already fetched for availability/posters. This catches a real
    // title such as a romance being hallucinated as "psychological horror" without another API call.
    if (requiresConfirmedHorror(input, intentContract) && displayState !== "no-subscription-match") {
      const confirmedHorror = enrichedBatch.filter(metadataConfirmsHorror);
      if (confirmedHorror.length > 0) {
        const rejected = enrichedBatch.filter((rec) => !metadataConfirmsHorror(rec));
        trustRejections.push(...rejected.map((rec) => ({
          title: rec.title,
          reasons: ["metadata: strong fear request requires confirmed horror"],
        })));
        enrichedBatch = confirmedHorror;
      } else {
        trustRejections.push(...enrichedBatch.map((rec) => ({
          title: rec.title,
          reasons: ["metadata: strong fear request requires confirmed horror"],
        })));
        const trustedFallback = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
        trustRejections.push(...trustedFallback.rejected);
        const fallback = await enrichBatch(trustedFallback.accepted.slice(0, Math.max(count, 3)), country, platforms, timings);
        const confirmedFallback = fallback
          .filter(metadataConfirmsHorror)
          .filter((rec) => matchesLanguageRequest(input, rec))
          .slice(0, count);
        enrichedBatch = confirmedFallback;
        fallbackUsed = true;
      }
    }

    // Three-bucket genre gate:
    //   verifiedClean    — TMDB returned genre data AND no avoidance violation → serve first
    //   textSafeUnknown  — TMDB had no genre data AND title/vibe text isn't suspicious → serve if no verifiedClean
    //   everything else  — confirmed violation OR suspicious text → fail closed with safe fallback
    //
    // "gore" maps to the same TMDB genre id as "horror" (27) — TMDB has no distinct gore genre.
    // For a genuine "scare" request, requiresConfirmedHorror above already filtered enrichedBatch
    // down to genre-27-confirmed titles specifically because scare needs that genre. Checking
    // "gore" against genre 27 here would then reject every one of those candidates on the very
    // property that made them valid, making "scary but no gore" — one of the most common ways
    // people phrase a scare request — structurally unsatisfiable. Gore avoidance for a scare
    // primary is enforced via the text/label signal below instead; the genre-id proxy is only
    // meaningful for gore avoidance when horror itself isn't the desired outcome.
    const genreGateAvoids = intentContract.primary === "scare" ? avoids.filter((avoid) => avoid !== "gore") : avoids;
    if (genreGateAvoids.length > 0 && displayState !== "no-subscription-match") {
      const withGenreData = enrichedBatch.filter((rec) => (rec.contentMetadata?.genreIds?.length ?? 0) > 0);
      const withoutGenreData = enrichedBatch.filter((rec) => (rec.contentMetadata?.genreIds?.length ?? 0) === 0);
      const verifiedClean = withGenreData.filter((rec) => !genreViolatesAvoidance(genreGateAvoids, rec.contentMetadata!.genreIds!));
      const textSafeUnknown = withoutGenreData.filter((rec) => !textSuggestsAvoidance(avoids, rec));

      if (verifiedClean.length > 0) {
        enrichedBatch = verifiedClean;
      } else if (textSafeUnknown.length > 0) {
        enrichedBatch = textSafeUnknown;
      } else {
        const fallbackRaw = safeFallback(input);
        const verificationStarted = Date.now();
        const fallback = await enrichRecommendation(fallbackRaw, country, platforms);
        timings.verificationMs += Date.now() - verificationStarted;
        enrichedBatch = [hasSubscriptionProvider(fallback) ? fallback : unavailableSubscriptionFallback(fallback, country)];
        displayState = "avoidance-fallback";
      }
    }

    if (displayState !== "no-subscription-match") {
      const languageMatchedBatch = enrichedBatch.filter((recommendation) => matchesLanguageRequest(input, recommendation));
      if (languageMatchedBatch.length > 0) {
        enrichedBatch = languageMatchedBatch;
      } else if (wantsSpecificLanguage(input)) {
        // All LLM picks were confirmed wrong-language. Try curated local fallback filtered to the
        // requested language; if the fallback has no titles in that lane (common for non-Hindi),
        // serve the fallback anyway rather than an empty result — the confirmed-mismatch LLM picks
        // are already dropped, which is the primary language-lane guarantee.
        const trustedFallback = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
        trustRejections.push(...trustedFallback.rejected);
        const fallback = (await enrichBatch(trustedFallback.accepted, country, platforms, timings)).slice(0, count);
        const filteredFallback = fallback.filter((recommendation) => matchesLanguageRequest(input, recommendation));
        enrichedBatch = filteredFallback.length > 0 ? filteredFallback : fallback;
      }
    }

    if (enrichedBatch.length === 0) {
      const fallbackRaw = applyTrustFilter(input, [safeFallback(input)], intentContract).accepted[0] ?? safeFallback(input);
      const verificationStarted = Date.now();
      const fallback = await enrichRecommendation(fallbackRaw, country, platforms);
      timings.verificationMs += Date.now() - verificationStarted;
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

    const postProcessingStarted = Date.now();
    enrichedBatch = enrichedBatch.map((item) => sanitizeRelatedForRequest(input, item, intentContract));

    const firstPick = enrichedBatch[0];
    if (displayState !== "no-subscription-match" && displayState !== "avoidance-fallback") {
      displayState = firstPick.whereToWatch.status === "verified" ? "verified" : "unverified";
    }
    timings.postProcessingMs += Date.now() - postProcessingStarted;
    timings.totalMs = Date.now() - requestStarted;

    const successfulProvider = providerTrace.find((item) =>
      item.ok &&
      !item.provider.startsWith("Intent ") &&
      !item.provider.startsWith("parallel-batch discarded"),
    );
    const source = successfulProvider?.provider === "local fallback" ? "local-fallback" : fallbackUsed ? "fallback" : "llm";
    const failedProviders = providerTrace.filter((item) => !item.ok);
    const degradeReason =
      displayState === "no-subscription-match" ? "no_clean_match" :
      displayState === "avoidance-fallback" ? "constraint_fallback" :
      source === "fallback" ? "model_or_trust_fallback" :
      failedProviders.length > 0 ? "provider_failover" :
      undefined;
    const providerVerification =
      firstPick.whereToWatch.status === "verified" ? "verified" :
      firstPick.whereToWatch.status === "unverified" ? "unverified" :
      "skipped";

    // Correlation ID: client generates this before the fetch and reuses the same value when it
    // later reports the displayed pick to /api/recommendation-runs. Logging it here — together
    // with what this call actually returned — is what makes "the model said X, the user saw Y"
    // answerable by one ID lookup instead of guessing which of several calls a title came from.
    const runId = typeof input.runId === "string" && input.runId ? input.runId : `srv-${Date.now().toString(36)}`;
    console.log(
      `[FUN recommend] runId=${runId} count=${count} responseDetail=${input.responseDetail ?? "full"} ` +
      `title=${JSON.stringify(firstPick.title)} batch=${JSON.stringify(enrichedBatch.map((r) => r.title))} ` +
      `source=${source} degraded=${degradeReason ?? "false"} totalMs=${timings.totalMs}`,
    );

    return NextResponse.json({
      ...firstPick,
      _batch: enrichedBatch,
      _batchIndex: 0,
      _trust: {
        rejections: trustRejections,
        displayState,
        fallbackUsed,
        // Two-phase fetch: lets the client know whether to fire a background fill call, and lets
        // that fill call reuse this response's intent contract instead of re-classifying intent.
        intentContract,
        batchComplete: count >= 3,
        diagnostics: {
          runId,
          source,
          providerVerification,
          degraded: Boolean(degradeReason),
          degradeReason,
          timings,
          retryCount: Math.max(0, providerTrace.filter((item) =>
            !item.provider.startsWith("Intent ") &&
            !item.provider.startsWith("parallel-batch discarded"),
          ).length - 1),
        },
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
