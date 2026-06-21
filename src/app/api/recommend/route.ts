import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { buildRecommendationPrompt } from "@/lib/prompt";
import { RecommendRequest, Recommendation, WatchProvider, HiddenLayerTitle } from "@/lib/types";

type RecommendationSource = "anthropic" | "openai" | "local-fallback";

// Raw LLM response includes hiddenTitles before TMDB enrichment
type RawRecommendation = Recommendation & {
  hiddenTitles?: Array<{ title: string; year: string }>;
};

// ─── TMDB types ──────────────────────────────────────────────────────────────

type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string;
};

type TmdbProviderSet = {
  flatrate?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
};

type TmdbMovie = {
  id: number;
  poster_path: string | null;
};

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

// ─── TMDB fetch with rate limiting ───────────────────────────────────────────

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
    const res = await fetch(url, { headers, next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function tmdbSearch(title: string, year: string): Promise<TmdbMovie | null> {
  const q = encodeURIComponent(title.trim());
  const y = year ? `&primary_release_year=${year}` : "";
  const data = await tmdbFetch<{ results: TmdbMovie[] }>(`/search/movie?query=${q}${y}&language=en-US&page=1`);
  return data?.results?.[0] ?? null;
}

async function tmdbProviders(tmdbId: number, countryCode: string): Promise<TmdbProviderSet | null> {
  const data = await tmdbFetch<{ results: Record<string, TmdbProviderSet> }>(`/movie/${tmdbId}/watch/providers`);
  return data?.results?.[countryCode] ?? null;
}

function mapProviders(set: TmdbProviderSet): WatchProvider[] {
  const out: WatchProvider[] = [];
  const push = (list: TmdbProvider[] | undefined, access: WatchProvider["access"], note?: string) => {
    for (const p of list ?? []) {
      out.push({
        name: p.provider_name,
        access,
        note,
        logoUrl: `https://image.tmdb.org/t/p/original${p.logo_path}`,
      });
    }
  };
  push(set.flatrate, "subscription");
  push(set.free, "subscription", "Free");
  push(set.ads, "subscription", "With ads");
  push(set.rent, "rent");
  push(set.buy, "buy");
  return out;
}

function parseAltTitle(alt: string): { title: string; year: string } {
  const m = alt.match(/^(.+?)\s*\((\d{4})\)$/);
  return m ? { title: m[1].trim(), year: m[2] } : { title: alt, year: "" };
}

// ─── Enrich recommendation with TMDB data (all searches run in parallel) ─────

async function enrichWithTmdb(raw: RawRecommendation, country: string): Promise<Recommendation> {
  const countryCode = toCountryCode(country);
  const altTitles = raw.alternatives.map(parseAltTitle);
  const hiddenRaw = raw.hiddenTitles ?? [];

  // Fan out: all searches at once
  const [mainMovie, ...restMovies] = await Promise.all([
    tmdbSearch(raw.title, raw.year),
    ...altTitles.map((a) => tmdbSearch(a.title, a.year)),
    ...hiddenRaw.map((h) => tmdbSearch(h.title, h.year)),
  ]);

  const altMovies = restMovies.slice(0, altTitles.length);
  const hiddenMovies = restMovies.slice(altTitles.length);

  // Fan out: all provider lookups for titles that resolved
  const [mainProviderSet, ...hiddenProviderSets] = await Promise.all([
    mainMovie ? tmdbProviders(mainMovie.id, countryCode) : Promise.resolve(null),
    ...hiddenMovies.map((m) => (m ? tmdbProviders(m.id, countryCode) : Promise.resolve(null))),
  ]);

  // Build whereToWatch
  let whereToWatch = raw.whereToWatch;
  if (mainMovie) {
    if (mainProviderSet) {
      const providers = mapProviders(mainProviderSet);
      const primary = providers[0];
      whereToWatch = {
        status: "verified",
        primary: primary?.name ?? "Check locally",
        note: providers.length > 0
          ? `${primary.name}${providers.length > 1 ? ` · ${providers.length - 1} more` : ""}`
          : "Available in your region",
        providers,
        country,
        verifiedAt: new Date().toISOString(),
      };
    } else {
      whereToWatch = {
        status: "unverified",
        primary: "Not on major streaming platforms",
        note: "This title may not be available on streaming in your region. Check your apps or local cinema listings.",
      };
    }
  }

  // Build alternative poster URLs
  const alternativePosterUrls = altMovies.map((m) =>
    m?.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : "",
  );

  // Build Hidden Layer titles with posters + platform
  const hiddenLayerTitles: HiddenLayerTitle[] = hiddenRaw.map((ht, i) => {
    const m = hiddenMovies[i];
    const set = hiddenProviderSets[i];
    const platform = set ? mapProviders(set)[0]?.name : undefined;
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
    posterUrl: mainMovie?.poster_path ? `https://image.tmdb.org/t/p/w500${mainMovie.poster_path}` : undefined,
    whereToWatch,
    alternativePosterUrls,
    hiddenLayer: {
      ...raw.hiddenLayer,
      titles: hiddenLayerTitles.length > 0 ? hiddenLayerTitles : undefined,
    },
    tmdbAttribution: "Streaming data provided by JustWatch via TMDB",
  };
}

// ─── LLM helpers ─────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON");
  return match[0];
}

async function recommendWithAnthropic(prompt: string): Promise<RawRecommendation> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 1400,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return JSON.parse(extractJson(text));
}

async function recommendWithOpenAI(prompt: string): Promise<RawRecommendation> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const models = [process.env.OPENAI_MODEL, "gpt-4o-mini", "gpt-4o"].filter((m): m is string => Boolean(m));

  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await openai.responses.create({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
      });
      return JSON.parse(extractJson(response.output_text));
    } catch (err) {
      lastError = err;
      console.warn(`OpenAI ${model} failed:`, err instanceof Error ? err.message : String(err));
    }
  }
  throw lastError ?? new Error("OpenAI recommendation failed.");
}

function localFallback(input: RecommendRequest): RawRecommendation {
  const avoids = new Set((input.avoids ?? []).map((x) => x.toLowerCase()));
  const light = avoids.has("violence") || avoids.has("gore") || avoids.has("heavy drama");
  return {
    title: light ? "Perfect Days" : "Past Lives",
    year: "2023",
    format: "Film",
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
    whereToWatch: {
      status: "unverified",
      primary: "Availability needs verification",
      note: "Check your apps — F.U.N will verify availability in real time shortly.",
    },
    hiddenLayer: {
      headline: "Your taste may be bigger than your homepage.",
      insight: "The apps you open first may not be the apps that best match tonight's mood.",
      classyJab: "Your taste deserves a better map.",
    },
    hiddenTitles: [
      { title: "Aftersun", year: "2022" },
      { title: "All of Us Strangers", year: "2023" },
      { title: "The Zone of Interest", year: "2023" },
    ],
    alternatives: ["Aftersun (2022)", "The Worst Person in the World (2021)", "Drive My Car (2021)"],
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as RecommendRequest;
    const prompt = buildRecommendationPrompt(input);
    const country = input.country || "Poland";

    let raw: RawRecommendation;
    let source: RecommendationSource = "local-fallback";

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        raw = await recommendWithAnthropic(prompt);
        source = "anthropic";
      } catch (err) {
        console.warn("Anthropic failed, trying OpenAI:", err instanceof Error ? err.message : String(err));
        if (process.env.OPENAI_API_KEY) {
          try {
            raw = await recommendWithOpenAI(prompt);
            source = "openai";
          } catch (err2) {
            console.warn("OpenAI failed, using local fallback:", err2 instanceof Error ? err2.message : String(err2));
            raw = localFallback(input);
          }
        } else {
          raw = localFallback(input);
        }
      }
    } else if (process.env.OPENAI_API_KEY) {
      try {
        raw = await recommendWithOpenAI(prompt);
        source = "openai";
      } catch (err) {
        console.warn("OpenAI failed, using local fallback:", err instanceof Error ? err.message : String(err));
        raw = localFallback(input);
      }
    } else {
      raw = localFallback(input);
    }

    const enriched = await enrichWithTmdb(raw, country);

    return NextResponse.json(enriched, {
      headers: { "X-FUN-Recommendation-Source": source },
    });
  } catch (error) {
    console.error("Recommendation route failed:", error);
    return NextResponse.json(
      { error: "Recommendation failed. Check API keys or model output." },
      { status: 500 },
    );
  }
}
