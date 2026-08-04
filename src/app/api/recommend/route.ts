import { NextResponse, after } from "next/server";
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
import { matchesAvoidedLanguageRequest, matchesLanguageRequest, wantsSpecificLanguage, wantsToAvoidLanguage } from "@/lib/language-lane";
import { countryCodeMap, isPlotIdentificationRequest, normalizeRecommendRequest, requestText } from "@/lib/recommendation-utils";
import { isPreviewCountry } from "@/lib/launch-scope";
import { callerIp, checkRateLimit } from "@/lib/rate-limit";
import { getProfileRecentTitles } from "@/lib/anonymous-profile-store";
import { writeRecommendationDiagnostics } from "@/lib/recommendation-diagnostics-store";
import { IntentContract, RawRecommendation, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

// Disabled by default while production credentials and fallback behavior are reviewed.
// Re-enable deliberately after validation with FUN_ENABLE_ANTHROPIC=1.
const anthropicEnabled = process.env.FUN_ENABLE_ANTHROPIC === "1";
const MAX_RECOMMEND_REQUEST_BYTES = 131_072;

// Off by default: measured live against real free-text prompts, the local-vs-LLM disagreement
// rate was ~80% — far higher than the structured "choose" mode this pattern was ported from. On
// disagreement, the request pays for the wasted speculative call *plus* a full sequential retry,
// making the common case slower than the original sequential path (e.g. 17-24s vs a ~6.5s median),
// not neutral as intended. Left available behind this flag (FUN_ENABLE_SELF_PARALLEL_INTENT=1)
// rather than deleted, since the mechanism is sound for structured input — it's specifically free
// text's weaker local contract driving the high disagreement rate, not a flaw in the approach
// itself. Re-enable only after that root cause has an actual fix, not just re-measurement.
const selfModeParallelIntentEnabled = process.env.FUN_ENABLE_SELF_PARALLEL_INTENT === "1";

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

// Split into fetch + merge so the Redis round-trip can run concurrently with intent classification
// (they're independent — exclusions only affect recommendation-time scoring, never intent
// classification) instead of paying for it sequentially before intent classification even starts.
// Measured directly: 126-496ms wasted serial time per request before this split.
function fetchServerProfileTitles(input: RecommendRequest): Promise<string[]> {
  if (!input.sessionId) return Promise.resolve([]);
  return getProfileRecentTitles(input.sessionId);
}

// Compact, metrics-only diagnostics event — see recommendation-diagnostics-store.ts for why this
// stays isolated from recommendation logic. `payload` is exactly what's about to be sent to the
// client, so this never re-derives anything, just reads it back out.
function buildDiagnosticsEvent(input: RecommendRequest, payload: Record<string, unknown>) {
  const trust = payload._trust as {
    rejections: unknown[];
    displayState: string;
    fallbackUsed: boolean;
    diagnostics: { runId: string; source: string; degraded: boolean; degradeReason?: string; timings: Record<string, number>; retryCount: number };
  };
  return {
    schemaVersion: 1 as const,
    runId: trust.diagnostics.runId,
    createdAt: new Date().toISOString(),
    sessionId: input.sessionId,
    mode: input.mode,
    country: input.country,
    title: payload.title as string,
    year: payload.year as string,
    confidence: payload.confidence as number | undefined,
    displayState: trust.displayState,
    fallbackUsed: trust.fallbackUsed,
    source: trust.diagnostics.source,
    degraded: trust.diagnostics.degraded,
    degradeReason: trust.diagnostics.degradeReason,
    timings: trust.diagnostics.timings,
    retryCount: trust.diagnostics.retryCount,
    rejectionCount: trust.rejections.length,
  };
}

function mergeServerProfileTitles(input: RecommendRequest, profileTitles: string[]): RecommendRequest {
  if (!profileTitles.length) return input;
  const combined = [...(input.excludedTitles ?? []), ...profileTitles];
  const seen = new Set<string>();
  const excludedTitles = combined.filter((title) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
  return { ...input, excludedTitles };
}

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

// Preview-stage mitigation for cross-lane repetition: the same "safe" title winning across many
// different comfort-adjacent asks (breakup comfort, stressed from work, family visiting) even
// though per-category rotation already exists, because these specific titles are members of
// several curated categories at once (see fallbacks.ts/recommendation-trust.ts). A soft, moderate
// penalty — not a reject, they're still genuinely good picks — applied only in lanes where a
// repeated familiar winner actually hurts trust, and skipped for language- or subscription-
// constrained requests where the candidate pool is already thin. Static and hand-curated from
// titles this session's testing directly observed repeating; revisit as new repeat offenders turn
// up, rather than building live serve-frequency tracking before this preview needs it.
const wellKnownSafeTitles = new Set(
  [
    "The Intouchables", "The Grand Budapest Hotel", "The Fundamentals of Caring", "Hundreds of Beavers", "The Fall",
    "Paddington 2", "The Good Place", "School of Rock", "Schitt's Creek",
  ].map(normalizeTitle),
);

function isRepetitionSensitiveLane(intentContract?: IntentContract): boolean {
  if (!intentContract) return false;
  const isReliefState = intentContract.situation.some((value) => value.includes("breakup-recovery") || value.includes("grief-relief") || value.includes("panic"));
  return intentContract.primary === "comfort" ||
    intentContract.primary === "weird" ||
    intentContract.primary === "discovery" ||
    intentContract.discoveryPreference === "non-mainstream" ||
    isReliefState ||
    intentContract.situation.includes("family");
}

function isConstrainedLane(intentContract?: IntentContract, input?: RecommendRequest): boolean {
  const languageConstrained = Boolean(intentContract && intentContract.language !== "any");
  const subscriptionConstrained = input?.platformFilter === "mine";
  return languageConstrained || subscriptionConstrained;
}

// Safe-cluster diversity fix: repetition-sensitive lanes (comfort/weird/discovery/relief/family)
// previously only ever ranked whatever `count` (usually 3) items the LLM itself chose to generate
// — the wellKnownSafeTitles penalty could reorder those 3, but could never promote a genuinely
// different answer the model never proposed. Live testing showed 4 differently-phrased generic
// comfort asks collapsing to the same 3 titles despite that penalty already being applied. Asking
// for a wider raw pool here gives the ranking step real alternatives to work with, while
// hard-exclusion (seen/excluded titles, -50) stays separate from this soft "overused but still
// valid" pressure, matching the existing two-tier design.
function candidateRequestCount(count: number, intentContract?: IntentContract): number {
  return isRepetitionSensitiveLane(intentContract) ? Math.min(count + 2, 5) : count;
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

  if (isRepetitionSensitiveLane(intentContract) && !isConstrainedLane(intentContract, input) && wellKnownSafeTitles.has(normalizeTitle(rec.title))) {
    score -= 7;
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

      // Lane-specific differentiation: breakup/grief/family were all scored identically to
      // generic comfort above, which let the same handful of generically-warm titles win
      // regardless of which specific situation was actually in play. These add situation-
      // appropriate signal on top, not a replacement for the generic comfort bar.
      const situation = intentContract.situation;
      if (situation.some((value) => value.includes("breakup"))) {
        if (["friendship", "self-discovery", "ensemble", "found-family", "independence", "empowerment"].some((label) => labels.has(label))) score += 5;
        if (["romance", "romantic", "love-story", "chemistry"].some((label) => labels.has(label))) score -= 12;
      }
      if (situation.some((value) => value.includes("grief"))) {
        if (["healing", "restorative", "hope", "hopeful", "acceptance", "connection"].some((label) => labels.has(label))) score += 5;
      }
      if (situation.includes("family")) {
        if (["family", "wholesome", "all-ages", "ensemble"].some((label) => labels.has(label))) score += 5;
        if (["raunchy", "crude", "adult-humor", "edgy"].some((label) => labels.has(label))) score -= 8;
      }
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
  serveCount = count,
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
        batch: rankedAccepted.slice(0, serveCount),
        rejections: allRejections,
        fallbackUsed: trace.slice(traceStart).some((item) => item.provider === "local fallback"),
      };
    }
  }

  const localTrusted = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
  allRejections.push(...localTrusted.rejected);
  if (localTrusted.accepted.length > 0) {
    return { batch: localTrusted.accepted.slice(0, serveCount), rejections: allRejections, fallbackUsed: true };
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
    // Kicked off here (not awaited) so this Redis round-trip runs concurrently with intent
    // classification below instead of paying for it sequentially first — see
    // fetchServerProfileTitles's comment. Started after the geo-scope/plot-decline bail-outs so a
    // rejected request doesn't pay for it at all.
    const serverProfileTitlesPromise = fetchServerProfileTitles(input);

    // Opt-in staged progress (Tier 2 speed work — perceived, not actual, latency). Only the real
    // frontend sets `stream: true`; test:gate/test:recommendation and any other direct caller keep
    // getting today's exact single-JSON-blob response, untouched. `controller` stays null unless a
    // stream is actually constructed below, so every `emitStage` call in the logic that follows is
    // a harmless no-op on the non-streaming path — the same code runs either way.
    const wantsStream = input.stream === true;
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    function emitStage(stage: string) {
      if (!streamController) return;
      streamController.enqueue(encoder.encode(`${JSON.stringify({ type: "stage", stage })}\n`));
    }

    async function buildResult(): Promise<Record<string, unknown>> {
      // First real checkpoint — "understanding your mood" covers everything up to and including
      // intent classification, emitted as soon as buildResult actually starts running (i.e. once
      // streaming, right after the stream opens; on the non-streaming path this is a no-op).
      emitStage("understanding");
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
      const [subIntentContract, subProfileTitles] = await Promise.all([
        resolveIntentContract(input, providerTrace),
        serverProfileTitlesPromise,
      ]);
      intentContract = subIntentContract;
      input = mergeServerProfileTitles(input, subProfileTitles);
      input = applyIntentExclusions(input, intentContract);
      timings.intentMs += Date.now() - intentStarted;
      emitStage("checking-fit");
      const recommendationStarted = Date.now();
      // subscriptionVerifiedChain does its own TMDB verification internally across multiple
      // candidate rounds, so "verifying" covers its whole call rather than a point inside it.
      emitStage("verifying");
      const chain = await subscriptionVerifiedChain(input, country, providerTrace, intentContract, count, deadlineAt, timings);
      timings.recommendationMs += Date.now() - recommendationStarted - timings.verificationMs;
      enrichedBatch = chain.picks;
      displayState = chain.displayState;
      trustRejections = chain.rejections;
      fallbackUsed = chain.fallbackUsed;
    } else if (input.precomputedIntentContract) {
      // Background fills already carry phase 1's resolved contract — resolveIntentContract
      // short-circuits to a zero-cost reuse. Still worth running the exclusion fetch alongside it
      // rather than before it — costs nothing extra, same reasoning as the other branches.
      const intentStarted = Date.now();
      const [fillIntentContract, fillProfileTitles] = await Promise.all([
        resolveIntentContract(input, providerTrace),
        serverProfileTitlesPromise,
      ]);
      intentContract = fillIntentContract;
      input = mergeServerProfileTitles(input, fillProfileTitles);
      input = applyIntentExclusions(input, intentContract);
      timings.intentMs += Date.now() - intentStarted;
      emitStage("checking-fit");
      const requestCount = candidateRequestCount(count, intentContract);
      prompt = buildRecommendationPrompt(input, { intentContract, count: requestCount });
      const recommendationStarted = Date.now();
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract, null, requestCount, deadlineAt, count);
      timings.recommendationMs += Date.now() - recommendationStarted;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = trustedRaw.fallbackUsed;
      emitStage("verifying");
      enrichedBatch = await enrichBatch(trustedRaw.batch, country, platforms, timings);
      displayState = "unverified";
    } else if (input.mode === "self" && !selfModeParallelIntentEnabled) {
      // Default path: original sequential behavior. See selfModeParallelIntentEnabled above for why.
      const intentStarted = Date.now();
      const [selfIntentContract, selfProfileTitles] = await Promise.all([
        resolveIntentContract(input, providerTrace),
        serverProfileTitlesPromise,
      ]);
      intentContract = selfIntentContract;
      input = mergeServerProfileTitles(input, selfProfileTitles);
      input = applyIntentExclusions(input, intentContract);
      timings.intentMs += Date.now() - intentStarted;
      emitStage("checking-fit");
      const requestCount = candidateRequestCount(count, intentContract);
      prompt = buildRecommendationPrompt(input, { intentContract, count: requestCount });
      const recommendationStarted = Date.now();
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract, null, requestCount, deadlineAt, count);
      timings.recommendationMs += Date.now() - recommendationStarted;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = trustedRaw.fallbackUsed;
      emitStage("verifying");
      enrichedBatch = await enrichBatch(trustedRaw.batch, country, platforms, timings);
      displayState = "unverified";
    } else if (input.mode === "self") {
      // Free-text Describe requests: 95% of first-pick production traffic, and previously fully
      // sequential (intentMs + recommendationMs back to back) while structured Choose requests
      // below already ran both concurrently. Mirrors that proven pattern, but free text's local
      // (regex) contract is coarser than structured picker taps, so the bar for reusing the
      // speculative batch is stricter here: format and hard-avoids must also match, not just
      // primary/secondary — a silent mismatch on those would be a real quality regression that
      // primary-only agreement could miss.
      // Merged before localPrompt is built (not run alongside the speculative call below) — the
      // speculative call's prompt has to already reflect the full exclusion list, since it can be
      // served directly on agreement. By this point the fetch has already had the geo-scope/
      // plot-decline checks' time to progress in the background, so this await is usually cheap.
      input = mergeServerProfileTitles(input, await serverProfileTitlesPromise);
      const localContract = localIntentContract(input);
      const localRequestCount = candidateRequestCount(count, localContract);
      const localPrompt = buildRecommendationPrompt(input, { intentContract: localContract, count: localRequestCount });
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

      const primaryAgrees =
        intentContract.source !== "llm" ||
        intentContract.primary === "unknown" ||
        localContract.primary === intentContract.primary ||
        localContract.secondary.includes(intentContract.primary) ||
        intentContract.secondary.includes(localContract.primary);
      const constraintsAgree =
        localContract.format === intentContract.format &&
        localContract.hardAvoids.length === intentContract.hardAvoids.length &&
        localContract.hardAvoids.every((avoid) => intentContract.hardAvoids.includes(avoid));
      const intentsAgree = primaryAgrees && constraintsAgree;
      const usableBatch = intentsAgree ? precomputedBatch : null;
      if (!intentsAgree) {
        providerTrace.push({
          provider: "parallel-batch discarded (intent disagreement)",
          durationMs: 0,
          ok: true,
          promptChars: 0,
        });
      }

      emitStage("checking-fit");
      const requestCount = candidateRequestCount(count, intentContract);
      prompt = buildRecommendationPrompt(input, { intentContract, count: requestCount });
      const retryStarted = Date.now();
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract, usableBatch, requestCount, deadlineAt, count);
      timings.recommendationMs += Date.now() - retryStarted;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = trustedRaw.fallbackUsed;
      emitStage("verifying");
      enrichedBatch = await enrichBatch(trustedRaw.batch, country, platforms, timings);
      displayState = "unverified";
    } else {
      // Fresh structured Choose requests can safely run intent classification and recommendation
      // generation in parallel. Their controls already provide an explicit local contract; the
      // resolved LLM contract remains the trust authority before anything is served.
      // Merged before localPrompt is built, not run alongside the speculative call — see the
      // matching comment in the self-mode parallel branch above for why.
      input = mergeServerProfileTitles(input, await serverProfileTitlesPromise);
      const localContract = localIntentContract(input);
      const localRequestCount = candidateRequestCount(count, localContract);
      const localPrompt = buildRecommendationPrompt(input, { intentContract: localContract, count: localRequestCount });
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

      emitStage("checking-fit");
      // LLM-contract prompt for retry if the precomputed batch fails trust
      const requestCount = candidateRequestCount(count, intentContract);
      prompt = buildRecommendationPrompt(input, { intentContract, count: requestCount });
      const retryStarted = Date.now();
      const trustedRaw = await trustedRawBatch(input, prompt, providerTrace, intentContract, usableBatch, requestCount, deadlineAt, count);
      timings.recommendationMs += Date.now() - retryStarted;
      const normalizedBatch = trustedRaw.batch;
      trustRejections = trustedRaw.rejections;
      fallbackUsed = trustedRaw.fallbackUsed;
      emitStage("verifying");
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

    // Negated language requests ("not in Spanish") — prompt guidance alone was confirmed
    // insufficient (route.ts's intent-contract prompt still let the LLM default to the reference's
    // own language). Enforced here as a hard reject, mirroring the positive-language block above.
    if (displayState !== "no-subscription-match" && wantsToAvoidLanguage(input)) {
      const avoidedLanguageMatchedBatch = enrichedBatch.filter((recommendation) => matchesAvoidedLanguageRequest(input, recommendation));
      if (avoidedLanguageMatchedBatch.length > 0) {
        enrichedBatch = avoidedLanguageMatchedBatch;
      } else {
        // Every LLM pick was confirmed to be the avoided language — fall back to curated local
        // picks, same "confirmed mismatch dropped is the guarantee" posture as the positive lane.
        const trustedFallback = applyTrustFilter(input, filteredLocalFallback(input, intentContract), intentContract);
        trustRejections.push(...trustedFallback.rejected);
        const fallback = (await enrichBatch(trustedFallback.accepted, country, platforms, timings)).slice(0, count);
        const filteredFallback = fallback.filter((recommendation) => matchesAvoidedLanguageRequest(input, recommendation));
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

    return {
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
    };
    }

    if (!wantsStream) {
      const payload = await buildResult();
      after(() => writeRecommendationDiagnostics(buildDiagnosticsEvent(input, payload)));
      return NextResponse.json(payload);
    }

    // Streaming path: return the Response immediately (headers committed to 200 here), then
    // populate the body asynchronously as buildResult() runs. Errors from this point on can no
    // longer change the HTTP status — they travel in-band as a terminal "error" line instead, which
    // page.tsx's stream reader treats the same way it treats today's non-streaming error path.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        streamController = controller;
        try {
          const payload = await buildResult();
          void writeRecommendationDiagnostics(buildDiagnosticsEvent(input, payload));
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", payload })}\n`));
        } catch (error) {
          console.error("Recommendation route failed (streamed):", error);
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: "error",
            error: "Recommendation failed. Check API keys or model output.",
          })}\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-transform",
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
