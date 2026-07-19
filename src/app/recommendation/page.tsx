"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Calendar,
  ChevronDown,
  Clock3,
  ExternalLink,
  Film,
  Globe2,
  Heart,
  Layers,
  Monitor,
  Play,
  RefreshCw,
  Search,
  Share2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  type LucideIcon,
  Zap,
} from "lucide-react";
import {
  addSeenTitle,
  createRecommendationSession,
  defaultRecommendation,
  FeedbackReason,
  getOrCreateSessionId,
  loadRecommendationFeedbackContext,
  loadRecommendationMemoryTitles,
  RecommendationSession,
  recommendationStorageKey,
  rememberRecommendationHistory,
  rememberRecommendationTitles,
  saveRecommendationFeedback,
  toTitleCase,
} from "@/lib/recommendation-session";
import { Recommendation, RecommendationDisplayState, WatchProvider } from "@/lib/types";

const LOADING_KEY = "fun:loading";
const LOADING_STARTED_KEY = "fun:loading-started-at";
const ERROR_KEY = "fun:recommendation-error";
const LOADING_TIMEOUT_MS = 85000;

const SEARCH_TITLES = [
  "Parasite for the perfect trap",
  "The Bear for pressure",
  "Fleabag for bite",
  "Past Lives for impossible timing",
  "The Godfather for family pressure",
  "Moonlight for quiet ache",
  "Before Sunrise for one-night magic",
  "The Handmaiden for elegant danger",
  "Super Deluxe for beautiful chaos",
  "A Separation for moral tension",
];

const FEEDBACK_OPTIONS: Array<{ reason: FeedbackReason; label: string; icon: LucideIcon; tone: string }> = [
  { reason: "wrong-vibe", label: "Wrong vibe", icon: Star, tone: "red" },
  { reason: "already-seen", label: "Already seen", icon: RefreshCw, tone: "plain" },
  { reason: "not-on-service", label: "Not on my service", icon: Monitor, tone: "plain" },
  { reason: "too-much-effort", label: "Too much effort", icon: Zap, tone: "purple" },
];

const justWatchLocale: Record<string, string> = {
  Poland: "pl",
  "United States": "us",
  "United Kingdom": "gb",
  Germany: "de",
  France: "fr",
  Spain: "es",
  Italy: "it",
  Netherlands: "nl",
  Sweden: "se",
  Denmark: "dk",
  Belgium: "be",
  Austria: "at",
  Ireland: "ie",
  Portugal: "pt",
  India: "in",
  Canada: "ca",
  Australia: "au",
  Brazil: "br",
  Mexico: "mx",
};

function captureEvent(type: string, payload: Record<string, unknown>) {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: getOrCreateSessionId(), type, payload }),
  }).catch(() => {});
}

function loadSession(): RecommendationSession | null {
  try {
    const raw = localStorage.getItem(recommendationStorageKey);
    return raw ? JSON.parse(raw) as RecommendationSession : null;
  } catch {
    return null;
  }
}

function logo() {
  return (
    <span className="text-3xl font-medium tracking-[0.34em] text-white">
      F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
    </span>
  );
}

function justWatchUrl(title: string, country?: string) {
  const locale = justWatchLocale[country ?? ""] ?? "us";
  return `https://www.justwatch.com/${locale}/search?q=${encodeURIComponent(title)}`;
}

function normalizeProviderName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function providerSearchUrl(provider: WatchProvider, title: string): string | null {
  const q = encodeURIComponent(title);
  const name = normalizeProviderName(provider.name);
  if (name.includes("netflix")) return `https://www.netflix.com/search?q=${q}`;
  if (name.includes("primevideo") || name.includes("amazon")) return `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`;
  if (name.includes("disney") || name.includes("hotstar") || name.includes("jiohotstar")) return `https://www.hotstar.com/in/search?q=${q}`;
  if (name.includes("max") || name.includes("hbo")) return `https://www.max.com/search?q=${q}`;
  if (name.includes("appletv")) return `https://tv.apple.com/search?term=${q}`;
  if (name.includes("youtube")) return `https://www.youtube.com/results?search_query=${q}`;
  if (name.includes("mubi")) return `https://mubi.com/search?query=${q}`;
  if (name.includes("zee5")) return `https://www.zee5.com/search?q=${q}`;
  if (name.includes("sonyliv")) return `https://www.sonyliv.com/search?q=${q}`;
  return null;
}

function providerMatchesUserPlatform(provider: WatchProvider, platforms: string[]) {
  const providerName = normalizeProviderName(provider.name);
  return platforms.some((platform) => {
    const selected = normalizeProviderName(platform);
    return providerName.includes(selected) || selected.includes(providerName);
  });
}

function primaryWatchProvider(providers: WatchProvider[], platforms: string[]) {
  const subscription = providers.filter((provider) => provider.access === "subscription" || provider.access === "included");
  return subscription.find((provider) => providerMatchesUserPlatform(provider, platforms)) ?? subscription[0] ?? providers[0] ?? null;
}

function watchAction(pick: Recommendation, providers: WatchProvider[], platforms: string[], fallbackUrl: string) {
  const provider = primaryWatchProvider(providers, platforms);
  if (pick.whereToWatch.status !== "verified" || !provider) {
    return { label: "Find where to watch", href: fallbackUrl, verified: false };
  }
  if (provider.url && provider.urlKind === "title") {
    return { label: `Watch on ${provider.name}`, href: provider.url, verified: true };
  }
  const searchUrl = providerSearchUrl(provider, pick.title);
  if (searchUrl && (provider.access === "subscription" || provider.access === "included")) {
    return { label: `Open ${provider.name}`, href: searchUrl, verified: true };
  }
  return { label: "Find where to watch", href: fallbackUrl, verified: false };
}

function MovieImage({ posterUrl, title, className = "", objectPosition = "center" }: { posterUrl?: string; title: string; className?: string; objectPosition?: string }) {
  if (posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={posterUrl} alt={title} className={`object-cover ${className}`} style={{ objectPosition }} />;
  }
  return <div className={`bg-gradient-to-br from-[#1a1625] via-[#12141c] to-[#0a0b10] ${className}`} />;
}

function ProviderLogo({ provider }: { provider: WatchProvider }) {
  if (provider.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={provider.logoUrl} alt={provider.name} className="h-10 w-10 rounded-lg object-contain" />;
  }
  return <span className="grid h-10 w-10 place-items-center rounded-lg bg-black/55 text-lg font-black text-white">{provider.name.charAt(0)}</span>;
}

function ProviderCard({ provider }: { provider: WatchProvider }) {
  const detail = provider.note ?? provider.price ?? (provider.access === "rent" ? "Rent" : provider.access === "buy" ? "Buy" : "Included");
  const href = provider.url && provider.urlKind === "title" ? provider.url : undefined;
  const content = (
    <>
      <ProviderLogo provider={provider} />
      <div className="min-w-0">
        <p className="truncate text-sm text-white">{provider.name}</p>
        <p className="truncate text-xs text-white/48">{detail}</p>
      </div>
      {href && <ExternalLink size={14} className="ml-auto shrink-0 text-white/42" />}
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3 transition hover:border-white/24 hover:bg-white/[0.075]">
        {content}
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3">
      {content}
    </div>
  );
}

function InfoPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.065] px-3 py-1.5 text-sm text-white/72">
      <Icon size={15} />
      {label}
    </span>
  );
}

function displayStateFor(session: RecommendationSession | null, pick: Recommendation): RecommendationDisplayState {
  return session?.displayState ?? (pick.whereToWatch.status === "verified" ? "verified" : "unverified");
}

function titleSize(title: string) {
  const longest = Math.max(...title.split(/\s+/).map((word) => word.length));
  if (longest > 12 || title.length > 30) return "clamp(3.1rem,6.2vw,6.4rem)";
  if (title.length > 18) return "clamp(3.6rem,7vw,7.3rem)";
  return "clamp(4.6rem,8.6vw,9rem)";
}

function scoreClass(score: number) {
  if (score >= 85) return "text-emerald-300 border-emerald-400/45";
  if (score >= 70) return "text-amber-200 border-amber-300/45";
  return "text-red-200 border-red-300/45";
}

export default function RecommendationPage() {
  const [session, setSession] = useState<RecommendationSession | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rerolling, setRerolling] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | null>(null);
  const [searchIdx, setSearchIdx] = useState(0);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [watchOptionsOpen, setWatchOptionsOpen] = useState(false);

  useEffect(() => {
    if (!fetchLoading) return;
    const timer = setInterval(() => setSearchIdx((index) => (index + 1) % SEARCH_TITLES.length), 1500);
    return () => clearInterval(timer);
  }, [fetchLoading]);

  useEffect(() => {
    const isLoading = localStorage.getItem(LOADING_KEY) === "true";
    if (isLoading) {
      setFetchLoading(true);
      const interval = setInterval(() => {
        const startedAt = Number(localStorage.getItem(LOADING_STARTED_KEY) ?? Date.now());
        if (Date.now() - startedAt > LOADING_TIMEOUT_MS) {
          clearInterval(interval);
          localStorage.removeItem(LOADING_KEY);
          localStorage.removeItem(LOADING_STARTED_KEY);
          setFetchError("The recommendation took too long. Please try again.");
          setFetchLoading(false);
          setReady(true);
          return;
        }
        if (localStorage.getItem(LOADING_KEY) !== "true") {
          clearInterval(interval);
          const error = localStorage.getItem(ERROR_KEY);
          if (error) {
            localStorage.removeItem(ERROR_KEY);
            setFetchError(error);
          } else {
            const loaded = loadSession();
            if (loaded) {
              setSession(loaded);
              setBatchIndex(loaded.batchIndex ?? 0);
            } else {
              setNoSession(true);
            }
          }
          setFetchLoading(false);
          setReady(true);
        }
      }, 400);
      return () => clearInterval(interval);
    }
    const loaded = loadSession();
    if (!loaded) setNoSession(true);
    else {
      setSession(loaded);
      setBatchIndex(loaded.batchIndex ?? 0);
    }
    setReady(true);
  }, []);

  async function replaceWithBatch(request: RecommendationSession["request"]) {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error("failed");
    const data = await response.json() as Recommendation & { _batch?: Recommendation[]; _trust?: { displayState?: RecommendationDisplayState } };
    const batch = data._batch ?? [data];
    rememberRecommendationTitles(batch.map((item) => item.title));
    rememberRecommendationHistory(batch, request);
    const next = createRecommendationSession(batch[0], request, batch, data._trust?.displayState);
    localStorage.setItem(recommendationStorageKey, JSON.stringify(next));
    setSession(next);
    setBatchIndex(0);
    setFeedbackReason(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    captureEvent("recommendation", {
      title: batch[0].title,
      year: batch[0].year,
      confidence: batch[0].confidence,
      source: "reroll",
    });
  }

  async function handleSeenIt() {
    if (!session) return;
    setRerolling(true);
    try {
      const seen = addSeenTitle(session.recommendation.title);
      const batch = session.batch ?? [session.recommendation];
      const nextIndex = batchIndex + 1;
      if (nextIndex < batch.length) {
        const next = { ...session, recommendation: batch[nextIndex], batchIndex: nextIndex };
        localStorage.setItem(recommendationStorageKey, JSON.stringify(next));
        setSession(next);
        setBatchIndex(nextIndex);
        setFeedbackReason(null);
      } else {
        await replaceWithBatch({
          ...session.request,
          seenTitles: seen,
          recentTitles: [...loadRecommendationMemoryTitles(), ...batch.map((item) => item.title)].slice(0, 40),
          feedbackContext: loadRecommendationFeedbackContext(),
        });
      }
    } catch {
      setFetchError("Could not find another pick. Please try a new mood.");
    } finally {
      setRerolling(false);
    }
  }

  function handleFeedback(reason: FeedbackReason) {
    if (!session) return;
    if (reason === "already-seen") addSeenTitle(session.recommendation.title);
    saveRecommendationFeedback(reason, session, "pre-watch");
    setFeedbackReason(reason);
    const request = session.request;
    const payload = {
      reason,
      title: session.recommendation.title,
      year: session.recommendation.year,
      format: session.recommendation.format,
      confidence: session.recommendation.confidence,
      country: request.country,
      mood: request.mood,
      wants: request.wants,
      avoids: request.avoids,
      languagePreferences: request.languagePreferences,
      craziness: request.craziness,
      platformFilter: request.platformFilter,
      energy: request.energy,
      viewingContext: request.viewingContext,
      batchIndex: session.batchIndex ?? 0,
      batchSize: session.batch?.length ?? 1,
    };

    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: getOrCreateSessionId(), ...payload }),
    }).catch(() => {});
    captureEvent("feedback", payload);
    if (reason === "already-seen") {
      void handleSeenIt();
    }
  }

  async function handleShare() {
    const text = `My F.U.N pick: ${pick.title} (${pick.year}) — ${pick.oneLine}`;
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Tonight's F.U.N pick", text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setShareState("copied");
        window.setTimeout(() => setShareState("idle"), 1800);
      }
      captureEvent("share", { title: pick.title, year: pick.year });
    } catch {
      // Share cancellation is normal; do not show an error.
    }
  }

  async function handleSearchBeyondSubscriptions() {
    if (!session) return;
    setRerolling(true);
    try {
      await replaceWithBatch({
        ...session.request,
        platformFilter: "any",
        recentTitles: [
          ...loadRecommendationMemoryTitles(),
          ...(session.batch ?? [session.recommendation]).map((item) => item.title),
        ].slice(0, 40),
        feedbackContext: loadRecommendationFeedbackContext(),
      });
    } catch {
      setFetchError("Could not search beyond your subscriptions. Try again.");
    } finally {
      setRerolling(false);
    }
  }

  const pick = session?.recommendation ?? defaultRecommendation;
  const batch = session?.batch ?? [pick];
  const region = session?.request.country ?? "Poland";
  const language = session?.request.languagePreferences?.length ? session.request.languagePreferences.slice(0, 2).join(", ") : "Any language";
  const providers = pick.whereToWatch.providers ?? [];
  const subProviders = providers.filter((provider) => provider.access === "subscription" || provider.access === "included");
  const rentBuyProviders = providers.filter((provider) => provider.access === "rent" || provider.access === "buy");
  const fallbackUrl = justWatchUrl(pick.title, region);
  const primaryAction = watchAction(pick, providers, session?.request.platforms ?? [], fallbackUrl);
  const watchOptionLinks = providers
    .map((provider) => ({
      provider,
      href: provider.url && provider.urlKind === "title" ? provider.url : providerSearchUrl(provider, pick.title),
    }))
    .filter((item): item is { provider: WatchProvider; href: string } => Boolean(item.href));
  const verified = pick.whereToWatch.status === "verified";
  const subscriptionOnly = session?.request.platformFilter === "mine";
  const displayState = displayStateFor(session, pick);
  const noSubscriptionMatch = displayState === "no-subscription-match";
  const avoidanceFallback = displayState === "avoidance-fallback";
  const exhaustedSubscriptionBatch = subscriptionOnly && !noSubscriptionMatch && batch.length > 0 && batchIndex >= batch.length - 1;
  const stateCopy = noSubscriptionMatch
    ? {
        eyebrow: "My subscriptions · No verified match",
        line: "No confident subscription match",
        detail: "Search all cinema for the best mood match, or refine your selection.",
        icon: Shield,
        tone: "text-white/36",
      }
    : avoidanceFallback
    ? {
        eyebrow: "Safer close match",
        line: "Avoidances protected",
        detail: verified ? pick.whereToWatch.note : "Availability needs checking for your region.",
        icon: Shield,
        tone: "text-amber-200",
      }
    : displayState === "verified"
    ? {
        eyebrow: "Your one pick",
        line: "Verified availability",
        detail: pick.whereToWatch.note,
        icon: BadgeCheck,
        tone: "text-emerald-300",
      }
    : {
        eyebrow: "Your one pick",
        line: "Availability not verified",
        detail: "Use watch options to confirm before watching.",
        icon: Search,
        tone: "text-white/38",
      };
  const StateIcon = stateCopy.icon;
  const primaryVibe = toTitleCase(pick.vibe.split(",")[0] || pick.format);
  const hiddenTitles = pick.hiddenLayer.titles ?? [];
  const similar = pick.alternatives.slice(0, 4).map((item, index) => {
    const [titlePart] = item.split(" (");
    const year = item.match(/\((\d{4})\)/)?.[1] ?? "";
    return { title: titlePart, year, posterUrl: pick.alternativePosterUrls?.[index] };
  });

  const artworkPosition = useMemo(() => {
    const seed = `${pick.title}-${pick.year}`.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return `${seed % 2 === 0 ? "center" : "top"}`;
  }, [pick.title, pick.year]);

  const whyItFitsLabel = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Why it fits your morning";
    if (hour >= 12 && hour < 17) return "Why it fits your afternoon";
    if (hour >= 17 && hour < 21) return "Why it fits your evening";
    return "Why it fits tonight";
  }, []);

  if (fetchLoading) {
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#030303] text-white">
        <div className="absolute inset-0 bg-cover bg-center opacity-18" style={{ backgroundImage: "url('/fun/hero-cinematic.png')" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-[#030303]" />
        <div className="relative z-10 text-center">
          <div className="mb-10">{logo()}</div>
          <div className="flex items-center justify-center gap-3 text-lg text-white/80">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.85)]" />
            Finding your perfect pick...
          </div>
          <p className="mt-3 h-5 text-sm text-white/36">
            Searching <span className="text-white/60">{SEARCH_TITLES[searchIdx]}</span>...
          </p>
        </div>
      </main>
    );
  }

  if (!ready) return null;

  if (fetchError || noSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#030303] px-6 text-center text-white">
        <div>
          <div className="mb-5">{logo()}</div>
          <h1 className="font-serif text-4xl">{fetchError ? "Something went wrong" : "No recommendation yet"}</h1>
          <p className="mt-3 text-white/50">{fetchError ?? "Pick your mood first and F.U.N will find your one match."}</p>
          <Link href="/" className="mt-8 inline-flex h-12 items-center gap-3 rounded-xl bg-gradient-to-b from-red-500 to-red-900 px-6 font-semibold text-white">
            <Star size={18} /> Pick a mood
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#030303] text-white">
      {pick.omdbPosterUrl ? (
        <div className="fixed inset-0 scale-110 bg-cover bg-center opacity-14 blur-2xl" style={{ backgroundImage: `url('${pick.omdbPosterUrl}')` }} />
      ) : (
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_74%_24%,rgba(239,68,68,0.18),transparent_26%),#030303]" />
      )}
      <div className="fixed inset-0 bg-[linear-gradient(90deg,#030303_0%,rgba(3,3,3,0.82)_52%,rgba(3,3,3,0.95)_100%)]" />

      <section className="relative mx-auto w-full max-w-[1720px] px-5 pb-8 pt-5 sm:px-8 lg:px-12">
        <header className="flex h-14 items-center justify-between border-b border-white/[0.08] pb-4">
          <Link href="/" className="inline-flex items-center gap-5 text-white">
            <ArrowLeft size={23} className="text-white/76" />
            {logo()}
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 text-sm text-white/64 sm:inline-flex">
              <Globe2 size={15} /> {region} · {language}
            </span>
            <button
              type="button"
              onClick={handleShare}
              className="hidden h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 text-sm text-white/64 transition hover:border-white/24 hover:text-white sm:inline-flex"
            >
              <Share2 size={15} /> {shareState === "copied" ? "Copied" : "Share"}
            </button>
            <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-full border border-amber-300/35 bg-amber-400/[0.055] px-5 text-sm text-amber-100 transition hover:bg-amber-400/[0.1]">
              <Sparkles size={16} /> New mood
            </Link>
          </div>
        </header>

        {noSubscriptionMatch ? (
          <section className="py-12">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-sm text-white/46">
              <StateIcon size={15} className={stateCopy.tone} />
              {stateCopy.eyebrow}
            </div>
            <h1 className="font-serif text-4xl font-normal leading-tight text-white/90 sm:text-5xl">
              No confident match<br />on your subscriptions.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-7 text-white/52">
              F.U.N checked your subscriptions and couldn{"'"}t verify{" "}
              <span className="italic text-white/72">{pick.title}</span>{" "}
              or similar picks. Search all cinema for the best mood match, or refine your selection.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={handleSearchBeyondSubscriptions}
                disabled={rerolling}
                className="inline-flex h-16 min-w-[240px] items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-red-400 to-red-800 px-7 text-lg font-semibold text-white shadow-[0_18px_52px_rgba(127,29,29,0.44)] transition hover:brightness-110 disabled:opacity-60"
              >
                <Search size={20} />
                {rerolling ? "Searching…" : "Search all cinema"}
              </button>
              <Link href="/" className="inline-flex h-16 min-w-[180px] items-center justify-center gap-3 rounded-xl border border-amber-300/35 bg-amber-400/[0.055] px-6 text-lg font-semibold text-amber-100 transition hover:bg-amber-400/[0.1]">
                <Sparkles size={18} /> Refine mood
              </Link>
            </div>
          </section>
        ) : (
          <section className="grid min-h-[620px] items-center gap-9 py-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/[0.07] px-3 py-1.5 text-sm text-amber-100">
                <Sparkles size={15} />
                {stateCopy.eyebrow}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/68">{batchIndex + 1} of {batch.length}</span>
              </div>
              <h1 className="font-serif font-normal leading-[0.88] tracking-normal text-white" style={{ fontSize: titleSize(pick.title) }}>
                {pick.title}
              </h1>
              <p className="mt-6 max-w-3xl text-2xl leading-9 text-white/78">{pick.oneLine}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <InfoPill icon={Calendar} label={pick.year} />
                <InfoPill icon={Clock3} label={pick.runtime} />
                <InfoPill icon={Heart} label={primaryVibe} />
                <InfoPill icon={pick.format === "Series" || pick.format === "Episode" ? Monitor : Film} label={pick.format} />
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={primaryAction.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => captureEvent("watch-click", { title: pick.title, label: primaryAction.label, href: primaryAction.href, verified: primaryAction.verified })}
                  className="inline-flex h-16 min-w-[280px] items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-red-400 to-red-800 px-7 text-lg font-semibold text-white shadow-[0_18px_52px_rgba(127,29,29,0.44)] transition hover:brightness-110"
                >
                  <Play size={20} fill="currentColor" /> {primaryAction.label}
                  {primaryAction.verified && <BadgeCheck size={18} />}
                </a>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setWatchOptionsOpen((open) => !open)}
                    className="inline-flex h-16 min-w-[250px] items-center justify-center gap-3 rounded-xl border border-white/12 bg-white/[0.045] px-6 text-lg font-semibold text-white/72 transition hover:border-white/24 hover:text-white"
                  >
                    <Search size={19} />
                    More watch options
                    <ChevronDown size={16} className={watchOptionsOpen ? "rotate-180 transition" : "transition"} />
                  </button>
                  {watchOptionsOpen && (
                    <div className="absolute left-0 top-[calc(100%+0.75rem)] z-30 w-[min(92vw,360px)] rounded-2xl border border-white/12 bg-[#111111]/96 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.72)] backdrop-blur-2xl">
                      <p className="px-2 pb-2 text-xs uppercase tracking-[0.2em] text-white/36">Watch options</p>
                      <div className="space-y-2">
                        {watchOptionLinks.length > 0 ? watchOptionLinks.map(({ provider, href }) => (
                          <a
                            key={`${provider.name}-${provider.access}-${href}`}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => captureEvent("watch-option-click", { title: pick.title, provider: provider.name, href })}
                            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3 transition hover:border-white/24 hover:bg-white/[0.075]"
                          >
                            <ProviderLogo provider={provider} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-white">{provider.name}</span>
                              <span className="block truncate text-xs text-white/46">{provider.note ?? provider.price ?? toTitleCase(provider.access)}</span>
                            </span>
                            <ExternalLink size={14} className="text-white/42" />
                          </a>
                        )) : (
                          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                            <p className="text-sm leading-5 text-white/54">No verified streaming links found for your region. Use the link below to check JustWatch.</p>
                          </div>
                        )}
                        <a
                          href={fallbackUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => captureEvent("watch-option-click", { title: pick.title, provider: "JustWatch", href: fallbackUrl })}
                          className="flex items-center justify-between rounded-xl border border-amber-300/20 bg-amber-400/[0.07] px-3 py-3 text-sm text-amber-100 transition hover:border-amber-200/38"
                        >
                          Check broader availability
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex h-16 min-w-[180px] items-center justify-center gap-3 rounded-xl border border-white/12 bg-white/[0.045] px-6 text-lg font-semibold text-white/72 transition hover:border-white/24 hover:text-white"
                >
                  <Share2 size={19} /> {shareState === "copied" ? "Copied" : "Share"}
                </button>
              </div>

              <p className="mt-4 flex items-center gap-2 text-sm text-white/54">
                <StateIcon size={16} className={stateCopy.tone} />
                <span className="font-medium text-white/66">{stateCopy.line}</span>
                <span className="text-white/34">·</span>
                <span>{stateCopy.detail}</span>
              </p>
            </div>

            <div className="grid gap-7 lg:grid-cols-[0.62fr_0.38fr] lg:items-center">
              <div className={`mx-auto grid h-36 w-36 place-items-center rounded-full border-4 bg-black/30 ${scoreClass(pick.confidence)}`}>
                <div className="text-center">
                  <p className="text-sm text-white/64">Mood match</p>
                  <p className="text-4xl font-semibold">{pick.confidence}%</p>
                  <p className="text-sm text-white/44">Great match</p>
                </div>
              </div>
              <div className="relative mx-auto h-[520px] w-full max-w-[330px] overflow-hidden rounded-2xl border border-white/14 bg-white/[0.05] shadow-[0_28px_100px_rgba(0,0,0,0.56),inset_0_1px_0_rgba(255,255,255,0.08)]">
                <MovieImage posterUrl={pick.omdbPosterUrl} title={pick.title} className="absolute inset-0 h-full w-full" objectPosition={artworkPosition} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/46 via-transparent to-transparent" />
                <Bookmark size={23} className="absolute right-5 top-5 text-white/72" />
              </div>
            </div>
          </section>
        )}

        {!noSubscriptionMatch && (
          <section className="rounded-2xl border border-white/10 bg-black/38 p-6">
            <div className="grid gap-7 lg:grid-cols-[1.05fr_1.05fr_0.7fr]">
              <article>
                <h2 className="mb-5 flex items-center gap-3 text-xl text-amber-100">
                  <Heart size={20} />
                  {avoidanceFallback ? "Why this safer pick fits" : whyItFitsLabel}
                </h2>
                <div className="space-y-4">
                  {pick.whyItFits.slice(0, 3).map((reason, index) => (
                    <div key={`${index}-${reason}`} className="flex gap-4">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/14 bg-white/[0.055] text-sm text-white/70">{index + 1}</span>
                      <p className="leading-6 text-white/72">{reason}</p>
                    </div>
                  ))}
                </div>
                {avoidanceFallback && (
                  <p className="mt-4 text-sm text-amber-100/50">F.U.N protected your avoidances and chose a safer close match instead of forcing a risky result.</p>
                )}
              </article>

              <article className="border-white/10 lg:border-l lg:pl-8">
                <h2 className="mb-2 text-xl text-white">Before watching</h2>
                <p className="mb-5 text-sm text-white/42">Only correct what you can already tell. Rate it after you watch.</p>
                <div className="flex flex-wrap gap-3">
                  {FEEDBACK_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const active = feedbackReason === option.reason;
                    return (
                      <button
                        key={option.reason}
                        type="button"
                        onClick={() => handleFeedback(option.reason)}
                        className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm transition ${
                          active ? "border-amber-300/50 bg-amber-400/14 text-amber-100" : "border-white/12 bg-white/[0.045] text-white/68 hover:border-white/24 hover:text-white"
                        }`}
                      >
                        <Icon size={17} /> {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-4 text-sm text-white/38">{feedbackReason ? "Saved. This improves your next pick." : "No account needed. Actual watch feedback can be added later in Memory."}</p>
              </article>

              <article className="rounded-xl border border-amber-300/18 bg-amber-400/[0.055] p-5">
                <h2 className="flex items-center gap-3 text-xl text-amber-100"><SlidersHorizontal size={20} /> Refine this mood</h2>
                <p className="mt-4 text-white/58">Tweak your preferences to get a sharper match.</p>
                <Link href="/" className="mt-7 inline-flex items-center gap-2 text-amber-100 hover:text-white">
                  Refine mood <ArrowRight size={17} />
                </Link>
              </article>
            </div>
          </section>
        )}

        {!noSubscriptionMatch && (
        <section className="mt-5 grid gap-5 lg:grid-cols-[0.75fr_1fr]">
          <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="mb-4 flex items-center gap-3 text-xl text-white">
              <StateIcon size={20} className={stateCopy.tone} />
              {verified ? "Available now" : "Check availability"}
            </h2>
            {providers.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[...subProviders, ...rentBuyProviders].slice(0, 4).map((provider, index) => (
                  <ProviderCard key={`${provider.name}-${provider.access}-${index}`} provider={provider} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/12 bg-white/[0.045] p-4">
                <p className="font-medium text-white">{pick.whereToWatch.primary}</p>
                <p className="mt-1 text-sm text-white/48">{pick.whereToWatch.note}</p>
                <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2 text-sm text-white/62 hover:text-white">
                  Check availability <ExternalLink size={14} />
                </a>
              </div>
            )}
            {exhaustedSubscriptionBatch && (
              <button type="button" onClick={handleSearchBeyondSubscriptions} disabled={rerolling} className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg border border-amber-300/28 bg-amber-400/[0.075] px-4 text-sm text-amber-100">
                Search beyond my subscriptions <ExternalLink size={14} />
              </button>
            )}
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/70"><Layers size={16} /> Related discoveries</p>
            <h2 className="mb-3 text-xl text-amber-100">{pick.hiddenLayer.headline}</h2>
            <p className="text-white/58">{pick.hiddenLayer.insight}</p>
            {hiddenTitles.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {hiddenTitles.slice(0, 3).map((title) => (
                  <a key={`${title.title}-${title.year}`} href={justWatchUrl(title.title, region)} target="_blank" rel="noopener noreferrer" className="relative h-40 overflow-hidden rounded-xl border border-amber-300/18 bg-amber-400/[0.05]">
                    <MovieImage posterUrl={title.posterUrl} title={title.title} className="absolute inset-0 h-full w-full opacity-82" objectPosition="top" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/16 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="line-clamp-2 text-sm font-medium text-white">{title.title}</p>
                      <p className="text-xs text-amber-200/72">{title.platform ?? title.year}</p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </article>
        </section>
        )}

        {!noSubscriptionMatch && similar.length > 0 && (
          <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div>
                <h2 className="text-xl text-amber-100">Similar vibe</h2>
                <p className="mt-2 text-white/52">More like this, if you want alternatives.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {similar.map((item, index) => (
                  <a key={`${item.title}-${index}`} href={justWatchUrl(item.title, region)} target="_blank" rel="noopener noreferrer" className="flex min-h-28 overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] transition hover:border-white/24">
                    <div className="relative w-20 shrink-0">
                      <MovieImage posterUrl={item.posterUrl} title={item.title} className="absolute inset-0 h-full w-full" objectPosition="top" />
                    </div>
                    <div className="min-w-0 p-4">
                      <p className="truncate text-white">{item.title}</p>
                      <p className="mt-1 text-sm text-white/42">{item.year}</p>
                      <p className="mt-3 inline-flex rounded-full border border-emerald-400/25 px-2 py-1 text-xs text-emerald-200">{Math.max(78, pick.confidence - 2 - index)}% match</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        <footer className="mt-7 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-white/44">
          <span>F.U.N gives one pick, verified where possible. We choose the best match for your mood so you can stop searching and start watching.</span>
          <span className="ml-6 gap-4 inline-flex">
            <Link href="/privacy" className="hover:text-white/70">Privacy</Link>
            <a href="mailto:feedback@findurnext.com" className="hover:text-white/70">Give feedback</a>
          </span>
        </footer>
      </section>
    </main>
  );
}
