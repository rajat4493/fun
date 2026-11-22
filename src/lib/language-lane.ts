import type { RecommendRequest, Recommendation } from "@/lib/types";
import { hasNegatedConcept } from "@/lib/recommendation-utils";

// Language name → TMDB original-language code + origin-country codes.
// Used to enforce the requested language/culture lane against TMDB metadata after enrichment.
// Scoped to the existing verified lanes plus English (offered by onboarding). Curated
// fallbacks improve coverage; if none satisfies a restriction the final gate returns no match.
// Do not substitute another language simply to avoid an empty result.
export const LANGUAGE_METADATA: Record<string, { code: string; countries: string[] }> = {
  english: { code: "en", countries: ["GB", "IE", "US", "AU", "CA", "NZ"] },
  hindi: { code: "hi", countries: ["IN"] },
  korean: { code: "ko", countries: ["KR"] },
  french: { code: "fr", countries: ["FR", "BE", "CA", "CH"] },
  german: { code: "de", countries: ["DE", "AT", "CH"] },
  spanish: { code: "es", countries: ["ES", "MX", "AR", "CO", "CL"] },
};

const LANGUAGE_ALIASES: Array<[RegExp, string]> = [
  [/\benglish\b/i, "english"],
  [/\bhindi\b/i, "hindi"],
  [/\bkorean\b/i, "korean"],
  [/\bfrench\b/i, "french"],
  [/\bgerman\b/i, "german"],
  [/\bspanish\b/i, "spanish"],
];

// Returns the requested language key (e.g. "french") from free text or language preferences,
// or null when the user did not pin a specific language ("Any language" is ignored).
export function detectRequestedLanguageKey(input: RecommendRequest): string | null {
  return detectRequestedLanguageKeys(input)[0] ?? null;
}

export function detectRequestedLanguageKeys(input: RecommendRequest): string[] {
  const prefs = (input.languagePreferences ?? []).filter((pref) => !/any language/i.test(pref));
  const explicit = [input.selfText, input.reference, ...(input.wants ?? [])].filter(Boolean).join(" ");
  const avoided = detectAvoidedLanguageKeys(input);
  const detect = (text: string) => LANGUAGE_ALIASES.filter(([pattern, key]) => pattern.test(text) && !avoided.includes(key)).map(([, key]) => key);
  const selected = detect(explicit);
  return selected.length ? selected : detect(prefs.join(" "));
}

export function wantsSpecificLanguage(input: RecommendRequest): boolean {
  return detectRequestedLanguageKey(input) !== null;
}

// Negated language requests ("like Money Heist but not in Spanish") were found to be unreliable
// via prompt guidance alone — the classifier keeps associating the reference's own language with
// the requested "language" field even when explicitly told not to (confirmed live: 3/3 reruns
// still returned Spanish-language titles after adding prompt guidance). Enforced here as a hard
// downstream reject instead, same as every other hard-constraint "trust contract" in this app.
export function detectAvoidedLanguageKey(input: RecommendRequest): string | null {
  return detectAvoidedLanguageKeys(input)[0] ?? null;
}

export function detectAvoidedLanguageKeys(input: RecommendRequest): string[] {
  const text = [input.selfText, input.reference, ...(input.wants ?? [])].filter(Boolean).join(" ");
  return LANGUAGE_ALIASES.filter(([pattern]) => hasNegatedConcept(text, pattern) ||
    (input.avoids ?? []).some(value => pattern.test(value))).map(([, key]) => key);
}

export function wantsToAvoidLanguage(input: RecommendRequest): boolean {
  return detectAvoidedLanguageKey(input) !== null;
}

// Mirrors matchesLanguageRequest's TMDB-based confirmation logic but inverted: hard-reject only on
// a CONFIRMED match to the avoided language, benefit of the doubt otherwise (no metadata, or a
// confirmed different language, both pass).
export function matchesAvoidedLanguageRequest(input: RecommendRequest, recommendation: Recommendation): boolean {
  return detectAvoidedLanguageKeys(input).every(key => matchesAvoidedLanguage(key, recommendation));
}

function matchesAvoidedLanguage(key: string, recommendation: Recommendation): boolean {
  const meta = LANGUAGE_METADATA[key];
  if (!meta) return true;

  const metadata = recommendation.contentMetadata;
  const lang = metadata?.originalLanguage;
  const countries = metadata?.originCountry ?? [];

  if (!lang && countries.length === 0) return true;
  if (lang === meta.code) return false;
  if (lang && lang !== meta.code) return true;
  if (!lang && countries.some((country) => meta.countries.includes(country))) return false;
  return true;
}

// Hard language-lane gate applied AFTER TMDB enrichment.
// - No requested language → always matches.
// - TMDB has no metadata → benefit of the doubt (matches).
// - TMDB confirms the requested original-language code → matches.
// - TMDB confirms a DIFFERENT original-language code → hard reject (even if country overlaps,
//   because one country code such as IN spans many languages).
// - No language code but origin country confirms the market → matches.
export function matchesLanguageRequest(input: RecommendRequest, recommendation: Recommendation): boolean {
  const keys = detectRequestedLanguageKeys(input);
  return !keys.length || keys.some(key => matchesRequestedLanguage(key, recommendation));
}

function matchesRequestedLanguage(key: string, recommendation: Recommendation): boolean {
  const meta = LANGUAGE_METADATA[key];
  if (!meta) return true; // language we can't verify against TMDB — don't filter

  const metadata = recommendation.contentMetadata;
  const lang = metadata?.originalLanguage;
  const countries = metadata?.originCountry ?? [];

  if (!lang && countries.length === 0) return true;
  if (lang === meta.code) return true;
  if (lang && lang !== meta.code) return false;
  if (!lang && countries.some((country) => meta.countries.includes(country))) return true;
  return false;
}
