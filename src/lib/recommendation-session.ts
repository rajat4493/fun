import { IntentContract, RecommendRequest, Recommendation, RecommendationDisplayState, RecommendationFeedbackContext, WatchProvider } from "@/lib/types";

export const recommendationStorageKey = "fun:last-recommendation";
export const recommendationReadyEvent = "fun:recommendation-ready";
export const seenTitlesKey = "fun:seen-titles";
export const feedbackStorageKey = "fun:recommendation-feedback";
export const recentRecommendationTitlesKey = "fun:recent-recommendation-titles";
export const recommendationHistoryKey = "fun:recommendation-history";
export const dismissedPostWatchPromptKey = "fun:dismissed-post-watch-prompts";
export const sessionIdKey = "fun:session-id";

function saveLocalValue(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Optional device memory must not discard a successful recommendation. */ }
}

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = localStorage.getItem(sessionIdKey);
    if (existing && /^[a-zA-Z0-9_-]{1,96}$/.test(existing) && !["unknown", "ssr"].includes(existing)) return existing;
    const id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(sessionIdKey, id);
    return id;
  } catch {
    return "unknown";
  }
}

export function createRecommendationRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export type FeedbackReason =
  | "perfect"
  | "good-not-perfect"
  | "wrong-vibe"
  | "not-on-service"
  | "already-seen"
  | "too-much-effort"
  | "not-for-me"
  | "quit-halfway"
  | "could-not-find";

export type FeedbackPhase = "pre-watch" | "post-watch";

export type RecommendationFeedback = {
  id: string;
  runId?: string;
  reason: FeedbackReason;
  phase?: FeedbackPhase;
  title: string;
  year: string;
  format: Recommendation["format"];
  confidence: number;
  parsedIntent?: Recommendation["parsedIntent"];
  request: RecommendRequest;
  whereToWatch: Recommendation["whereToWatch"];
  batchIndex: number;
  batchSize: number;
  createdAt: string;
};

export type RecommendationHistoryItem = {
  id: string;
  runId?: string;
  title: string;
  year: string;
  format: Recommendation["format"];
  confidence: number;
  parsedIntent?: Recommendation["parsedIntent"];
  oneLine: string;
  posterUrl?: string;
  request: RecommendRequest;
  whereToWatch: Recommendation["whereToWatch"];
  createdAt: string;
};

export function loadSeenTitles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(seenTitlesKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  } catch {
    return [];
  }
}

export function addSeenTitle(title: string): string[] {
  const seen = loadSeenTitles();
  if (!seen.includes(title)) seen.push(title);
  saveLocalValue(seenTitlesKey, JSON.stringify(seen));
  return seen;
}

export function loadRecentRecommendationTitles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(recentRecommendationTitlesKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  } catch {
    return [];
  }
}

export function rememberRecommendationTitles(titles: string[]): string[] {
  const cleanTitles = titles.map((title) => title.trim()).filter(Boolean);
  const existing = loadRecentRecommendationTitles();
  const next = [...cleanTitles, ...existing.filter((title) => !cleanTitles.includes(title))].slice(0, 24);
  saveLocalValue(recentRecommendationTitlesKey, JSON.stringify(next));
  return next;
}

export function loadRecommendationMemoryTitles(): string[] {
  const titles = [
    ...loadRecentRecommendationTitles(),
    ...loadRecommendationHistory().map((item) => item.title),
    ...loadRecommendationFeedback().map((item) => item.title),
  ].filter(Boolean);
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = recommendationKey(title, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

export function loadCompactRecommendationMemoryTitles(): string[] {
  return loadRecommendationMemoryTitles().slice(0, 8);
}

export function loadExactRecommendationExclusions(): string[] {
  const titles = [
    ...loadSeenTitles(),
    ...loadRecentRecommendationTitles(),
    ...loadRecommendationHistory().map((item) => item.title),
    ...loadRecommendationFeedback().map((item) => item.title),
  ].filter(Boolean);
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = recommendationKey(title, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
}

function recommendationKey(title: string, year: string) {
  return `${title.trim().toLowerCase()}::${year.trim()}`;
}

export function loadRecommendationHistory(): RecommendationHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(recommendationHistoryKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is RecommendationHistoryItem => Boolean(item && typeof item === "object" && typeof item.title === "string" && typeof item.year === "string" && item.request && item.whereToWatch)) : [];
  } catch {
    return [];
  }
}

export function rememberRecommendationHistory(recommendations: Recommendation[], request: RecommendRequest, runId?: string): RecommendationHistoryItem[] {
  const existing = loadRecommendationHistory();
  const nextItems = recommendations.map((recommendation) => ({
    id: `${recommendation.title}-${recommendation.year}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    runId,
    title: recommendation.title,
    year: recommendation.year,
    format: recommendation.format,
    confidence: recommendation.confidence,
    parsedIntent: recommendation.parsedIntent,
    oneLine: recommendation.oneLine,
    posterUrl: recommendation.omdbPosterUrl,
    request,
    whereToWatch: recommendation.whereToWatch,
    createdAt: new Date().toISOString(),
  }));
  const nextKeys = new Set(nextItems.map((item) => recommendationKey(item.title, item.year)));
  const next = [
    ...nextItems,
    ...existing.filter((item) => !nextKeys.has(recommendationKey(item.title, item.year))),
  ].slice(0, 80);
  saveLocalValue(recommendationHistoryKey, JSON.stringify(next));
  return next;
}

export function loadRecommendationFeedback(): RecommendationFeedback[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(feedbackStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is RecommendationFeedback => Boolean(item && typeof item === "object" && typeof item.title === "string" && typeof item.year === "string" && item.request && item.whereToWatch)) : [];
  } catch {
    return [];
  }
}

export function saveRecommendationFeedback(
  reason: FeedbackReason,
  session: RecommendationSession,
  phase: FeedbackPhase = "pre-watch",
): RecommendationFeedback[] {
  const existing = loadRecommendationFeedback();
  const recommendation = session.recommendation;
  const feedback: RecommendationFeedback = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: session.runId,
    reason,
    phase,
    title: recommendation.title,
    year: recommendation.year,
    format: recommendation.format,
    confidence: recommendation.confidence,
    parsedIntent: recommendation.parsedIntent,
    request: session.request,
    whereToWatch: recommendation.whereToWatch,
    batchIndex: session.batchIndex ?? 0,
    batchSize: session.batch?.length ?? 1,
    createdAt: new Date().toISOString(),
  };
  const next = [feedback, ...existing].slice(0, 200);
  saveLocalValue(feedbackStorageKey, JSON.stringify(next));
  return next;
}

export function hasPostWatchFeedback(title: string, year: string): boolean {
  return loadRecommendationFeedback().some((item) =>
    item.phase === "post-watch" &&
    recommendationKey(item.title, item.year) === recommendationKey(title, year),
  );
}

export function savePostWatchFeedback(
  reason: FeedbackReason,
  item: RecommendationHistoryItem,
): RecommendationFeedback[] {
  const existing = loadRecommendationFeedback();
  const key = recommendationKey(item.title, item.year);
  const withoutDuplicatePostWatch = existing.filter((feedback) =>
    !(feedback.phase === "post-watch" && recommendationKey(feedback.title, feedback.year) === key),
  );
  const feedback: RecommendationFeedback = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: item.runId,
    reason,
    phase: "post-watch",
    title: item.title,
    year: item.year,
    format: item.format,
    confidence: item.confidence,
    parsedIntent: item.parsedIntent,
    request: item.request,
    whereToWatch: item.whereToWatch,
    batchIndex: 0,
    batchSize: 1,
    createdAt: new Date().toISOString(),
  };
  const next = [feedback, ...withoutDuplicatePostWatch].slice(0, 200);
  saveLocalValue(feedbackStorageKey, JSON.stringify(next));
  return next;
}

function loadDismissedPostWatchPrompts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(dismissedPostWatchPromptKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  } catch {
    return [];
  }
}

export function hasDismissedPostWatchPrompt(title: string, year: string): boolean {
  const key = recommendationKey(title, year);
  return loadDismissedPostWatchPrompts().includes(key);
}

export function dismissPostWatchPrompt(title: string, year: string): string[] {
  const key = recommendationKey(title, year);
  const existing = loadDismissedPostWatchPrompts();
  const next = existing.includes(key) ? existing : [key, ...existing].slice(0, 80);
  saveLocalValue(dismissedPostWatchPromptKey, JSON.stringify(next));
  return next;
}

export function loadRecommendationFeedbackContext(): RecommendationFeedbackContext {
  const feedback = loadRecommendationFeedback().slice(0, 12);
  const titlesByReason = (reason: FeedbackReason) =>
    feedback
      .filter((item) => item.reason === reason)
      .map((item) => item.title)
      .filter(Boolean)
      .slice(0, 6);

  return {
    lastReason: feedback[0]?.reason,
    wrongVibeTitles: titlesByReason("wrong-vibe"),
    notOnServiceTitles: titlesByReason("not-on-service"),
    alreadySeenTitles: titlesByReason("already-seen"),
    perfectTitles: titlesByReason("perfect"),
    goodButNotPerfectTitles: titlesByReason("good-not-perfect"),
    notForMeTitles: titlesByReason("not-for-me"),
    quitHalfwayTitles: titlesByReason("quit-halfway"),
  };
}

export type RecommendationSession = {
  runId?: string;
  recommendation: Recommendation;
  request: RecommendRequest;
  generatedAt: string;
  batch?: Recommendation[];
  batchIndex?: number;
  displayState?: RecommendationDisplayState; // from _trust.displayState on the API response
  // Two-phase fetch: false means only pick 1 has been fetched so far and recommendation/page.tsx
  // should fire a background fill call for picks 2–3. Undefined/true means the batch is already
  // complete (today's default single-call behavior, or a fill that already finished).
  batchComplete?: boolean;
  // Phase 1's resolved intent contract, carried forward so the background fill call can reuse it
  // instead of paying for a second intent-classification LLM call.
  intentContract?: IntentContract;
};

export const defaultRecommendation: Recommendation = {
  title: "Afterglow",
  year: "2024",
  format: "Film",
  runtime: "1h 46m",
  vibe: "moody, intimate, elegant",
  confidence: 91,
  oneLine: "Two strangers. One night. Everything changes.",
  whyItFits: [
    "It has the emotional pull you asked for without turning heavy.",
    "It fits a short evening window and keeps the choice simple.",
    "It feels premium and specific instead of algorithmically generic.",
  ],
  whereToWatch: {
    status: "unverified",
    primary: "Streamo",
    note: "Included",
  },
  hiddenLayer: {
    headline: "What your current platforms are missing",
    insight: "We found great titles you do not have access to.",
    classyJab: "Your taste may be wider than your current subscriptions.",
  },
  alternatives: ["Below the Surface (2024)", "The Orbiter (2024)", "Velvet Hour (2024)"],
};

export function createRecommendationSession(
  recommendation: Recommendation,
  request: RecommendRequest,
  batch?: Recommendation[],
  displayState?: RecommendationDisplayState,
  runId?: string,
  batchComplete?: boolean,
  intentContract?: IntentContract,
): RecommendationSession {
  return {
    runId,
    recommendation,
    request,
    generatedAt: new Date().toISOString(),
    batch: batch ?? [recommendation],
    batchIndex: 0,
    displayState,
    batchComplete,
    intentContract,
  };
}

export function toTitleCase(value: string) {
  return value
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function providerMark(name: string) {
  if (name.startsWith("+")) return name;
  if (name.toLowerCase().startsWith("availability")) return "?";
  return name.charAt(0).toUpperCase();
}

export function providerTone(provider: WatchProvider): "blue" | "red" | "teal" | "plain" {
  if (provider.access === "rent") return "red";
  if (provider.access === "buy") return "teal";
  if (provider.access === "included" || provider.access === "subscription") return "blue";
  return "plain";
}

export function providerDetail(provider: WatchProvider) {
  if (provider.note) return provider.note;
  if (provider.price) return provider.price;
  if (provider.access === "included") return "Included";
  if (provider.access === "subscription") return "Subscription";
  if (provider.access === "rent") return "Rent";
  if (provider.access === "buy") return "Buy";
  return "Not verified yet";
}

export function watchProvidersFor(recommendation: Recommendation): WatchProvider[] {
  if (recommendation.whereToWatch.providers?.length) return recommendation.whereToWatch.providers;

  return [
    {
      name: recommendation.whereToWatch.status === "verified" ? recommendation.whereToWatch.primary : "Availability",
      access: "unknown",
      note: recommendation.whereToWatch.status === "verified" ? recommendation.whereToWatch.note : "Not verified yet",
    },
  ];
}
