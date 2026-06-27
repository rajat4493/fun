import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { checkAvailability } from "@/lib/availability";
import { buildRecommendationPrompt } from "@/lib/prompt";
import { RecommendRequest, Recommendation, WatchProvider, HiddenLayerTitle } from "@/lib/types";

type RecommendationSource = "anthropic" | "openai" | "local-fallback";

const LLM_TIMEOUT_MS = 18000;
const TMDB_TIMEOUT_MS = 3500;
const OMDB_TIMEOUT_MS = 2500;

// Raw LLM response is an array of Recommendations with hiddenTitles
type RawRecommendation = Recommendation & {
  hiddenTitles?: Array<{ title: string; year: string }>;
};

// ─── OMDB types ──────────────────────────────────────────────────────────────

type OmdbResponse = {
  Response: "True" | "False";
  Poster?: string;
  Error?: string;
};

// ─── TMDB types ──────────────────────────────────────────────────────────────

type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string;
};

type TmdbProviderSet = {
  link?: string; // Direct JustWatch URL for this title in this country
  flatrate?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
};

type TmdbMovie = {
  id: number;
  poster_path: string | null;
  media_type: "movie" | "tv";
};

function uniqueModels(models: Array<string | undefined>) {
  return [...new Set(models.filter((model): model is string => Boolean(model)))];
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

// ─── Country mapping ──────────────────────────────────────────────────────────

const countryCodeMap: Record<string, string> = {
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

function toCountryCode(country: string): string {
  return countryCodeMap[country.trim().toLowerCase()] ?? "US";
}

// ─── OMDB fetch ──────────────────────────────────────────────────────────────

async function omdbFetch(title: string, year: string): Promise<OmdbResponse | null> {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return null;
  try {
    const q = encodeURIComponent(title.trim());
    const yearParam = year ? `&y=${year}` : "";
    const url = `https://www.omdbapi.com/?t=${q}${yearParam}&apikey=${apiKey}`;
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(OMDB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json() as Promise<OmdbResponse>;
  } catch {
    return null;
  }
}

// ─── TMDB fetch ──────────────────────────────────────────────────────────────

async function tmdbFetch<T>(path: string): Promise<T | null> {
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!token && !apiKey) return null;
  try {
    const url = token
      ? `https://api.themoviedb.org/3${path}`
      : `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
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
  const movieYear = year ? `&primary_release_year=${year}` : "";
  const movieData = await tmdbFetch<{ results: Array<{ id: number; poster_path: string | null }> }>(
    `/search/movie?query=${q}${movieYear}&language=en-US&page=1`,
  );
  if (movieData?.results?.[0]) return { ...movieData.results[0], media_type: "movie" };
  // Fallback: TV search for Series picks
  const tvYear = year ? `&first_air_date_year=${year}` : "";
  const tvData = await tmdbFetch<{ results: Array<{ id: number; poster_path: string | null }> }>(
    `/search/tv?query=${q}${tvYear}&language=en-US&page=1`,
  );
  if (tvData?.results?.[0]) return { ...tvData.results[0], media_type: "tv" };
  return null;
}

async function tmdbProviders(tmdbId: number, mediaType: "movie" | "tv", countryCode: string): Promise<TmdbProviderSet | null> {
  const path = mediaType === "tv" ? `/tv/${tmdbId}/watch/providers` : `/movie/${tmdbId}/watch/providers`;
  const data = await tmdbFetch<{ results: Record<string, TmdbProviderSet> }>(path);
  return data?.results?.[countryCode] ?? null;
}

function mapProviders(set: TmdbProviderSet): WatchProvider[] {
  const out: WatchProvider[] = [];
  const seen = new Set<string>();
  const push = (list: TmdbProvider[] | undefined, access: WatchProvider["access"], note?: string) => {
    for (const p of list ?? []) {
      const key = `${p.provider_id}-${access}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: p.provider_name, access, note, logoUrl: `https://image.tmdb.org/t/p/original${p.logo_path}` });
    }
  };
  push(set.flatrate, "subscription");
  push(set.free, "subscription", "Free");
  push(set.ads, "subscription", "With ads");
  push(set.rent, "rent");
  push(set.buy, "buy");
  return out;
}

function isOnUserPlatforms(providers: WatchProvider[], userPlatforms: string[]): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const userNorm = userPlatforms.map(normalize);
  return providers
    .filter((p) => p.access === "subscription")
    .some((p) => {
      const pNorm = normalize(p.name);
      return userNorm.some((u) => pNorm.includes(u) || u.includes(pNorm));
    });
}

function parseAltTitle(alt: string): { title: string; year: string } {
  const m = alt.match(/^(.+?)\s*\((\d{4})\)$/);
  return m ? { title: m[1].trim(), year: m[2] } : { title: alt, year: "" };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function requestText(input: RecommendRequest): string {
  return [
    input.selfText,
    input.reference,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.avoids?.join(" "),
  ].filter(Boolean).join(" ");
}

function isKnownFalsePositiveForRequest(input: RecommendRequest, rec: RawRecommendation): boolean {
  const text = requestText(input);
  const title = normalizeForMatch(rec.title);

  if (/shameless/i.test(text)) {
    return [
      "thegoodplace",
      "parksandrecreation",
      "theoffice",
      "schittscreek",
      "derrygirls",
    ].includes(title);
  }

  return false;
}

function filterFalsePositiveRecommendations(input: RecommendRequest, batch: RawRecommendation[]): RawRecommendation[] {
  const filtered = batch.filter((rec) => !isKnownFalsePositiveForRequest(input, rec));
  return filtered.length > 0 ? filtered : batch;
}

// ─── Enrich with TMDB (streaming + poster) and OMDB (poster fallback) ────────

async function enrichRecommendation(raw: RawRecommendation, country: string, platforms: string[]): Promise<Recommendation> {
  const countryCode = toCountryCode(country);
  const localAvailability = checkAvailability(raw.title, raw.year, country);
  const altTitles = raw.alternatives.map(parseAltTitle);
  const hiddenRaw = raw.hiddenTitles ?? [];

  // Wave 1: All TMDB searches in parallel
  const [mainMovie, ...restMovies] = await Promise.all([
    tmdbSearch(raw.title, raw.year),
    ...altTitles.map((a) => tmdbSearch(a.title, a.year)),
    ...hiddenRaw.map((h) => tmdbSearch(h.title, h.year)),
  ]);

  const altMovies = restMovies.slice(0, altTitles.length);
  const hiddenMovies = restMovies.slice(altTitles.length);

  // Wave 2: Provider lookups + OMDB poster fallback if TMDB has no poster
  const [mainProviderSet, omdbMain, ...hiddenProviderSets] = await Promise.all([
    mainMovie ? tmdbProviders(mainMovie.id, mainMovie.media_type, countryCode) : Promise.resolve(null),
    !mainMovie?.poster_path ? omdbFetch(raw.title, raw.year) : Promise.resolve(null),
    ...hiddenMovies.map((m) => (m ? tmdbProviders(m.id, m.media_type, countryCode) : Promise.resolve(null))),
  ]);

  // Build providers and platform flags
  const tmdbProvidersList = mainProviderSet ? mapProviders(mainProviderSet) : [];
  const providers = localAvailability.status === "verified" ? localAvailability.providers : tmdbProvidersList;
  const notOnUserPlatforms = providers.length > 0 && platforms.length > 0 && !isOnUserPlatforms(providers, platforms);

  const whereToWatch: Recommendation["whereToWatch"] = mainProviderSet
    ? {
        status: "verified",
        primary: providers.filter((p) => p.access === "subscription")[0]?.name ?? providers[0]?.name ?? "Check locally",
        note: providers.filter((p) => p.access === "subscription").length > 0
          ? `On ${providers.filter((p) => p.access === "subscription").slice(0, 2).map((p) => p.name).join(" · ")}`
          : "Available to rent or buy",
        providers,
        country,
        verifiedAt: new Date().toISOString(),
        notOnUserPlatforms,
      }
    : localAvailability.status === "verified"
      ? {
          status: "verified",
          primary: localAvailability.primary,
          note: localAvailability.note,
          providers: localAvailability.providers,
          country,
          verifiedAt: localAvailability.verifiedAt,
          notOnUserPlatforms,
        }
      : {
          status: "unverified",
          primary: "Availability not verified yet",
          note: "Availability not verified yet.",
          providers: [],
          country,
          notOnUserPlatforms: false,
        };

  // Poster: TMDB preferred, OMDB as fallback
  const tmdbPoster = mainMovie?.poster_path ? `https://image.tmdb.org/t/p/w500${mainMovie.poster_path}` : undefined;
  const omdbPoster = omdbMain?.Response === "True" && omdbMain.Poster && omdbMain.Poster !== "N/A" ? omdbMain.Poster : undefined;

  // Alternative poster URLs from TMDB
  const alternativePosterUrls = altMovies.map((m) =>
    m?.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : "",
  );

  // Hidden layer titles with TMDB posters + streaming platform
  const hiddenLayerTitles: HiddenLayerTitle[] = hiddenRaw.map((ht, i) => {
    const m = hiddenMovies[i];
    const set = hiddenProviderSets[i];
    const platform = set ? mapProviders(set).filter((p) => p.access === "subscription")[0]?.name : undefined;
    return {
      title: ht.title,
      year: ht.year,
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
    omdbAttribution: localAvailability.status === "verified"
      ? "Availability checked against F.U.N's local verified sample catalogue"
      : "Streaming data by JustWatch via TMDB",
  };
}

// ─── LLM helpers ─────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }
  const match = trimmed.match(/[\[\{][\s\S]*[\]\}]/);
  if (!match) throw new Error("Model did not return JSON");
  return match[0];
}

async function recommendWithAnthropic(prompt: string): Promise<RawRecommendation[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4000,
    temperature: 0.85,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const parsed = JSON.parse(extractJson(text));
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function recommendWithOpenAI(prompt: string): Promise<RawRecommendation[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const models = uniqueModels([process.env.OPENAI_MODEL, "gpt-4o-mini"]);

  let lastError: unknown;
  for (const model of models) {
    try {
      // No json_object format — that mode forbids array output; rely on extractJson instead
      const response = await withTimeout(
        openai.responses.create({
          model,
          input: prompt,
          temperature: 0.85,
        }),
        LLM_TIMEOUT_MS,
        `OpenAI ${model}`,
      );
      const parsed = JSON.parse(extractJson(response.output_text));
      if (Array.isArray(parsed)) return parsed;
      // Model may have wrapped the array in an object (e.g. { "picks": [...] })
      const wrapped = Object.values(parsed).find(Array.isArray);
      if (wrapped) return wrapped as RawRecommendation[];
      return [parsed as RawRecommendation];
    } catch (err) {
      lastError = err;
      console.warn(`OpenAI ${model} failed:`, err instanceof Error ? err.message : String(err));
    }
  }
  throw lastError ?? new Error("OpenAI recommendation failed.");
}

function localFallback(input: RecommendRequest): RawRecommendation[] {
  const text = requestText(input);
  const wantsShameless = /shameless/i.test(text);

  if (wantsShameless && (input.platforms ?? []).some((p) => /netflix/i.test(p))) {
    const baseRec = {
      format: "Series" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Messy families, sharper edges",
        insight: "The match is not sitcom comfort. It is flawed people making bad choices, then somehow remaining worth following.",
        classyJab: "Chaos works best when it has a pulse.",
      },
    };

    return [
      {
        title: "Ginny & Georgia",
        year: "2021",
        runtime: "50 min per episode",
        vibe: "messy, fast, family-driven",
        confidence: 86,
        oneLine: "Watch Ginny & Georgia tonight for family chaos, secrets, and bad decisions with a glossy sting.",
        whyItFits: [
          "It keeps the unstable parent-child engine that makes Shameless addictive.",
          "The comedy has consequences instead of feeling purely cozy.",
          "It has secrets, survival energy, and people you root for while questioning them.",
        ],
        hiddenTitles: [
          { title: "Good Girls", year: "2018" },
          { title: "Orange Is the New Black", year: "2013" },
          { title: "Maid", year: "2021" },
        ],
        alternatives: ["Good Girls (2018)", "Orange Is the New Black (2013)", "Maid (2021)"],
        ...baseRec,
      },
      {
        title: "Good Girls",
        year: "2018",
        runtime: "43 min per episode",
        vibe: "criminal, desperate, funny",
        confidence: 84,
        oneLine: "Watch Good Girls if you want ordinary people cornered into outrageous choices.",
        whyItFits: [
          "It shares the survival-through-schemes rhythm of Shameless.",
          "The humor comes from pressure, not polished sitcom setups.",
          "Its characters keep making things worse in ways that are easy to binge.",
        ],
        hiddenTitles: [
          { title: "Ginny & Georgia", year: "2021" },
          { title: "Orange Is the New Black", year: "2013" },
          { title: "Maid", year: "2021" },
        ],
        alternatives: ["Ginny & Georgia (2021)", "Orange Is the New Black (2013)", "Maid (2021)"],
        ...baseRec,
      },
      {
        title: "Orange Is the New Black",
        year: "2013",
        runtime: "55 min per episode",
        vibe: "raucous, wounded, ensemble",
        confidence: 82,
        oneLine: "Watch Orange Is the New Black for a sprawling ensemble of flawed people under pressure.",
        whyItFits: [
          "It has the same comic-dramatic swing between absurdity and real damage.",
          "The ensemble is morally messy without becoming bland.",
          "It turns institutional pressure into character chaos.",
        ],
        hiddenTitles: [
          { title: "Good Girls", year: "2018" },
          { title: "Ginny & Georgia", year: "2021" },
          { title: "Maid", year: "2021" },
        ],
        alternatives: ["Good Girls (2018)", "Ginny & Georgia (2021)", "Maid (2021)"],
        ...baseRec,
      },
    ];
  }

  const avoids = new Set((input.avoids ?? []).map((x) => x.toLowerCase()));
  const light = avoids.has("violence") || avoids.has("gore") || avoids.has("heavy drama");

  const baseRec = {
    format: "Film" as const,
    whereToWatch: {
      status: "unverified" as const,
      primary: "Availability needs verification",
      note: "Check your apps — F.U.N will verify availability in real time shortly.",
    },
    hiddenLayer: {
      headline: "Your taste may be bigger than your homepage.",
      insight: "The apps you open first may not be the apps that best match tonight's mood.",
      classyJab: "Your taste deserves a better map.",
    },
  };

  return [
    {
      title: light ? "Perfect Days" : "Past Lives",
      year: "2023",
      runtime: light ? "124 min" : "106 min",
      vibe: light ? "quiet, warm, reflective" : "emotional, elegant, bittersweet",
      confidence: 78,
      oneLine: light
        ? "Tonight, watch Perfect Days if you want calm without boredom."
        : "Tonight, watch Past Lives if you want emotion without noise.",
      whyItFits: [
        "It matches the mood-first request instead of forcing a genre.",
        "It is strong enough to feel special, but not mentally exhausting.",
        "It fits F.U.N's promise: one decision, not another endless list.",
      ],
      hiddenTitles: [
        { title: "Aftersun", year: "2022" },
        { title: "All of Us Strangers", year: "2023" },
        { title: "The Zone of Interest", year: "2023" },
      ],
      alternatives: ["Aftersun (2022)", "The Worst Person in the World (2021)", "Drive My Car (2021)"],
      ...baseRec,
    },
    {
      title: light ? "A Thousand and One" : "20 Days in Mariupol",
      year: "2023",
      runtime: light ? "97 min" : "130 min",
      vibe: light ? "uplifting, intimate, human" : "powerful, haunting, necessary",
      confidence: 72,
      oneLine: light ? "Warmth and humor in unexpected places." : "A vital documentary about resilience.",
      whyItFits: [
        "A different format to keep things fresh.",
        "Strong storytelling without the usual streaming algorithm picks.",
        "Surprises you without exhausting you.",
      ],
      hiddenTitles: [
        { title: "The Eternal Memory", year: "2023" },
        { title: "Grand Concourse", year: "2021" },
        { title: "Neon Flesh", year: "2010" },
      ],
      alternatives: ["Showing Up (2022)", "In the Mood for Love (2000)", "Stalker (1979)"],
      ...baseRec,
    },
    {
      title: light ? "The Eternal Memory" : "The Iron Claw",
      year: light ? "2023" : "2023",
      runtime: light ? "90 min" : "128 min",
      vibe: light ? "meditative, poetic, gentle" : "intense, tragic, unforgettable",
      confidence: 75,
      oneLine: light ? "A meditation on memory and love." : "A devastating portrait of ambition and family.",
      whyItFits: [
        "International cinema brings perspective.",
        "Beautiful direction and cinematography.",
        "Worth your full attention tonight.",
      ],
      hiddenTitles: [
        { title: "The Taste of Things", year: "2023" },
        { title: "In My Room", year: "2018" },
        { title: "Bergman Island", year: "2021" },
      ],
      alternatives: ["La Haine (1995)", "The Celebration (1998)", "Requiem for a Dream (2000)"],
      ...baseRec,
    },
  ];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as RecommendRequest;
    const prompt = buildRecommendationPrompt(input);
    const country = input.country || "Poland";

    let batch: RawRecommendation[];
    let source: RecommendationSource = "local-fallback";

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        batch = await recommendWithAnthropic(prompt);
        source = "anthropic";
      } catch (err) {
        console.warn("Anthropic failed, trying OpenAI:", err instanceof Error ? err.message : String(err));
        if (process.env.OPENAI_API_KEY) {
          try {
            batch = await recommendWithOpenAI(prompt);
            source = "openai";
          } catch (err2) {
            console.warn("OpenAI failed, using local fallback:", err2 instanceof Error ? err2.message : String(err2));
            batch = localFallback(input);
          }
        } else {
          batch = localFallback(input);
        }
      }
    } else if (process.env.OPENAI_API_KEY) {
      try {
        batch = await recommendWithOpenAI(prompt);
        source = "openai";
      } catch (err) {
        console.warn("OpenAI failed, using local fallback:", err instanceof Error ? err.message : String(err));
        batch = localFallback(input);
      }
    } else {
      batch = localFallback(input);
    }

    // Ensure we have exactly 3 recommendations after removing known false-positive matches.
    const normalizedBatch = filterFalsePositiveRecommendations(input, batch).slice(0, 3);
    if (normalizedBatch.length < 3) {
      console.warn(`Expected 3 recommendations, got ${normalizedBatch.length}`);
    }

    const subscriptionOnly = input.platformFilter === "mine";

    // Subscription-only mode must not leak unverified/off-subscription picks.
    // Enrich all three candidates so filtering is based on backend availability,
    // not on the model's guess.
    let enrichedBatch = subscriptionOnly
      ? await Promise.all(normalizedBatch.map((pick) => enrichRecommendation(pick, country, input.platforms ?? [])))
      : [
          await enrichRecommendation(normalizedBatch[0], country, input.platforms ?? []),
          ...normalizedBatch.slice(1),
        ];

    if (subscriptionOnly) {
      enrichedBatch = enrichedBatch.filter((r) => (
        r.whereToWatch.status === "verified" &&
        !r.whereToWatch.notOnUserPlatforms &&
        (r.whereToWatch.providers ?? []).some((p) => p.access === "subscription")
      ));

      if (enrichedBatch.length === 0) {
        const fallbackBatch = await Promise.all(localFallback(input).map((pick) => enrichRecommendation(pick, country, input.platforms ?? [])));
        enrichedBatch = fallbackBatch.filter((r) => (
          r.whereToWatch.status === "verified" &&
          !r.whereToWatch.notOnUserPlatforms &&
          (r.whereToWatch.providers ?? []).some((p) => p.access === "subscription")
        ));
      }

      if (enrichedBatch.length === 0 && normalizedBatch[0]) {
        const fallback = await enrichRecommendation(normalizedBatch[0], country, input.platforms ?? []);
        enrichedBatch = [{
          ...fallback,
          whereToWatch: {
            status: "unverified",
            primary: "No verified match inside your subscriptions yet",
            note: "Try another mood or search beyond your subscriptions.",
            providers: [],
            country,
            notOnUserPlatforms: false,
          },
        }];
      }
    }

    // Return the first recommendation (client manages batch rotation)
    const firstPick = enrichedBatch[0];

    return NextResponse.json(
      {
        ...firstPick,
        _batch: enrichedBatch, // Include full batch for client-side batching
        _batchIndex: 0,
      },
      {
        headers: { "X-FUN-Recommendation-Source": source },
      },
    );
  } catch (error) {
    console.error("Recommendation route failed:", error);
    return NextResponse.json(
      { error: "Recommendation failed. Check API keys or model output." },
      { status: 500 },
    );
  }
}
