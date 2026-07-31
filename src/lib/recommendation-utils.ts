import { RecommendRequest } from "@/lib/types";

export const countryCodeMap: Record<string, string> = {
  poland: "PL", pl: "PL",
  "united kingdom": "GB", gb: "GB", uk: "GB",
  germany: "DE", de: "DE",
  france: "FR", fr: "FR",
  spain: "ES", es: "ES",
  italy: "IT", it: "IT",
  netherlands: "NL", nl: "NL",
  "united states": "US", usa: "US", us: "US",
  india: "IN", in: "IN",
  portugal: "PT", pt: "PT",
  sweden: "SE", se: "SE",
  denmark: "DK", dk: "DK",
  belgium: "BE", be: "BE",
  austria: "AT", at: "AT",
  ireland: "IE", ie: "IE",
};

export function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function boundedStrings(value: unknown, maxItems: number, maxLength = 160): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim().slice(0, maxLength);
    const key = clean.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result.length > 0 ? result : undefined;
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : undefined;
}

// Normalize untrusted public API input once so every prompt, trust, fallback, and ranking path
// receives the same bounded data. This is defensive input handling, not recommendation logic.
export function normalizeRecommendRequest(input: RecommendRequest): RecommendRequest {
  const recommendationCount = Number.isFinite(input.recommendationCount)
    ? Math.min(3, Math.max(1, Math.trunc(input.recommendationCount!)))
    : undefined;
  const craziness = Number.isFinite(input.craziness)
    ? Math.min(3, Math.max(0, Math.trunc(input.craziness!))) as RecommendRequest["craziness"]
    : undefined;

  return {
    ...input,
    mode: input.mode === "self" ? "self" : "choose",
    mood: boundedStrings(input.mood, 12, 80),
    wants: boundedStrings(input.wants, 12, 80),
    avoids: boundedStrings(input.avoids, 12, 80),
    time: boundedText(input.time, 80),
    energy: boundedText(input.energy, 80),
    viewingContext: boundedText(input.viewingContext, 120),
    country: boundedText(input.country, 80),
    languagePreferences: boundedStrings(input.languagePreferences, 8, 80),
    platforms: boundedStrings(input.platforms, 20, 100),
    selfText: boundedText(input.selfText, 4000),
    reference: boundedText(input.reference, 500),
    seenTitles: boundedStrings(input.seenTitles, 40, 200),
    recentTitles: boundedStrings(input.recentTitles, 8, 200),
    excludedTitles: boundedStrings(input.excludedTitles, 200, 200),
    contextHint: boundedText(input.contextHint, 300),
    sessionId: boundedText(input.sessionId, 96),
    runId: boundedText(input.runId, 120),
    recommendationCount,
    craziness,
  };
}

// Takes a factory (not a Promise) so the AbortSignal can be threaded into the underlying fetch —
// Promise.race alone stops the CALLER from waiting, but never cancels the in-flight request, which
// leaks a connection-pool slot that later requests queue behind. That leak was the likely root
// cause of this app's recurring "provider hangs past its nominal timeout" pattern.
export async function withTimeout<T>(factory: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await factory(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }
  const match = trimmed.match(/[\[\{][\s\S]*[\]\}]/);
  if (!match) throw new Error("Model did not return JSON");
  return match[0];
}

export function requestText(input: RecommendRequest): string {
  return [
    input.selfText,
    input.reference,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.avoids?.join(" "),
    input.time,
    input.energy,
    input.contextHint,
  ].filter(Boolean).join(" ");
}

export function requestsSingleEpisode(text: string): boolean {
  return /\b(?:one|1|a single|an)\b(?:\s+\S+){0,6}\s+episode\b|\bepisode\s+only\b/i.test(text);
}

// Text used to infer positive intent. Structured avoid controls are deliberately
// excluded: "gore" in the avoids array must never become a request for gore.
export function intentRequestText(input: RecommendRequest): string {
  return [
    input.selfText,
    input.reference,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.time,
    input.energy,
    input.contextHint,
  ].filter(Boolean).join(" ");
}

function cloneGlobalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

export function hasNegatedConcept(text: string, pattern: RegExp): boolean {
  const clauses = text.split(/\b(?:but|however|though|although|except)\b/i);

  return clauses.some((clause) => {
    const negation = /\b(no|not|avoid|without|don't want|do not want|less|skip|hate|hates|hated|can't stand|cannot stand|cant stand|dislike|dislikes|despise|despises)\b/gi;
    const concept = cloneGlobalRegex(pattern);
    const negationMatches = [...clause.matchAll(negation)];
    if (negationMatches.length === 0) return false;

    const conceptMatches = [...clause.matchAll(concept)];
    return conceptMatches.some((conceptMatch) =>
      negationMatches.some((negationMatch) => {
        const negationIndex = negationMatch.index ?? 0;
        const conceptIndex = conceptMatch.index ?? 0;
        // Negation must precede the concept it modifies. An absolute-distance
        // check made "real horror, not sadness" incorrectly negate "horror".
        return conceptIndex >= negationIndex && conceptIndex - negationIndex <= 48;
      }),
    );
  });
}

export function parseAltTitle(alt: string): { title: string; year: string } {
  const match = alt.match(/^(.+?)\s*\((\d{4})\)$/);
  return match ? { title: match[1].trim(), year: match[2] } : { title: alt, year: "" };
}

export function isOnUserPlatforms(providers: Array<{ name: string; access: string }>, userPlatforms: string[]): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string[]> = {
    jiohotstar: ["jiohotstar", "hotstar", "disneyhotstar", "disneyplushotstar"],
    hotstar: ["jiohotstar", "hotstar", "disneyhotstar", "disneyplushotstar"],
    disney: ["disney", "disneyplus", "disneyplushotstar", "hotstar"],
    hbomax: ["hbomax", "max"],
    max: ["hbomax", "max"],
    canal: ["canal", "canalplus"],
    canalplus: ["canal", "canalplus"],
    zee5: ["zee5", "zee"],
    sonyliv: ["sonyliv", "sony"],
    tvpvod: ["tvpvod", "tvp"],
    polsatboxgo: ["polsatboxgo", "polsat"],
    primevideo: ["primevideo", "amazonprimevideo", "amazonprime"],
    amazonprimevideo: ["primevideo", "amazonprimevideo", "amazonprime"],
    youtube: ["youtube", "youtubemovies"],
  };
  const expand = (value: string) => {
    const key = normalize(value);
    return aliases[key] ?? [key];
  };
  const userNorm = userPlatforms.flatMap(expand);
  return providers
    .filter((provider) => provider.access === "subscription")
    .some((provider) => {
      const providerNorm = normalize(provider.name);
      const providerAliases = aliases[providerNorm] ?? [providerNorm];
      return userNorm.some((user) =>
        providerAliases.some((providerAlias) => providerAlias.includes(user) || user.includes(providerAlias)),
      );
    });
}
