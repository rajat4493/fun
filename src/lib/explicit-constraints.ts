import type { RecommendRequest, Recommendation } from "@/lib/types";
import { extractIntent } from "@/lib/intent";
import { detectAvoidedLanguageKeys, detectRequestedLanguageKeys, LANGUAGE_METADATA } from "@/lib/language-lane";
import { hasNegatedConcept, intentRequestText, isOnUserPlatforms } from "@/lib/recommendation-utils";

export function wantsAnimation(input: RecommendRequest): boolean {
  const text = intentRequestText(input);
  const animation = /\b(animated|animation|cartoon)\b/i;
  return animation.test(text) && !hasNegatedConcept(text, animation);
}

// Last gate shared by hero picks and background batches. No fallback bypasses this.
export function explicitConstraintRejections(input: RecommendRequest, rec: Recommendation, checkSubscriptions = true): string[] {
  const reasons: string[] = [];
  const intent = extractIntent(input);
  const genres = rec.contentMetadata?.genreIds ?? [];
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if ([...(input.excludedTitles ?? []), ...(input.seenTitles ?? []), ...(input.recentTitles ?? [])]
    .some(title => normalize(title) === normalize(rec.title))) reasons.push("excluded title");
  if (intent.hardAvoids.includes("horror") && genres.includes(27)) reasons.push("horror excluded");
  const requested = detectRequestedLanguageKeys(input);
  const avoided = detectAvoidedLanguageKeys(input);
  const language = rec.contentMetadata?.originalLanguage;
  if ((requested.length || avoided.length) && !language) reasons.push("language not verified");
  if (requested.length && language && !requested.some(key => LANGUAGE_METADATA[key]?.code === language)) reasons.push("requested language mismatch");
  if (avoided.some(key => LANGUAGE_METADATA[key]?.code === language)) reasons.push("excluded language");
  if (wantsAnimation(input) && !genres.includes(16)) reasons.push("animation not verified");
  if (intent.familySafe && !rec.contentMetadata?.familyRatingVerified) reasons.push("family rating not verified");
  if (intent.requestedFormat === "film" && rec.format !== "Film" && rec.format !== "Documentary") reasons.push("film requested");
  if (intent.requestedFormat === "series" && rec.format !== "Series") reasons.push("series requested");
  if (checkSubscriptions && input.platformFilter === "mine" &&
    !isOnUserPlatforms(rec.whereToWatch.providers ?? [], input.platforms ?? [])) reasons.push("subscription match not verified");
  return reasons;
}
