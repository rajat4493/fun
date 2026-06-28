"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Bookmark,
  Calendar,
  ChevronRight,
  Clock3,
  ExternalLink,
  Film,
  Heart,
  Layers,
  Monitor,
  Play,
  RefreshCw,
  Sparkles,
  Star,
} from "lucide-react";
import {
  addSeenTitle,
  createRecommendationSession,
  defaultRecommendation,
  FeedbackReason,
  RecommendationSession,
  recommendationStorageKey,
  saveRecommendationFeedback,
  toTitleCase,
} from "@/lib/recommendation-session";
import { Recommendation, WatchProvider } from "@/lib/types";

const LOADING_KEY = "fun:loading";
const LOADING_STARTED_KEY = "fun:loading-started-at";
const ERROR_KEY = "fun:recommendation-error";
const LOADING_TIMEOUT_MS = 85000;

const SEARCH_TITLES = [
  "The Godfather", "Moonlight", "Her", "Past Lives", "Drive My Car",
  "Portrait of a Lady on Fire", "Parasite", "Lost in Translation",
  "Aftersun", "Carol", "All About Eve", "Mulholland Drive",
];

const FEEDBACK_OPTIONS: Array<{ reason: FeedbackReason; label: string }> = [
  { reason: "perfect", label: "Perfect" },
  { reason: "wrong-vibe", label: "Wrong vibe" },
  { reason: "not-on-service", label: "Not on my service" },
  { reason: "already-seen", label: "Already seen" },
];

function MovieImage({
  posterUrl,
  title,
  year,
  artworkPosition,
  className = "",
  objectPosition = "center",
}: {
  posterUrl?: string;
  title: string;
  year?: string;
  artworkPosition?: string;
  className?: string;
  objectPosition?: string;
}) {
  if (posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={posterUrl} alt={title} className={`object-cover ${className}`} style={{ objectPosition }} />;
  }
  // Clean gradient fallback — no sprite sheet
  void year; void artworkPosition;
  return <div className={`bg-gradient-to-br from-[#1a1625] via-[#12141c] to-[#0a0b10] ${className}`} />;
}

function ProviderCard({ provider }: { provider: WatchProvider }) {
  const isRent = provider.access === "rent";
  const isBuy = provider.access === "buy";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3">
      {provider.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={provider.logoUrl} alt={provider.name} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/40 text-lg font-black text-white">
          {provider.name.charAt(0)}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm text-white">{provider.name}</p>
        <p className={`text-xs ${isRent ? "text-red-300" : isBuy ? "text-teal-300" : "text-white/48"}`}>
          {provider.note ?? (isRent ? "Rent" : isBuy ? "Buy" : "Subscription")}
        </p>
      </div>
    </div>
  );
}

function InfoPill({ icon: Icon, label }: { icon: typeof Film; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-sm text-white/72">
      <Icon size={15} />
      {label}
    </span>
  );
}

const justWatchLocale: Record<string, string> = {
  "Poland": "pl", "United States": "us", "United Kingdom": "gb",
  "Germany": "de", "France": "fr", "Spain": "es", "Italy": "it",
  "Netherlands": "nl", "Sweden": "se", "Denmark": "dk", "Belgium": "be",
  "Austria": "at", "Ireland": "ie", "Portugal": "pt", "India": "in",
  "Canada": "ca", "Australia": "au", "Brazil": "br", "Mexico": "mx",
};

function justWatchUrl(title: string, country?: string): string {
  const locale = justWatchLocale[country ?? ""] ?? "us";
  return `https://www.justwatch.com/${locale}/search?q=${encodeURIComponent(title)}`;
}

function titleFontSize(title: string): string {
  const longestWord = Math.max(...title.split(/\s+/).map((w) => w.length));
  const totalLen = title.length;
  // A single long word (e.g. "Chhichhore", "Interstellar") can't wrap — shrink proactively
  if (longestWord > 10) return "clamp(2.4rem,4.8vw,5.2rem)";
  // Long multi-word titles (e.g. "Portrait of a Lady on Fire") wrap but need tighter tracking
  if (longestWord > 9 || totalLen > 18) return "clamp(3rem,6vw,6.4rem)";
  // Default — the cinematic size that works for most titles
  return "clamp(4rem,8vw,8.4rem)";
}

function loadSession(): RecommendationSession | null {
  try {
    const raw = localStorage.getItem(recommendationStorageKey);
    if (!raw) return null;
    return JSON.parse(raw) as RecommendationSession;
  } catch {
    return null;
  }
}

export default function RecommendationPage() {
  const [session, setSession] = useState<RecommendationSession | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchIdx, setSearchIdx] = useState(0);
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | null>(null);

  useEffect(() => {
    if (!fetchLoading) return;
    const t = setInterval(() => setSearchIdx((i) => (i + 1) % SEARCH_TITLES.length), 1500);
    return () => clearInterval(t);
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
          const err = localStorage.getItem(ERROR_KEY);
          if (err) {
            localStorage.removeItem(ERROR_KEY);
            setFetchError(err);
            setFetchLoading(false);
            setReady(true);
            return;
          }
          const s = loadSession();
          if (s) {
            setSession(s);
            setBatchIndex(s.batchIndex ?? 0);
          } else {
            setNoSession(true);
          }
          setFetchLoading(false);
          setReady(true);
        }
      }, 400);
      return () => clearInterval(interval);
    }

    const s = loadSession();
    if (!s) setNoSession(true);
    else {
      setSession(s);
      setBatchIndex(s.batchIndex ?? 0);
    }
    setReady(true);
  }, []);

  async function handleSeenIt() {
    if (!session || !session.batch) return;
    setRerolling(true);
    try {
      const seen = addSeenTitle(session.recommendation.title);
      const batch = session.batch;
      const nextIndex = batchIndex + 1;

      if (nextIndex < batch.length) {
        const nextPick = batch[nextIndex];
        const updatedSession = { ...session, recommendation: nextPick, batchIndex: nextIndex };
        localStorage.setItem(recommendationStorageKey, JSON.stringify(updatedSession));
        setSession(updatedSession);
        setBatchIndex(nextIndex);
        setFeedbackReason(null);
      } else {
        const request = { ...session.request, seenTitles: seen };
        const response = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) throw new Error("failed");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await response.json() as any;
        const newBatch: Recommendation[] = data._batch ?? [data];
        const newSession = createRecommendationSession(newBatch[0], request, newBatch);
        localStorage.setItem(recommendationStorageKey, JSON.stringify(newSession));
        setSession(newSession);
        setBatchIndex(0);
        setFeedbackReason(null);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setFetchError("Could not find another pick. Please try a new mood.");
    } finally {
      setRerolling(false);
    }
  }

  function handleFeedback(reason: FeedbackReason) {
    if (!session) return;
    saveRecommendationFeedback(reason, session);
    setFeedbackReason(reason);
  }

  async function handleSearchBeyondSubscriptions() {
    if (!session) return;
    setRerolling(true);
    try {
      const request = { ...session.request, platformFilter: "any" as const };
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error("failed");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as any;
      const newBatch: Recommendation[] = data._batch ?? [data];
      const newSession = createRecommendationSession(newBatch[0], request, newBatch);
      localStorage.setItem(recommendationStorageKey, JSON.stringify(newSession));
      setSession(newSession);
      setBatchIndex(0);
      setFeedbackReason(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setFetchError("Could not search beyond your subscriptions. Try again.");
    } finally {
      setRerolling(false);
    }
  }

  const pick: Recommendation = session?.recommendation ?? defaultRecommendation;
  const batch = session?.batch ?? [pick];
  const availabilitySearchUrl = justWatchUrl(pick.title, session?.request?.country);
  const primaryVibe = toTitleCase(pick.vibe.split(",")[0] || pick.format);
  const hiddenTitles = pick.hiddenLayer.titles ?? [];
  const notOnUserPlatforms = pick.whereToWatch.notOnUserPlatforms ?? false;
  const providers = pick.whereToWatch.providers ?? [];
  const subProviders = providers.filter((p) => p.access === "subscription");
  const rentBuyProviders = providers.filter((p) => p.access === "rent" || p.access === "buy");
  const verified = pick.whereToWatch.status === "verified";
  const subscriptionOnly = session?.request?.platformFilter === "mine";
  const exhaustedSubscriptionBatch = subscriptionOnly && batch.length > 0 && batchIndex >= batch.length - 1;

  const isSeries = pick.format === "Series" || pick.format === "Episode";
  const isDoc = pick.format === "Documentary";

  const artworkPosition = useMemo(() => {
    const seed = `${pick.title}-${pick.year || ""}`.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    const slot = seed % 8;
    const col = slot % 4;
    const row = Math.floor(slot / 4);
    const x = col === 0 ? 0 : col === 3 ? 100 : col * 33.333;
    const y = row === 0 ? 0 : 100;
    return `${x}% ${y}%`;
  }, [pick.title, pick.year]);

  // ── Loading screen ────────────────────────────────────────────────────────
  if (fetchLoading) {
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#030303] text-white">
        {/* Background */}
        <div className="absolute inset-0 bg-cover bg-center opacity-18" style={{ backgroundImage: "url('/fun/hero-cinematic.png')" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-[#030303]" />

        {/* Film strip at top edge */}
        <div className="absolute top-0 left-0 right-0 flex h-8 items-center gap-1.5 overflow-hidden px-3 opacity-20">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="h-5 w-7 shrink-0 rounded-sm border border-white/30 bg-white/10" />
          ))}
        </div>

        {/* Center content */}
        <div className="relative z-10 text-center">
          <div className="mb-10 text-5xl font-medium tracking-[0.34em]">
            F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
          </div>

          <div className="flex items-center justify-center gap-3 text-lg text-white/80">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.85)]" />
            Finding your perfect pick…
          </div>

          <p className="mt-3 h-5 text-sm text-white/36">
            Searching{" "}
            <span key={searchIdx} className="text-white/60 transition-opacity duration-700">
              {SEARCH_TITLES[searchIdx]}
            </span>
            …
          </p>

          {/* Mini film strip */}
          <div className="mx-auto mt-12 flex w-fit gap-1.5 opacity-25">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-8 shrink-0 animate-pulse rounded bg-white/15"
                style={{ animationDelay: `${i * 0.15}s`, animationDuration: "2s" }}
              />
            ))}
          </div>
        </div>

        {/* Film strip at bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 flex h-8 items-center gap-1.5 overflow-hidden px-3 opacity-20">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="h-5 w-7 shrink-0 rounded-sm border border-white/30 bg-white/10" />
          ))}
        </div>
      </main>
    );
  }

  if (!ready) return null;

  // ── Error screen ──────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#030303] text-white">
        <div className="text-center">
          <div className="mb-4 text-5xl font-medium tracking-[0.34em]">F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N</div>
          <h1 className="font-serif text-3xl text-white/80">Something went wrong</h1>
          <p className="mt-3 text-base text-white/46">{fetchError}</p>
          <Link href="/" className="mt-8 inline-flex items-center gap-3 rounded-xl bg-gradient-to-b from-red-500 to-red-900 px-6 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(127,29,29,0.45)] transition hover:brightness-110">
            <Star size={18} /> Try again
          </Link>
        </div>
      </main>
    );
  }

  // ── No session screen ─────────────────────────────────────────────────────
  if (noSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#030303] text-white">
        <div className="text-center">
          <div className="mb-4 text-5xl font-medium tracking-[0.34em]">F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N</div>
          <h1 className="font-serif text-3xl text-white/80">No recommendation yet</h1>
          <p className="mt-3 text-base text-white/46">Pick your mood first and we'll find your one perfect match.</p>
          <Link href="/" className="mt-8 inline-flex items-center gap-3 rounded-xl bg-gradient-to-b from-red-500 to-red-900 px-6 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(127,29,29,0.45)] transition hover:brightness-110">
            <Star size={18} /> Pick your mood
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#030303] text-white">
      {pick.omdbPosterUrl ? (
        <div className="fixed inset-0 scale-110 bg-cover bg-center opacity-20 blur-2xl" style={{ backgroundImage: `url('${pick.omdbPosterUrl}')` }} />
      ) : (
        <div className="fixed inset-0 bg-gradient-to-br from-[#1a1625] via-[#12141c] to-[#0a0b10] opacity-80" />
      )}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_74%_24%,rgba(239,68,68,0.2),transparent_25%),linear-gradient(90deg,#030303_0%,rgba(3,3,3,0.78)_44%,rgba(3,3,3,0.9)_100%)]" />
      <div className="fixed inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#030303] to-transparent" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-[1760px] flex-col px-5 pb-8 pt-4 sm:px-8 lg:px-12">
        <header className="flex h-12 items-center justify-between border-b border-white/[0.07]">
          <Link href="/" className="flex items-center gap-4 text-white">
            <span className="text-3xl font-medium tracking-[0.34em]">F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N</span>
          </Link>
          <Link href="/" className="inline-flex h-9 items-center gap-2 rounded-full border border-white/14 bg-white/[0.06] px-4 text-sm text-white/78 transition hover:border-white/28 hover:text-white">
            <ArrowLeft size={16} /> New mood
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-red-300/25 bg-red-500/12 px-3 py-1.5 text-sm text-red-100">
              <Star size={15} className="text-red-300" />
              Your one pick for tonight {batch.length > 1 && `(${batchIndex + 1} of ${batch.length})`}
            </div>

            {/* Format badge — Film / TV Series / Documentary */}
            <div className="mb-4">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${
                isSeries
                  ? "border-blue-400/30 bg-blue-500/12 text-blue-200"
                  : isDoc
                  ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-200"
                  : "border-white/14 bg-white/[0.07] text-white/72"
              }`}>
                {isSeries ? <Monitor size={13} /> : <Film size={13} />}
                {isSeries ? "TV Series" : isDoc ? "Documentary" : "Film"}
              </span>
            </div>

            <h1
              className="font-serif font-normal uppercase leading-[0.86] tracking-normal text-white"
              style={{ fontSize: titleFontSize(pick.title) }}
            >
              {pick.title}
            </h1>

            <p className="mt-6 max-w-2xl text-2xl leading-8 text-white/78">{pick.oneLine}</p>

            <div className="mt-7 flex flex-wrap gap-3">
              <InfoPill icon={Calendar} label={pick.year} />
              <InfoPill icon={Clock3} label={pick.runtime} />
              <InfoPill icon={Heart} label={primaryVibe} />
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={availabilitySearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-3 rounded-lg bg-gradient-to-b from-red-500 to-red-900 px-6 font-semibold text-white shadow-[0_14px_40px_rgba(127,29,29,0.45)] transition hover:brightness-110"
              >
                <Play size={18} fill="currentColor" /> Watch now
              </a>
              <button
                type="button"
                onClick={handleSeenIt}
                disabled={rerolling}
                className="inline-flex h-12 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-6 font-semibold text-white/60 transition hover:border-white/22 hover:text-white/88 disabled:cursor-wait disabled:opacity-50"
              >
                <RefreshCw size={18} className={rerolling ? "animate-spin" : ""} />
                {rerolling ? "Finding another…" : "Seen it"}
              </button>
              {exhaustedSubscriptionBatch && (
                <button
                  type="button"
                  onClick={handleSearchBeyondSubscriptions}
                  disabled={rerolling}
                  className="inline-flex h-12 items-center gap-3 rounded-lg border border-amber-300/25 bg-amber-400/[0.08] px-6 font-semibold text-amber-100 transition hover:border-amber-300/45 hover:bg-amber-400/[0.13] disabled:cursor-wait disabled:opacity-50"
                >
                  <ExternalLink size={17} />
                  Search beyond my subscriptions
                </button>
              )}
            </div>

            <div className="mt-5 max-w-2xl rounded-2xl border border-white/10 bg-black/28 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm text-white/46">How was this pick?</span>
                {FEEDBACK_OPTIONS.map((option) => {
                  const active = feedbackReason === option.reason;
                  return (
                    <button
                      key={option.reason}
                      type="button"
                      onClick={() => handleFeedback(option.reason)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        active
                          ? "border-red-300/40 bg-red-500/18 text-red-100"
                          : "border-white/10 bg-white/[0.04] text-white/58 hover:border-white/22 hover:text-white/84"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-white/30">
                {feedbackReason ? "Saved. This helps tune your taste profile and spot app-wide misses." : "Your feedback stays local for this MVP."}
              </p>
            </div>
          </div>

          <div className="relative min-h-[520px]">
            <div className="absolute -inset-6 rounded-[2rem] bg-red-500/10 blur-3xl" />
            <div className="relative h-full min-h-[520px] overflow-hidden rounded-2xl border border-white/14 bg-white/[0.055] shadow-[0_28px_100px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.08)]">
              <MovieImage
                posterUrl={pick.omdbPosterUrl}
                title={pick.title}
                year={pick.year}
                artworkPosition={artworkPosition}
                className="absolute inset-0 h-full w-full"
                objectPosition="top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/12 to-transparent" />
              <div className="absolute left-5 top-5 rounded-full border border-white/14 bg-black/42 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/72">
                {pick.omdbPosterUrl ? "Poster" : "Mood artwork"}
              </div>
              <Bookmark size={24} className="absolute right-5 top-5 text-white/70" />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <span className="rounded-full border border-white/14 bg-black/44 px-3 py-1.5 text-sm text-white/76">
                  {pick.confidence}% match
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 border-t border-white/[0.08] pt-7 lg:grid-cols-[1fr_0.85fr_1fr]">
          {/* Why it fits */}
          <article id="why" className="rounded-2xl border border-white/10 bg-black/38 p-5">
            <h2 className="flex items-center gap-3 text-xl text-white">
              <Sparkles size={20} className="text-red-300" /> Why it fits tonight
            </h2>
            <div className="mt-5 space-y-4">
              {pick.whyItFits.slice(0, 3).map((reason, index) => (
                <div key={`${index}-${reason.slice(0, 20)}`} className="flex gap-4">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.07] text-sm text-white/74">
                    {index + 1}
                  </div>
                  <p className="text-base leading-6 text-white/72">{reason}</p>
                </div>
              ))}
            </div>
          </article>

          {/* Where to watch */}
          <article id="watch" className="rounded-2xl border border-white/10 bg-black/38 p-5">
            <h2 className="flex items-center gap-3 text-xl text-white">
              <BadgeCheck size={20} className={verified ? "text-emerald-300" : "text-white/40"} />
              Where to watch
            </h2>

            {verified && (
              <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                notOnUserPlatforms
                  ? "border-amber-400/30 bg-amber-500/12 text-amber-100"
                  : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
              }`}>
                {notOnUserPlatforms ? "Not on your current apps — but available here:" : "✓ Available on your apps"}
              </div>
            )}

            {providers.length > 0 ? (
              <div className="mt-4 space-y-3">
                {subProviders.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {subProviders.slice(0, 3).map((p, index) => (
                      <ProviderCard key={`${p.name}-${p.access}-${p.logoUrl ?? "no-logo"}-${index}`} provider={p} />
                    ))}
                  </div>
                )}
                {rentBuyProviders.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wider text-white/36">Rent or buy</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                      {rentBuyProviders.slice(0, 2).map((p, index) => (
                        <ProviderCard key={`${p.name}-${p.access}-${p.logoUrl ?? "no-logo"}-${index}`} provider={p} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-white/14 bg-white/[0.05] p-4">
                <div>
                  <p className="font-medium text-white">{pick.whereToWatch.primary || "Availability not verified yet"}</p>
                  <p className="mt-0.5 text-sm text-white/46">
                    {pick.whereToWatch.note || `Not verified for ${session?.request?.country ?? "your region"} yet.`}
                  </p>
                </div>
                <a
                  href={availabilitySearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2 text-sm text-white/62 transition hover:border-white/24 hover:text-white"
                >
                  Check availability <ExternalLink size={14} />
                </a>
              </div>
            )}

            <a
              href={availabilitySearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-xs text-white/36 hover:text-white/60"
            >
              <ExternalLink size={12} /> More availability options
            </a>
          </article>

          {/* Hidden Layer */}
          <article className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.05] p-5 shadow-[0_0_40px_rgba(251,191,36,0.06)]">
            <div className="mb-2 text-xs uppercase tracking-widest text-amber-300/50">Films your taste actually craves</div>
            <h2 className="flex items-start gap-3 text-lg font-medium leading-snug text-white">
              <Layers size={18} className="mt-0.5 shrink-0 text-amber-300" /> {pick.hiddenLayer.headline}
            </h2>
            <p className="mt-3 text-sm leading-5 text-white/60">{pick.hiddenLayer.insight}</p>
            {hiddenTitles.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {hiddenTitles.slice(0, 3).map((ht) => (
                  <a
                    key={`${ht.title}-${ht.year}`}
                    href={justWatchUrl(ht.title, session?.request?.country)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative h-[140px] overflow-hidden rounded-xl border border-amber-400/20 transition hover:border-amber-400/40"
                  >
                    <MovieImage posterUrl={ht.posterUrl} title={ht.title} year={ht.year} className="absolute inset-0 h-full w-full" objectPosition="top" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-2">
                      <p className="line-clamp-2 text-xs font-medium leading-tight text-white">{ht.title}</p>
                      {ht.platform && <p className="mt-0.5 truncate text-xs text-amber-300/80">{ht.platform}</p>}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-amber-400/15 bg-black/28 p-4 text-sm leading-5 text-amber-200/60">
                {pick.hiddenLayer.classyJab}
              </p>
            )}
          </article>
        </section>

        {/* Alternatives */}
        {pick.alternatives.length > 0 && (
          <section className="pt-6">
            <h2 className="mb-3 text-xl text-white">If you want a nearby mood</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {pick.alternatives.slice(0, 3).map((alternative, i) => {
                const [titlePart] = alternative.split(" (");
                const yearMatch = alternative.match(/\((\d{4})\)/);
                const year = yearMatch?.[1] ?? "";
                const posterUrl = pick.alternativePosterUrls?.[i];
                return (
                  <a
                    key={`${alternative}-${i}`}
                    href={justWatchUrl(titlePart, session?.request?.country)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.05] transition hover:border-white/22 hover:bg-white/[0.08]"
                  >
                    {posterUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={posterUrl} alt={titlePart} className="absolute inset-0 h-full w-full object-cover opacity-28" />
                    )}
                    <div className="relative flex items-center justify-between p-4 text-white/72">
                      <div>
                        <p className="text-white">{titlePart}</p>
                        {year && <p className="text-sm text-white/46">{year}</p>}
                      </div>
                      <ExternalLink size={16} className="text-white/36" />
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4 text-sm text-white/42">
          <span>One pick, verified where possible, no accounts.</span>
          <Link href="/" className="inline-flex items-center gap-2 text-white/68 hover:text-white">
            Refine mood <ChevronRight size={16} />
          </Link>
        </footer>
      </section>
    </main>
  );
}
