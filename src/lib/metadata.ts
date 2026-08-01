import { checkAvailability } from "@/lib/availability";
import { countryCodeMap, isOnUserPlatforms, parseAltTitle } from "@/lib/recommendation-utils";
import { HiddenLayerTitle, RawRecommendation, Recommendation } from "@/lib/types";

const TMDB_TIMEOUT_MS = 3500;
const OMDB_TIMEOUT_MS = 2500;

type OmdbResponse = {
  Response: "True" | "False";
  Title?: string;
  Year?: string;
  Poster?: string;
};

type TmdbMovie = {
  id: number;
  matchedTitle?: string;
  poster_path: string | null;
  media_type: "movie" | "tv";
  original_language?: string;
  origin_country?: string[];
  genre_ids?: number[];
};

type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

type TmdbProviderSet = {
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
};

function toCountryCode(country: string): string {
  return countryCodeMap[country.trim().toLowerCase()] ?? country.trim().toUpperCase();
}

async function omdbFetch(title: string, year: string): Promise<OmdbResponse | null> {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return null;
  try {
    const q = encodeURIComponent(title.trim());
    const yearParam = year ? `&y=${year}` : "";
    const res = await fetch(`https://www.omdbapi.com/?t=${q}${yearParam}&apikey=${apiKey}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(OMDB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json() as Promise<OmdbResponse>;
  } catch {
    return null;
  }
}

async function tmdbFetch<T>(path: string): Promise<T | null> {
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!token && !apiKey) return null;
  try {
    const url = token
      ? `https://api.themoviedb.org/3${path}`
      : `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      headers,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path: string | null;
  original_language?: string;
  origin_country?: string[];
  genre_ids?: number[];
  release_date?: string;
  first_air_date?: string;
};

function titleCandidates(result: TmdbSearchResult): string[] {
  return [result.title, result.name, result.original_title, result.original_name].filter((value): value is string => Boolean(value));
}

function withMediaType(result: TmdbSearchResult, mediaType: "movie" | "tv"): TmdbMovie {
  return {
    ...result,
    matchedTitle: titleCandidates(result)[0],
    media_type: mediaType,
  };
}

function titleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !["a", "an", "the"].includes(token));
}

function titleSimilarity(a: string, b: string): number {
  const aTokens = titleTokens(a);
  const bTokens = titleTokens(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  const overlap = aTokens.filter((token) => bSet.has(token)).length;
  return overlap / Math.max(aTokens.length, bTokens.length);
}

function posterTitleMatches(requestedTitle: string, matchedTitle?: string): boolean {
  if (!matchedTitle) return false;
  const requested = titleTokens(requestedTitle).join(" ");
  const matched = titleTokens(matchedTitle).join(" ");
  if (!requested || !matched) return false;
  if (requested === matched) return true;
  if (requested.length >= 8 && matched.length >= 8 && (requested.includes(matched) || matched.includes(requested))) return true;
  return titleSimilarity(requestedTitle, matchedTitle) >= 0.7;
}

function relatedKey(value: string): string {
  return titleTokens(value).join("");
}

function isUsableRelatedTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return Boolean(normalized) &&
    normalized !== "title" &&
    normalized !== "untitled" &&
    !/^title\s*\d*$/i.test(normalized) &&
    !/^placeholder/i.test(normalized);
}

function cleanHiddenTitles(raw: Array<{ title: string; year: string }>, mainTitle: string): Array<{ title: string; year: string }> {
  const seen = new Set([relatedKey(mainTitle)]);
  const out: Array<{ title: string; year: string }> = [];

  for (const item of raw) {
    const title = item.title?.trim();
    if (!isUsableRelatedTitle(title)) continue;
    const key = relatedKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, year: item.year?.trim() ?? "" });
  }

  return out;
}

function cleanAlternativeTitles(raw: string[], mainTitle: string, hiddenTitles: Array<{ title: string }>): Array<{ title: string; year: string }> {
  const seen = new Set([relatedKey(mainTitle), ...hiddenTitles.map((item) => relatedKey(item.title))]);
  const out: Array<{ title: string; year: string }> = [];

  for (const item of raw) {
    const alt = parseAltTitle(item);
    if (!isUsableRelatedTitle(alt.title)) continue;
    const key = relatedKey(alt.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alt);
  }

  return out;
}

function yearMatchesResult(result: TmdbSearchResult, dateField: "release_date" | "first_air_date", expectedYear: string): boolean {
  const resultYear = parseInt((result[dateField] ?? "").slice(0, 4));
  return !isNaN(resultYear) && Math.abs(resultYear - parseInt(expectedYear)) <= 1;
}

function pickResult(results: TmdbSearchResult[], year: string, dateField: "release_date" | "first_air_date"): TmdbSearchResult | null {
  if (!results.length) return null;
  if (!year) return results[0];
  return results.find((r) => yearMatchesResult(r, dateField, year)) ?? null;
}

function tmdbSearchPath(mediaType: "movie" | "tv", query: string, year: string, withYear: boolean): string {
  const yearParam = mediaType === "movie" ? "primary_release_year" : "first_air_date_year";
  const yearFilter = withYear && year ? `&${yearParam}=${year}` : "";
  return `/search/${mediaType}?query=${query}${yearFilter}&language=en-US&page=1`;
}

function dateFieldFor(mediaType: "movie" | "tv"): "release_date" | "first_air_date" {
  return mediaType === "movie" ? "release_date" : "first_air_date";
}

// Staged lookup: tier 1 is a single call for the format we actually expect (from the pick's
// declared format), year-filtered — covers the common case (well-known title, correct year) with
// one TMDB round trip. Only on a tier-1 miss does tier 2 fan out concurrently across the remaining
// movie/TV, year-filtered/unfiltered combinations, in the same priority order the old fully
// sequential version checked one at a time. Confirming a title should not cost 4 network calls
// when 1 will do, and should not fan out at all for backup/related titles the user may never see
// (those are enriched separately via enrichRelatedPosters, not through this blocking path).
async function tmdbSearch(title: string, year: string, expectedFormat?: string): Promise<TmdbMovie | null> {
  const q = encodeURIComponent(title.trim());
  const tvFirst = expectedFormat === "Series" || expectedFormat === "Episode";
  const primaryType: "movie" | "tv" = tvFirst ? "tv" : "movie";
  const secondaryType: "movie" | "tv" = tvFirst ? "movie" : "tv";

  if (year) {
    const primaryYearData = await tmdbFetch<{ results: TmdbSearchResult[] }>(tmdbSearchPath(primaryType, q, year, true));
    if (primaryYearData?.results?.[0]) return withMediaType(primaryYearData.results[0], primaryType);
  }

  const [primaryFallback, secondaryYearData, secondaryFallback] = await Promise.all([
    tmdbFetch<{ results: TmdbSearchResult[] }>(tmdbSearchPath(primaryType, q, year, false)),
    year ? tmdbFetch<{ results: TmdbSearchResult[] }>(tmdbSearchPath(secondaryType, q, year, true)) : Promise.resolve(null),
    tmdbFetch<{ results: TmdbSearchResult[] }>(tmdbSearchPath(secondaryType, q, year, false)),
  ]);

  // Only accept an unfiltered fallback if the result's year roughly matches.
  // Returning null here means the pick is treated as "unknown" rather than trusted with wrong genre data.
  const primaryMatch = pickResult(primaryFallback?.results ?? [], year, dateFieldFor(primaryType));
  if (primaryMatch) return withMediaType(primaryMatch, primaryType);

  if (secondaryYearData?.results?.[0]) return withMediaType(secondaryYearData.results[0], secondaryType);

  const secondaryMatch = pickResult(secondaryFallback?.results ?? [], year, dateFieldFor(secondaryType));
  if (secondaryMatch) return withMediaType(secondaryMatch, secondaryType);

  return null;
}

async function tmdbProviders(tmdbId: number, mediaType: "movie" | "tv", countryCode: string): Promise<TmdbProviderSet | null> {
  const path = mediaType === "tv" ? `/tv/${tmdbId}/watch/providers` : `/movie/${tmdbId}/watch/providers`;
  const data = await tmdbFetch<{ results: Record<string, TmdbProviderSet> }>(path);
  return data?.results?.[countryCode] ?? null;
}

function mapProviders(set: TmdbProviderSet): Recommendation["whereToWatch"]["providers"] {
  const out: NonNullable<Recommendation["whereToWatch"]["providers"]> = [];
  const seen = new Set<string>();
  const push = (list: TmdbProvider[] | undefined, access: NonNullable<Recommendation["whereToWatch"]["providers"]>[number]["access"], note?: string) => {
    for (const provider of list ?? []) {
      const key = `${provider.provider_id}-${access}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: provider.provider_name,
        access,
        note,
        logoUrl: provider.logo_path ? `https://image.tmdb.org/t/p/original${provider.logo_path}` : undefined,
      });
    }
  };

  push(set.flatrate, "subscription", "Subscription");
  push(set.free, "subscription", "Free");
  push(set.ads, "subscription", "With ads");
  push(set.rent, "rent", "Rent");
  push(set.buy, "buy", "Buy");
  return out;
}

// Poster lookups for hidden/similar titles used to run inline here on every request — up to 7
// extra concurrent tmdbSearch calls (each itself up to 4 TMDB round trips) regardless of whether
// the user ever expands that section. That's real, unnecessary latency and traffic on the
// blocking path for content that's collapsed behind "show more" in the UI. Only the main title
// is searched here now; related-title posters are fetched lazily via enrichRelatedPosters,
// called by the client only when that section is actually opened.
export async function enrichRecommendation(
  raw: RawRecommendation,
  country: string,
  platforms: string[],
): Promise<Recommendation> {
  const localAvailability = checkAvailability(raw.title, raw.year, country);
  const hiddenRaw = cleanHiddenTitles(raw.hiddenTitles ?? [], raw.title);
  const altTitles = cleanAlternativeTitles(raw.alternatives ?? [], raw.title, hiddenRaw);
  const countryCode = toCountryCode(country);

  const mainMovie = await tmdbSearch(raw.title, raw.year, raw.format);

  // CHANGED: Previously fetched providers for every hidden title too (~36 TMDB calls total per request).
  // Now only the main pick gets provider lookup — hidden titles get posters only, no provider calls.
  // Cuts enrichment from ~36 API calls to ~6 per request, saving 3-5s per recommendation.
  const [providerSet, omdbMain] = await Promise.all([
    mainMovie ? tmdbProviders(mainMovie.id, mainMovie.media_type, countryCode) : Promise.resolve(null),
    !mainMovie?.poster_path ? omdbFetch(raw.title, raw.year) : Promise.resolve(null),
  ]);

  const providers: NonNullable<Recommendation["whereToWatch"]["providers"]> = providerSet ? (mapProviders(providerSet) ?? []) : [];
  const verifiedProviders = localAvailability.status === "verified" ? localAvailability.providers : providers;
  const notOnUserPlatforms = verifiedProviders.length > 0 && platforms.length > 0 && !isOnUserPlatforms(verifiedProviders, platforms);

  const whereToWatch: Recommendation["whereToWatch"] = localAvailability.status === "verified"
    ? {
        status: "verified",
        primary: localAvailability.primary,
        note: localAvailability.note,
        providers: localAvailability.providers,
        country,
        verifiedAt: localAvailability.verifiedAt,
        notOnUserPlatforms,
      }
    : providers.length > 0
    ? {
        status: "verified",
        primary: providers.filter((p) => p.access === "subscription")[0]?.name ?? providers[0]?.name ?? "Available",
        note: providers.some((p) => p.access === "subscription")
          ? `Available on ${providers.filter((p) => p.access === "subscription").slice(0, 2).map((p) => p.name).join(" · ")}`
          : "Available to rent or buy",
        providers,
        country,
        verifiedAt: new Date().toISOString(),
        notOnUserPlatforms,
      }
    : {
        status: "unverified",
        primary: "Availability not verified yet",
        note: "Check your apps — not yet verified for your region.",
        providers: [],
        country,
        notOnUserPlatforms: false,
      };

  const tmdbPoster = mainMovie?.poster_path && posterTitleMatches(raw.title, mainMovie.matchedTitle)
    ? `https://image.tmdb.org/t/p/w500${mainMovie.poster_path}`
    : undefined;
  const tmdbTitleConfirmed = Boolean(mainMovie?.matchedTitle && posterTitleMatches(raw.title, mainMovie.matchedTitle));
  const omdbTitleConfirmed = Boolean(
    omdbMain?.Response === "True" &&
    omdbMain.Title &&
    posterTitleMatches(raw.title, omdbMain.Title)
  );
  const omdbPoster = omdbMain?.Response === "True" &&
    omdbMain.Poster &&
    omdbMain.Poster !== "N/A" &&
    posterTitleMatches(raw.title, omdbMain.Title)
    ? omdbMain.Poster
    : undefined;

  // Posters for these are not fetched here — see enrichRelatedPosters. Title/year still render
  // immediately (the text content already came back from the LLM call); only the poster image
  // is deferred until the section is opened.
  const alternativePosterUrls = altTitles.map(() => "");
  const hiddenLayerTitles: HiddenLayerTitle[] = hiddenRaw.map((hidden) => ({
    title: hidden.title,
    year: hidden.year,
    posterUrl: undefined,
  }));

  const { hiddenTitles: _dropped, ...rest } = raw;
  void _dropped;

  return {
    ...rest,
    alternatives: altTitles.map((alt) => alt.year ? `${alt.title} (${alt.year})` : alt.title),
    omdbPosterUrl: tmdbPoster ?? omdbPoster,
    whereToWatch,
    alternativePosterUrls,
    contentMetadata: {
      originalLanguage: mainMovie?.original_language,
      originCountry: mainMovie?.origin_country,
      genreIds: mainMovie?.genre_ids,
      catalogConfirmed: localAvailability.status === "verified" || tmdbTitleConfirmed || omdbTitleConfirmed,
    },
    hiddenLayer: {
      ...raw.hiddenLayer,
      titles: hiddenLayerTitles.length > 0 ? hiddenLayerTitles : undefined,
    },
  };
}

// Lazy poster lookup for hidden/similar titles, called only when the client actually opens that
// section (see recommendation/page.tsx). Same tmdbSearch used for the main pick, capped to the
// small number of cards the UI ever renders.
export async function enrichRelatedPosters(
  titles: Array<{ title: string; year: string }>,
): Promise<Array<{ title: string; year: string; posterUrl?: string }>> {
  const capped = titles.slice(0, 8);
  const matches = await Promise.all(capped.map((item) => tmdbSearch(item.title, item.year)));
  return capped.map((item, i) => {
    const match = matches[i];
    return {
      title: item.title,
      year: item.year,
      posterUrl: match?.poster_path && posterTitleMatches(item.title, match.matchedTitle)
        ? `https://image.tmdb.org/t/p/w342${match.poster_path}`
        : undefined,
    };
  });
}
