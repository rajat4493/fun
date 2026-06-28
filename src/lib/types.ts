export type RecommendRequest = {
  mode: "choose" | "self";
  mood?: string[];
  wants?: string[];
  avoids?: string[];
  time?: string;
  country?: string;
  platforms?: string[];
  selfText?: string;
  reference?: string;
  seenTitles?: string[];
  platformFilter?: "mine" | "any";
  contextHint?: string; // time-of-day, day, season — influences pick tone
};

export type WatchProvider = {
  name: string;
  access: "included" | "rent" | "buy" | "subscription" | "unknown";
  price?: string;
  note?: string;
  logoUrl?: string;
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
};

export type RecommendationBatch = {
  batch: Recommendation[]; // Array of 3 recommendations
  country?: string;
};
