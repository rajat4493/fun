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
  platformFilter?: "mine" | "any";
  discoveryMode?: "standard" | "indie";
  contextHint?: string; // time-of-day, day, season — influences pick tone
  craziness?: CrazinessLevel;
  feedbackContext?: RecommendationFeedbackContext;
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
  };
};

export type RecommendationBatch = {
  batch: Recommendation[]; // Array of 3 recommendations
  country?: string;
};
