import { RecommendRequest, Recommendation, RecommendationFeedbackContext, WatchProvider } from "@/lib/types";

export const recommendationStorageKey = "fun:last-recommendation";
export const seenTitlesKey = "fun:seen-titles";
export const feedbackStorageKey = "fun:recommendation-feedback";
export const recentRecommendationTitlesKey = "fun:recent-recommendation-titles";
const sessionIdKey = "fun:session-id";

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = localStorage.getItem(sessionIdKey);
    if (existing) return existing;
    const id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(sessionIdKey, id);
    return id;
  } catch {
    return "unknown";
  }
}

export type FeedbackReason = "perfect" | "wrong-vibe" | "not-on-service" | "already-seen";

export type RecommendationFeedback = {
  id: string;
  reason: FeedbackReason;
  title: string;
  year: string;
  format: Recommendation["format"];
  confidence: number;
  request: RecommendRequest;
  whereToWatch: Recommendation["whereToWatch"];
  batchIndex: number;
  batchSize: number;
  createdAt: string;
};

export function loadSeenTitles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(seenTitlesKey);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addSeenTitle(title: string): string[] {
  const seen = loadSeenTitles();
  if (!seen.includes(title)) seen.push(title);
  localStorage.setItem(seenTitlesKey, JSON.stringify(seen));
  return seen;
}

export function loadRecentRecommendationTitles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(recentRecommendationTitlesKey);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberRecommendationTitles(titles: string[]): string[] {
  const cleanTitles = titles.map((title) => title.trim()).filter(Boolean);
  const existing = loadRecentRecommendationTitles();
  const next = [...cleanTitles, ...existing.filter((title) => !cleanTitles.includes(title))].slice(0, 24);
  localStorage.setItem(recentRecommendationTitlesKey, JSON.stringify(next));
  return next;
}

export function loadRecommendationFeedback(): RecommendationFeedback[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(feedbackStorageKey);
    return raw ? (JSON.parse(raw) as RecommendationFeedback[]) : [];
  } catch {
    return [];
  }
}

export function saveRecommendationFeedback(
  reason: FeedbackReason,
  session: RecommendationSession,
): RecommendationFeedback[] {
  const existing = loadRecommendationFeedback();
  const recommendation = session.recommendation;
  const feedback: RecommendationFeedback = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reason,
    title: recommendation.title,
    year: recommendation.year,
    format: recommendation.format,
    confidence: recommendation.confidence,
    request: session.request,
    whereToWatch: recommendation.whereToWatch,
    batchIndex: session.batchIndex ?? 0,
    batchSize: session.batch?.length ?? 1,
    createdAt: new Date().toISOString(),
  };
  const next = [feedback, ...existing].slice(0, 200);
  localStorage.setItem(feedbackStorageKey, JSON.stringify(next));
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
  };
}

export type RecommendationSession = {
  recommendation: Recommendation;
  request: RecommendRequest;
  generatedAt: string;
  batch?: Recommendation[]; // Full batch of 3 recommendations
  batchIndex?: number; // Current index in batch (0-2)
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
): RecommendationSession {
  return {
    recommendation,
    request,
    generatedAt: new Date().toISOString(),
    batch: batch ?? [recommendation],
    batchIndex: 0,
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
