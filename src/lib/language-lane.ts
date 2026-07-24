import type { RecommendRequest, Recommendation } from "@/lib/types";

// Language name → TMDB original-language code + origin-country codes.
// Used to enforce the requested language/culture lane against TMDB metadata after enrichment.
// Scoped deliberately to languages we have proven end-to-end: a passing regression case AND
// (for the hard-reject path to be safe) a curated local fallback so a wrong-language reject
// never dead-ends the user in an English pick. Do not add a language here without both.
export const LANGUAGE_METADATA: Record<string, { code: string; countries: string[] }> = {
  hindi: { code: "hi", countries: ["IN"] },
  korean: { code: "ko", countries: ["KR"] },
  french: { code: "fr", countries: ["FR", "BE", "CA", "CH"] },
  german: { code: "de", countries: ["DE", "AT", "CH"] },
};

const LANGUAGE_ALIASES: Array<[RegExp, string]> = [
  [/\bhindi\b/i, "hindi"],
  [/\bkorean\b/i, "korean"],
  [/\bfrench\b/i, "french"],
  [/\bgerman\b/i, "german"],
];

// Returns the requested language key (e.g. "french") from free text or language preferences,
// or null when the user did not pin a specific language ("Any language" is ignored).
export function detectRequestedLanguageKey(input: RecommendRequest): string | null {
  const prefs = (input.languagePreferences ?? []).filter((pref) => !/any language/i.test(pref));
  const text = [input.selfText, input.reference, ...prefs].filter(Boolean).join(" ");
  for (const [pattern, key] of LANGUAGE_ALIASES) {
    if (pattern.test(text)) return key;
  }
  return null;
}

export function wantsSpecificLanguage(input: RecommendRequest): boolean {
  return detectRequestedLanguageKey(input) !== null;
}

// Hard language-lane gate applied AFTER TMDB enrichment.
// - No requested language → always matches.
// - TMDB has no metadata → benefit of the doubt (matches).
// - TMDB confirms the requested original-language code → matches.
// - TMDB confirms a DIFFERENT original-language code → hard reject (even if country overlaps,
//   because one country code such as IN spans many languages).
// - No language code but origin country confirms the market → matches.
export function matchesLanguageRequest(input: RecommendRequest, recommendation: Recommendation): boolean {
  const key = detectRequestedLanguageKey(input);
  if (!key) return true;
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
