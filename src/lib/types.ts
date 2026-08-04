export type CrazinessLevel = 0 | 1 | 2 | 3; // 0=Safe, 1=Curious, 2=Bold, 3=Unhinged
export type FeedbackSignal =
  | "perfect"
  | "good-not-perfect"
  | "wrong-vibe"
  | "not-on-service"
  | "already-seen"
  | "too-much-effort"
  | "not-for-me"
  | "quit-halfway"
  | "could-not-find";

export type RecommendationDisplayState =
  | "verified"
  | "unverified"
  | "avoidance-fallback"
  | "no-subscription-match";

export type ParsedRecommendationIntent = {
  primary?: string;
  secondary?: string[];
  hardAvoids?: string[];
  softAvoids?: string[];
  format?: "film" | "series" | "episode" | "any";
  language?: string;
  situation?: string[];
  intensity?: "safe" | "curious" | "bold" | "unhinged";
  ambiguity?: string;
};

export type IntentContract = {
  primary: string;
  secondary: string[];
  hardAvoids: string[];
  softAvoids: string[];
  format: "film" | "series" | "episode" | "any";
  language: string;
  situation: string[];
  intensity: "safe" | "curious" | "bold" | "unhinged";
  emotionalGoal: string;
  confidence: number;
  ambiguity: string;
  // Titles the viewer explicitly used as negative examples ("not X", "anything except Y").
  // These become mechanical backend exclusions; they are not merely prompt guidance.
  negativeReferences: string[];
  discoveryPreference: "standard" | "non-mainstream";
  source: "llm" | "local";
};

export type RecommendationFeedbackContext = {
  lastReason?: FeedbackSignal;
  wrongVibeTitles?: string[];
  notOnServiceTitles?: string[];
  alreadySeenTitles?: string[];
  perfectTitles?: string[];
  goodButNotPerfectTitles?: string[];
  notForMeTitles?: string[];
  quitHalfwayTitles?: string[];
};

export type RecommendRequest = {
  mode: "choose" | "self";
  mood?: string[];
  wants?: string[];
  avoids?: string[];
  time?: string;
  energy?: string;
  viewingContext?: string;
  country?: string;
  languagePreferences?: string[];
  platforms?: string[];
  selfText?: string;
  reference?: string;
  seenTitles?: string[];
  recentTitles?: string[];
  // Full device-local exclusion set. This is enforced mechanically by the backend and is never
  // copied into the LLM prompt; recentTitles remains the small context window shown to the model.
  excludedTitles?: string[];
  // Anonymous, device-scoped profile identifier. Used only for product memory and diagnostics.
  sessionId?: string;
  platformFilter?: "mine" | "any";
  discoveryMode?: "standard" | "indie";
  contextHint?: string; // time-of-day, day, season — influences pick tone
  craziness?: CrazinessLevel;
  feedbackContext?: RecommendationFeedbackContext;
  // Two-phase fetch: omit for the default 3-at-once batch. Client sets this to 1 for the fast
  // initial pick, then 2 for the background fill call (see recommendation/page.tsx).
  recommendationCount?: number;
  // Live UI requests use the compact shape because related discoveries are optional and should
  // not delay the primary pick. Omitted keeps the full response for QA/backward compatibility.
  responseDetail?: "core" | "full";
  // Lets the background fill call reuse phase 1's already-resolved intent contract instead of
  // paying for a second intent-classification LLM call.
  precomputedIntentContract?: IntentContract;
  // Client-generated correlation ID (see createRecommendationRunId) sent up front so the server
  // log line for this call and the client's later /api/recommendation-runs report share one ID —
  // otherwise there is no way to join "what the model returned" to "what got displayed".
  runId?: string;
  // Opt-in NDJSON staged-progress response (see route.ts's buildResult/emitStage). Omitted or false
  // keeps today's exact single-JSON-blob response — only the real UI sets this to true.
  stream?: boolean;
};

export type WatchProvider = {
  name: string;
  access: "included" | "rent" | "buy" | "subscription" | "unknown";
  price?: string;
  note?: string;
  logoUrl?: string;
  url?: string;
  urlKind?: "title" | "search";
};

export type HiddenLayerTitle = {
  title: string;
  year: string;
  posterUrl?: string;
  platform?: string;
};

export type RawRecommendation = Recommendation & {
  hiddenTitles?: Array<{ title: string; year: string }>;
};

export type Recommendation = {
  title: string;
  year: string;
  format: "Film" | "Series" | "Episode" | "Documentary" | "Unknown";
  runtime: string;
  vibe: string;
  confidence: number;
  oneLine: string;
  whyItFits: string[];
  whereToWatch: {
    status: "unverified" | "verified";
    primary: string;
    note: string;
    providers?: WatchProvider[];
    country?: string;
    verifiedAt?: string;
    notOnUserPlatforms?: boolean;
  };
  hiddenLayer: {
    headline: string;
    insight: string;
    classyJab: string;
    titles?: HiddenLayerTitle[];
  };
  alternatives: string[];
  omdbPosterUrl?: string; // OMDB/IMDB poster image URL
  alternativePosterUrls?: string[];
  omdbAttribution?: string;
  contentMetadata?: {
    originalLanguage?: string;
    originCountry?: string[];
    genreIds?: number[];
    catalogConfirmed?: boolean;
  };
  parsedIntent?: ParsedRecommendationIntent;
  contentCategory?: string[];
  emotionalEffect?: string[];
};

export type RecommendationBatch = {
  batch: Recommendation[]; // Array of 3 recommendations
  country?: string;
};
