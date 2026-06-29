import { checkAvailability } from "@/lib/availability";
import { countryCodeMap, isOnUserPlatforms, parseAltTitle } from "@/lib/recommendation-utils";
import { HiddenLayerTitle, RawRecommendation, Recommendation } from "@/lib/types";

const TMDB_TIMEOUT_MS = 3500;
const OMDB_TIMEOUT_MS = 2500;

type OmdbResponse = {
  Response: "True" | "False";
  Poster?: string;
};

type TmdbMovie = {
  id: number;
  poster_path: string | null;
  media_type: "movie" | "tv";
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

async function tmdbSearch(title: string, year: string): Promise<TmdbMovie | null> {
  const q = encodeURIComponent(title.trim());
  const moviePaths = year
    ? [`/search/movie?query=${q}&primary_release_year=${year}&language=en-US&page=1`, `/search/movie?query=${q}&language=en-US&page=1`]
    : [`/search/movie?query=${q}&language=en-US&page=1`];
  for (const path of moviePaths) {
    const movieData = await tmdbFetch<{ results: Array<{ id: number; poster_path: string | null }> }>(path);
    if (movieData?.results?.[0]) return { ...movieData.results[0], media_type: "movie" };
  }

  const tvPaths = year
    ? [`/search/tv?query=${q}&first_air_date_year=${year}&language=en-US&page=1`, `/search/tv?query=${q}&language=en-US&page=1`]
    : [`/search/tv?query=${q}&language=en-US&page=1`];
  for (const path of tvPaths) {
    const tvData = await tmdbFetch<{ results: Array<{ id: number; poster_path: string | null }> }>(path);
    if (tvData?.results?.[0]) return { ...tvData.results[0], media_type: "tv" };
  }
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

export async function enrichRecommendation(
  raw: RawRecommendation,
  country: string,
  platforms: string[],
): Promise<Recommendation> {
  const localAvailability = checkAvailability(raw.title, raw.year, country);
  const altTitles = raw.alternatives.map(parseAltTitle);
  const hiddenRaw = raw.hiddenTitles ?? [];
  const countryCode = toCountryCode(country);

  // Wave 1 — all TMDB title searches in parallel
  const [mainMovie, ...restMovies] = await Promise.all([
    tmdbSearch(raw.title, raw.year),
    ...altTitles.map((alt) => tmdbSearch(alt.title, alt.year)),
    ...hiddenRaw.map((hidden) => tmdbSearch(hidden.title, hidden.year)),
  ]);

  const altMovies = restMovies.slice(0, altTitles.length);
  const hiddenMovies = restMovies.slice(altTitles.length);

  // Wave 2 — providers for main + hidden titles + OMDB poster fallback
  const [providerSet, omdbMain, ...hiddenProviderSets] = await Promise.all([
    mainMovie ? tmdbProviders(mainMovie.id, mainMovie.media_type, countryCode) : Promise.resolve(null),
    !mainMovie?.poster_path ? omdbFetch(raw.title, raw.year) : Promise.resolve(null),
    ...hiddenMovies.map((m) => (m ? tmdbProviders(m.id, m.media_type, countryCode) : Promise.resolve(null))),
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

  const tmdbPoster = mainMovie?.poster_path ? `https://image.tmdb.org/t/p/w500${mainMovie.poster_path}` : undefined;
  const omdbPoster = omdbMain?.Response === "True" && omdbMain.Poster && omdbMain.Poster !== "N/A" ? omdbMain.Poster : undefined;

  const alternativePosterUrls = altMovies.map((m) =>
    m?.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : "",
  );

  // Restore platform info on hidden layer cards
  const hiddenLayerTitles: HiddenLayerTitle[] = hiddenRaw.map((hidden, i) => {
    const m = hiddenMovies[i];
    const set = hiddenProviderSets[i];
    const platform = set ? (mapProviders(set) ?? []).filter((p) => p.access === "subscription")[0]?.name : undefined;
    return {
      title: hidden.title,
      year: hidden.year,
      posterUrl: m?.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : undefined,
      platform,
    };
  });

  const { hiddenTitles: _dropped, ...rest } = raw;
  void _dropped;

  return {
    ...rest,
    omdbPosterUrl: tmdbPoster ?? omdbPoster,
    whereToWatch,
    alternativePosterUrls,
    hiddenLayer: {
      ...raw.hiddenLayer,
      titles: hiddenLayerTitles.length > 0 ? hiddenLayerTitles : undefined,
    },
  };
}
