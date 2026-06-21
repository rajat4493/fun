import { RecommendRequest, Recommendation, WatchProvider } from "@/lib/types";

export const recommendationStorageKey = "fun:last-recommendation";

export type RecommendationSession = {
  recommendation: Recommendation;
  request: RecommendRequest;
  generatedAt: string;
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
): RecommendationSession {
  return {
    recommendation,
    request,
    generatedAt: new Date().toISOString(),
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

export function artworkPositionFor(title: string, year?: string) {
  const seed = `${title}-${year || ""}`.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const slot = seed % 8;
  const col = slot % 4;
  const row = Math.floor(slot / 4);
  const x = col === 0 ? 0 : col === 3 ? 100 : col * 33.333;
  const y = row === 0 ? 0 : 100;

  return `${x}% ${y}%`;
}
