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

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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
    input.viewingContext,
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
    const negation = /\b(no|not|avoid|without|don't want|do not want|less|skip|hate)\b/gi;
    const concept = cloneGlobalRegex(pattern);
    const negationMatches = [...clause.matchAll(negation)];
    if (negationMatches.length === 0) return false;

    const conceptMatches = [...clause.matchAll(concept)];
    return conceptMatches.some((conceptMatch) =>
      negationMatches.some((negationMatch) => {
        const negationIndex = negationMatch.index ?? 0;
        const conceptIndex = conceptMatch.index ?? 0;
        return Math.abs(conceptIndex - negationIndex) <= 48;
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
