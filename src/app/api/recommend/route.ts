import { after, NextResponse } from "next/server";
import { filterFalsePositiveRecommendations, localFallback } from "@/lib/fallbacks";
import {
  interpretIntentWithAnthropic,
  interpretIntentWithGenericLLM,
  interpretIntentWithOpenAI,
  recommendWithAnthropic,
  recommendWithGenericLLM,
  recommendWithOpenAI,
  type LlmCallTelemetry,
} from "@/lib/llm";
import { extractIntent } from "@/lib/intent";
import { enrichRecommendation } from "@/lib/metadata";
import { buildCompactRetryPrompt, buildRecommendationPrompt } from "@/lib/prompt";
import { activeHardAvoidanceKeys, applyTrustFilter, relatedTitleUnsafe, safeFallback, TrustRejection } from "@/lib/recommendation-trust";
import { buildIntentContractPrompt, localIntentContract, normalizeIntentContract } from "@/lib/intent-contract";
import { matchesLanguageRequest, wantsSpecificLanguage } from "@/lib/language-lane";
import { normalizeRecommendRequest } from "@/lib/recommendation-utils";
import { IntentContract, RawRecommendation, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";
import { writeRecommendationDiagnostics } from "@/lib/recommendation-diagnostics-store";

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
};

// Text keywords used as a secondary safety net when TMDB has no genre data.
// Deliberately narrow — only flag obvious matches, not borderline ones.
const AVOIDANCE_SUSPICION_KEYWORDS: Record<string, string[]> = {
  horror: ["horror", "haunted", "haunting", "ghost", "demon", "slasher", "zombie", "terrifying", "nightmarish", "supernatural horror"],
  "supernatural horror": ["supernatural", "haunted", "haunting", "ghost", "demon", "possession", "occult"],
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
  calls?: LlmCallTelemetry[];
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

  const tryIntent = async (
    provider: string,
    run: (record: (value: LlmCallTelemetry) => void) => Promise<Record<string, unknown>>,
  ) => {
    const calls: LlmCallTelemetry[] = [];
    try {
      const raw = await run((value) => calls.push(value));
      const contract = normalizeIntentContract(raw, input);
      trace.push({
        provider,
        durationMs: Date.now() - started,
        ok: true,
        promptChars: prompt.length,
        calls: calls.length ? calls : undefined,
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
        calls: calls.length ? calls : undefined,
      });
      console.warn(`${provider} failed:`, message);
      return null;
    }
  };

  // Try only one configured provider for intent classification to avoid adding another long sequential chain.
  if (process.env.OPENAI_API_KEY) {
    return await tryIntent(
      `Intent OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`,
      (record) => interpretIntentWithOpenAI(prompt, {
        captureContent: process.env.FUN_COLLECT_PROMPTS === "true",
        onCall: record,
      }),
    ) ?? local;
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
  run: (record: (value: LlmCallTelemetry) => void) => Promise<RawRecommendation[]>,
): Promise<RawRecommendation[] | null> {
  const started = Date.now();
  const calls: LlmCallTelemetry[] = [];
  try {
    const batch = await run((value) => calls.push(value));
    trace.push({
      provider,
      durationMs: Date.now() - started,
      ok: true,
      promptChars: prompt.length,
      count: batch.length,
      calls: calls.length ? calls : undefined,
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
      calls: calls.length ? calls : undefined,
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
    const batch = await tryProvider(
      trace,
      `OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`,
      prompt,
      (record) => recommendWithOpenAI(prompt, temperature, count, includeDiscovery, timeoutMs, {
        captureContent: process.env.FUN_COLLECT_PROMPTS === "true",
        onCall: record,
      }),
    );
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
    const normalizedBatch = filterFalsePositiveRecommendations(input, rawBatch).slice(0, count);

    const trusted = applyTrustFilter(input, normalizedBatch, intentContract);
    allRejections.push(...trusted.rejected);
    if (trusted.accepted.length > 0) {
      return {
        batch: trusted.accepted.slice(0, count),
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

  return { batch: [safeFallback(input, intentContract)], rejections: allRejections, fallbackUsed: true };
}

async function enrichBatch(
  batch: RawRecommendation[],
  country: string,
  platforms: string[],
  timings?: RecommendationTimings,
): Promise<Recommendation[]> {
  const started = Date.now();
  const recommendations = await Promise.all(batch.map((pick) => enrichRecommendation(pick, country, platforms)));
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
  const curated = curatedTrusted.accepted.length > 0 ? curatedTrusted.accepted : [safeFallback(input, intentContract)];
  const enrichedCurated = await enrichBatch(curated, country, platforms, timings);
  const verifiedCurated = enrichedCurated.filter(hasSubscriptionProvider).slice(0, count);
  if (verifiedCurated.length > 0) {
    return { picks: verifiedCurated, displayState: "verified", rejections: trusted1.rejections, fallbackUsed: true };
  }

  // Step 4 — no subscription match.
  // Return a single placeholder pick (not the full teaser batch) so the API response is well-formed.
  // The UI shows a clean no-match state; the pick title is used in the description only.
  const firstAttempted = enriched1[0] ?? enriched2[0] ?? enrichedCurated[0] ?? await enrichRecommendation(safeFallback(input, intentContract), country, platforms);
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

export async function POST(req: Request) {
  try {
    const requestStarted = Date.now();
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
        const fallbackRaw = safeFallback(input, intentContract);
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
      const contractFallback = safeFallback(input, intentContract);
      const fallbackRaw = applyTrustFilter(input, [contractFallback], intentContract).accepted[0] ?? contractFallback;
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
    const source = successfulProvider?.provider === "local fallback" || fallbackUsed ? "fallback" : "llm";
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
    const diagnostics = {
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
    };

    // Persist after the response lifecycle so diagnostics never add latency to the recommendation.
    // Full provider prompts/responses are included only when FUN_COLLECT_PROMPTS=true.
    after(async () => {
      try {
        await writeRecommendationDiagnostics({
          runId,
          request: input,
          intentContract,
          recommendation: firstPick,
          batch: enrichedBatch,
          rejections: trustRejections,
          fallbackUsed,
          displayState,
          diagnostics,
          providerTrace,
        });
      } catch (error) {
        console.warn("[FUN diagnostics write failed]", error);
      }
    });

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
        diagnostics,
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
