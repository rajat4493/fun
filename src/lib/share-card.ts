import type { IntentContract, RecommendRequest, Recommendation } from "@/lib/types";

export type ShareCardStyle = "cinematic" | "playful" | "intense";
export type ShareCardFormat = "story" | "feed";

const publicMoodLines: Array<{ terms: RegExp; line: string }> = [
  { terms: /\b(grief|grieving|gentle|relief|held|comfort)\b/i, line: "Kindness without emotional homework." },
  { terms: /\b(breakup|reset|recover)\b/i, line: "A reset without reopening the wound." },
  { terms: /\b(cry|catharsis|devastating)\b/i, line: "A beautiful reason to feel everything." },
  { terms: /\b(scare|scary|terrified|horror|fear)\b/i, line: "A reason to leave the lights on." },
  { terms: /\b(thriller|tension|tense|suspense)\b/i, line: "Tension worth committing to." },
  { terms: /\b(weird|strange|offbeat|surreal)\b/i, line: "Something strange enough to feel new." },
  { terms: /\b(comedy|funny|laugh|playful)\b/i, line: "Something funny enough to reset the night." },
  { terms: /\b(romance|romantic|chemistry|date)\b/i, line: "Chemistry without the endless search." },
  { terms: /\b(inspiring|uplifting|hope)\b/i, line: "A little momentum in the right direction." },
];

function intentText(request: RecommendRequest, recommendation: Recommendation, contract?: IntentContract) {
  return [
    contract?.primary,
    ...(contract?.secondary ?? []),
    recommendation.parsedIntent?.primary,
    ...(recommendation.parsedIntent?.secondary ?? []),
    recommendation.vibe,
    ...(request.mood ?? []),
    ...(request.wants ?? []),
  ].filter(Boolean).join(" ");
}

export function defaultPublicMoodLine(
  request: RecommendRequest,
  recommendation: Recommendation,
  contract?: IntentContract,
) {
  const text = intentText(request, recommendation, contract);
  return publicMoodLines.find((entry) => entry.terms.test(text))?.line
    ?? "One film that fits tonight better than another scroll.";
}

function cleanTag(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function shareCardTags(
  request: RecommendRequest,
  recommendation: Recommendation,
  contract?: IntentContract,
) {
  const values = [
    ...recommendation.vibe.split(/[,/]/),
    contract?.primary,
    ...(contract?.secondary ?? []),
    recommendation.parsedIntent?.primary,
    ...(request.wants ?? []),
    ...(request.mood ?? []),
  ];
  const seen = new Set<string>();
  return values
    .map((value) => cleanTag(value ?? ""))
    .filter((value) => {
      if (!value || value === "unknown" || value === "any" || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 3);
}

export function suggestedShareCardStyle(
  request: RecommendRequest,
  recommendation: Recommendation,
  contract?: IntentContract,
): ShareCardStyle {
  const text = intentText(request, recommendation, contract);
  if (/\b(scare|scary|terrified|horror|fear|thriller|tense|gore|intense)\b/i.test(text)) return "intense";
  if (/\b(weird|strange|offbeat|surreal|comedy|funny|playful)\b/i.test(text)) return "playful";
  return "cinematic";
}

export function shareCardFilename(title: string, format: ShareCardFormat) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "tonights-pick";
  return `${slug}-${format}.png`;
}
