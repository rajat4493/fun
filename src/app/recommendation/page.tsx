"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.js";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right.js";
import BadgeCheck from "lucide-react/dist/esm/icons/badge-check.js";
import Bookmark from "lucide-react/dist/esm/icons/bookmark.js";
import Calendar from "lucide-react/dist/esm/icons/calendar.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";
import Film from "lucide-react/dist/esm/icons/film.js";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.js";
import Heart from "lucide-react/dist/esm/icons/heart.js";
import Layers from "lucide-react/dist/esm/icons/layers.js";
import Monitor from "lucide-react/dist/esm/icons/monitor.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Share2 from "lucide-react/dist/esm/icons/share-2.js";
import Shield from "lucide-react/dist/esm/icons/shield.js";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.js";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.js";
import Star from "lucide-react/dist/esm/icons/star.js";
import Zap from "lucide-react/dist/esm/icons/zap.js";
import {
  addSeenTitle,
  createRecommendationRunId,
  createRecommendationSession,
  defaultRecommendation,
  FeedbackReason,
  getOrCreateSessionId,
  loadCompactRecommendationMemoryTitles,
  loadExactRecommendationExclusions,
  loadRecommendationFeedbackContext,
  RecommendationSession,
  recommendationStorageKey,
  rememberRecommendationHistory,
  rememberRecommendationTitles,
  saveRecommendationFeedback,
  toTitleCase,
} from "@/lib/recommendation-session";
import { captureRecommendationRun } from "@/lib/recommendation-analytics";
import { applyAffiliateTag } from "@/lib/affiliate-links";
import { IntentContract, Recommendation, RecommendationDisplayState, WatchProvider } from "@/lib/types";

const LOADING_KEY = "fun:loading";
const LOADING_STARTED_KEY = "fun:loading-started-at";
const ERROR_KEY = "fun:recommendation-error";
const LOADING_TIMEOUT_MS = 85000;

const LOADING_STAGE_KEY = "fun:loading-stage";

// Real pipeline checkpoints (see route.ts's emitStage) — not a decorative rotation. Falls back to
// the first stage if the key isn't set yet (the brief window before the first line arrives).
const LOADING_STAGE_COPY: Record<string, string> = {
  understanding: "Understanding your mood",
  "checking-fit": "Checking fit",
  verifying: "Verifying watch options",
};
const DEFAULT_LOADING_STAGE = "understanding";

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
    return { label: `Watch on ${provider.name}`, href: applyAffiliateTag(provider.name, provider.url), verified: true };
  }
  const searchUrl = providerSearchUrl(provider, pick.title);
  if (searchUrl && (provider.access === "subscription" || provider.access === "included")) {
    return { label: `Open ${provider.name}`, href: applyAffiliateTag(provider.name, searchUrl), verified: true };
  }
  return { label: "Find where to watch", href: fallbackUrl, verified: false };
}

function MovieImage({ posterUrl, title, className = "", objectPosition = "center" }: { posterUrl?: string; title: string; className?: string; objectPosition?: string }) {
  // Tracks load failures separately from "no poster URL at all" — a valid TMDB/OMDB URL that
  // fails to load client-side (transient network blip, CDN hiccup, blocked request) previously
  // rendered as a broken <img> with zero intrinsic width/height instead of falling back to the
  // gradient placeholder that already covers the "no poster available" case.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [posterUrl]);

  if (posterUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={posterUrl} alt={title} className={`object-cover ${className}`} style={{ objectPosition }} onError={() => setFailed(true)} />;
  }
  return <div className={`bg-gradient-to-br from-[#1a1625] via-[#12141c] to-[#0a0b10] ${className}`} />;
}

function ProviderLogo({ provider }: { provider: WatchProvider }) {
  // Same load-failure gap as MovieImage — TMDB-hosted provider logos can fail to load
  // transiently, leaving a broken 0x0 <img> instead of falling back to the letter badge.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [provider.logoUrl]);

  if (provider.logoUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={provider.logoUrl} alt={provider.name} className="h-10 w-10 rounded-lg object-contain" onError={() => setFailed(true)} />;
  }
  return <span className="grid h-10 w-10 place-items-center rounded-lg bg-black/55 text-lg font-black text-white">{provider.name.charAt(0)}</span>;
}

function ProviderCard({ provider }: { provider: WatchProvider }) {
  const detail = provider.note ?? provider.price ?? (provider.access === "rent" ? "Rent" : provider.access === "buy" ? "Buy" : "Included");
  const href = provider.url && provider.urlKind === "title" ? applyAffiliateTag(provider.name, provider.url) : undefined;
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

function relatedTitleKey(value: string) {
  return value.toLowerCase().replace(/\b(19|20)\d{2}\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function isDisplayableRelatedTitle(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) &&
    normalized !== "title" &&
    normalized !== "untitled" &&
    !/^title\s*\d*$/i.test(normalized) &&
    !/^placeholder/i.test(normalized);
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
  const [unlockEmail, setUnlockEmail] = useState("");
  const [unlockSubmitting, setUnlockSubmitting] = useState(false);
  const [unlockDone, setUnlockDone] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | null>(null);
  const [loadingStage, setLoadingStage] = useState(DEFAULT_LOADING_STAGE);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [watchOptionsOpen, setWatchOptionsOpen] = useState(false);
  const [showMorePicks, setShowMorePicks] = useState(false);
  // Hidden/similar-title posters are deliberately not fetched as part of the primary response —
  // that section is collapsed by default, so fetching their posters up front would be work the
  // user may never see. Fetched lazily here, once, only when the section is actually opened.
  const [relatedPosters, setRelatedPosters] = useState<Record<string, string>>({});
  const relatedPostersFetchedForRef = useRef<string | null>(null);
  // Two-phase fetch: tracks the in-flight background "fill" call (picks 2–3) so handleSeenIt can
  // await it directly instead of polling. null once no fill is pending for the current session.
  const fillPromiseRef = useRef<Promise<void> | null>(null);
  const fillStartedForRunIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const isLoading = localStorage.getItem(LOADING_KEY) === "true";
    if (isLoading) {
      setFetchLoading(true);
      setLoadingStage(localStorage.getItem(LOADING_STAGE_KEY) || DEFAULT_LOADING_STAGE);
      const interval = setInterval(() => {
        // Real pipeline progress, written by page.tsx as it reads the NDJSON stream — not a timer.
        const stage = localStorage.getItem(LOADING_STAGE_KEY);
        if (stage) setLoadingStage(stage);
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
    if (loaded) {
      setSession(loaded);
      setBatchIndex(loaded.batchIndex ?? 0);
    } else {
      // A refresh, re-navigation, or return visit after a failed request (rate limit, geo-scope,
      // etc.) landed here with `fun:loading` already cleared — the polling branch above only ever
      // catches this in the exact split-second window of the original failed request. Check for a
      // stored error here too, so e.g. the rate-limit unlock form stays reachable on a reload
      // instead of silently disappearing into a bare "no recommendation yet" screen.
      const error = localStorage.getItem(ERROR_KEY);
      if (error) {
        localStorage.removeItem(ERROR_KEY);
        setFetchError(error);
      } else {
        setNoSession(true);
      }
    }
    setReady(true);
  }, []);

  // Two-phase fetch: pick 1 already rendered — either from page.tsx's initial recommendationCount: 1
  // request, or from replaceWithBatch below (reroll / "Already seen" exhaustion / search beyond
  // subscriptions all request just 1 pick too). Fetch picks 2–3 in the background so they're ready
  // by the time the user rerolls again, without ever blocking on a full 3-pick generation.
  async function runBackgroundFill(current: RecommendationSession) {
    // Distinct from current.runId — this is a genuinely separate LLM call producing "Similar
    // picks" tray entries, never the hero recommendation. Without its own tagged runId this
    // call's results were previously invisible in /api/recommendation-runs entirely, making it
    // impossible to tell a fill-call title apart from the hero pick after the fact.
    const fillRunId = `${current.runId}-fill`;
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          ...current.request,
          recommendationCount: 2,
          responseDetail: "core",
          precomputedIntentContract: current.intentContract,
          // Explicit, not just omitted — current.request is the original ask's request object
          // (stream: true), and this handler's plain response.json() below can't parse an NDJSON
          // stream. Same bug/fix as replaceWithBatch above; this flow was deliberately kept
          // non-streaming (see Tier 2's scope). Was previously silently swallowed by the catch
          // below (batch just never filled) rather than visibly crashing like the reroll path did.
          stream: false,
          recentTitles: [current.recommendation.title, ...(current.request.recentTitles ?? [])].slice(0, 8),
          excludedTitles: [
            current.recommendation.title,
            ...loadExactRecommendationExclusions(),
          ].slice(0, 200),
          sessionId: getOrCreateSessionId(),
          runId: fillRunId,
        }),
      });
      if (!response.ok) throw new Error("fill failed");
      const data = await response.json() as Recommendation & { _batch?: Recommendation[] };
      const fillPicks = data._batch ?? [data];

      const existingKeys = new Set((current.batch ?? [current.recommendation]).map((item) => relatedTitleKey(item.title)));
      const newPicks = fillPicks.filter((pick) => !existingKeys.has(relatedTitleKey(pick.title)));

      // Re-read from localStorage in case the user has already advanced batchIndex/feedback state
      // while the fill was in flight — merge onto the freshest session, not a stale closure.
      const latest = loadSession() ?? current;
      const mergedBatch = [...(latest.batch ?? [latest.recommendation]), ...newPicks];
      const next: RecommendationSession = { ...latest, batch: mergedBatch, batchComplete: true };
      localStorage.setItem(recommendationStorageKey, JSON.stringify(next));
      setSession(next);
      if (fillPicks[0]) {
        captureRecommendationRun({
          runId: fillRunId,
          source: "background-fill",
          request: current.request,
          recommendation: fillPicks[0],
          batch: fillPicks,
        });
      }
    } catch {
      // Fill failed — mark complete anyway so handleSeenIt doesn't wait forever. It will fall
      // through to the existing full replaceWithBatch regeneration once the batch is exhausted,
      // which is exactly today's pre-two-phase-fetch behavior.
      const latest = loadSession() ?? current;
      const next: RecommendationSession = { ...latest, batchComplete: true };
      localStorage.setItem(recommendationStorageKey, JSON.stringify(next));
      setSession(next);
    }
  }

  useEffect(() => {
    if (!session || session.batchComplete !== false) return;
    if (fillStartedForRunIdRef.current === session.runId) return;
    fillStartedForRunIdRef.current = session.runId;
    fillPromiseRef.current = runBackgroundFill(session).finally(() => {
      fillPromiseRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.runId, session?.batchComplete]);

  async function replaceWithBatch(request: RecommendationSession["request"]) {
    // Generated before the request (not after the response) so the server's own log line for
    // this call and the client's later /api/recommendation-runs report share one ID.
    const runId = createRecommendationRunId();
    // Two-phase fetch applies here too, not just the very first load: fetch pick 1 alone so it
    // renders fast, then let the same background-fill effect (below) top the batch up to 3 while
    // the user is already looking at something. Explicitly set to 1 (not just spread from the
    // caller) since a stale recommendationCount: 2 could otherwise leak in from a fill request.
    // stream: false is explicit, not just omitted — `request` is often the original ask's request
    // object (which has stream: true, see page.tsx), and spreading it forward without overriding
    // would make the server respond with an NDJSON stream that this function's plain
    // `response.json()` below can't parse, crashing with a raw JSON.parse error. This flow was
    // deliberately kept on the non-streaming path (see Tier 2's scope), so state that explicitly.
    const firstPickRequest: RecommendationSession["request"] = {
      ...request,
      recommendationCount: 1,
      responseDetail: "core",
      precomputedIntentContract: undefined,
      stream: false,
      runId,
    };
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(firstPickRequest),
    });
    if (!response.ok) {
      // Surface the server's actual error message (rate limit, geo-scope preview block, etc.)
      // instead of a generic string — see page.tsx's initial-fetch handler for the same fix.
      let message = "Could not find another pick. Please try a new mood.";
      try {
        const errorBody = await response.json() as { error?: string };
        if (errorBody?.error) message = errorBody.error;
      } catch {
        // response wasn't JSON — keep the generic message
      }
      throw new Error(message);
    }
    const data = await response.json() as Recommendation & {
      _batch?: Recommendation[];
      _trust?: { displayState?: RecommendationDisplayState; batchComplete?: boolean; intentContract?: IntentContract };
    };
    const batch = data._batch ?? [data];
    rememberRecommendationTitles(batch.map((item) => item.title));
    rememberRecommendationHistory(batch, firstPickRequest, runId);
    const next = createRecommendationSession(
      batch[0],
      firstPickRequest,
      batch,
      data._trust?.displayState,
      runId,
      data._trust?.batchComplete,
      data._trust?.intentContract,
    );
    localStorage.setItem(recommendationStorageKey, JSON.stringify(next));
    setSession(next);
    setBatchIndex(0);
    setFeedbackReason(null);
    setShowMorePicks(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    captureEvent("recommendation", {
      runId,
      title: batch[0].title,
      year: batch[0].year,
      confidence: batch[0].confidence,
      parsedIntent: batch[0].parsedIntent,
      source: "reroll",
      availabilityStatus: batch[0].whereToWatch.status,
      displayState: data._trust?.displayState,
    });
    captureRecommendationRun({
      runId,
      source: firstPickRequest.platformFilter === "any" ? "search-all-cinema" : "reroll",
      request: firstPickRequest,
      recommendation: batch[0],
      batch,
      displayState: data._trust?.displayState,
    });
  }

  async function handleSeenIt() {
    if (!session) return;
    setRerolling(true);
    try {
      const seen = addSeenTitle(session.recommendation.title);
      let activeSession = session;
      let batch = activeSession.batch ?? [activeSession.recommendation];
      let nextIndex = batchIndex + 1;

      // Two-phase fetch: if the batch looks exhausted but a background fill is still in flight,
      // wait for it — it usually finishes well before the user reads the current pick and clicks
      // through. Falls straight through (no wait) once batchComplete is true.
      if (nextIndex >= batch.length && activeSession.batchComplete === false && fillPromiseRef.current) {
        await fillPromiseRef.current;
        activeSession = loadSession() ?? activeSession;
        batch = activeSession.batch ?? [activeSession.recommendation];
      }

      if (nextIndex < batch.length) {
        const next = { ...activeSession, recommendation: batch[nextIndex], batchIndex: nextIndex };
        localStorage.setItem(recommendationStorageKey, JSON.stringify(next));
        setSession(next);
        setBatchIndex(nextIndex);
        setFeedbackReason(null);
      } else {
        await replaceWithBatch({
          ...activeSession.request,
          seenTitles: seen,
          recentTitles: [...batch.map((item) => item.title), ...loadCompactRecommendationMemoryTitles()].slice(0, 8),
          excludedTitles: [
            ...batch.map((item) => item.title),
            ...loadExactRecommendationExclusions(),
          ].slice(0, 200),
          sessionId: getOrCreateSessionId(),
          feedbackContext: loadRecommendationFeedbackContext(),
        });
      }
    } catch (error) {
      // The fetch above always throws either the server's real error message or an already-tailored
      // fallback, so just surface it directly rather than special-casing one prefix.
      setFetchError(error instanceof Error ? error.message : "Could not find another pick. Please try a new mood.");
    } finally {
      setRerolling(false);
    }
  }

  async function handleUnlockSubmit() {
    if (!unlockEmail.trim()) return;
    setUnlockSubmitting(true);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: unlockEmail.trim() }),
      });
      if (res.ok) setUnlockDone(true);
    } finally {
      setUnlockSubmitting(false);
    }
  }

  function handleFeedback(reason: FeedbackReason) {
    if (!session) return;
    if (reason === "already-seen") addSeenTitle(session.recommendation.title);
    saveRecommendationFeedback(reason, session, "pre-watch");
    setFeedbackReason(reason);
    const request = session.request;
    const payload = {
      runId: session.runId,
      phase: "pre-watch",
      reason,
      title: session.recommendation.title,
      year: session.recommendation.year,
      format: session.recommendation.format,
      confidence: session.recommendation.confidence,
      parsedIntent: session.recommendation.parsedIntent,
      country: request.country,
      mood: request.mood,
      wants: request.wants,
      avoids: request.avoids,
      languagePreferences: request.languagePreferences,
      craziness: request.craziness,
      platformFilter: request.platformFilter,
      energy: request.energy,
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
          ...(session.batch ?? [session.recommendation]).map((item) => item.title),
          ...loadCompactRecommendationMemoryTitles(),
        ].slice(0, 8),
        excludedTitles: [
          ...(session.batch ?? [session.recommendation]).map((item) => item.title),
          ...loadExactRecommendationExclusions(),
        ].slice(0, 200),
        sessionId: getOrCreateSessionId(),
        feedbackContext: loadRecommendationFeedbackContext(),
      });
    } catch (error) {
      // See handleReroll's catch above — the fetch always throws a real, already-useful message.
      setFetchError(error instanceof Error ? error.message : "Could not search beyond your subscriptions. Try again.");
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
    : pick.confidence >= 70
    ? {
        eyebrow: "Your one pick",
        line: "Strong fit, not fully confirmed",
        detail: "This matches your mood well — we just couldn't confirm it's on your exact service. Use watch options to check.",
        icon: Search,
        tone: "text-white/52",
      }
    : {
        eyebrow: "Your one pick",
        line: "Our best honest guess",
        detail: "Fit and availability both need a quick check before you commit.",
        icon: Search,
        tone: "text-white/38",
      };
  const StateIcon = stateCopy.icon;
  const primaryVibe = toTitleCase(pick.vibe.split(",")[0] || pick.format);
  const confidenceLabel = pick.confidence >= 85 ? "Great match" : pick.confidence >= 70 ? "Strong fit" : "Possible fit";
  const mainTitleKey = relatedTitleKey(pick.title);
  const hiddenTitles = (pick.hiddenLayer.titles ?? [])
    .filter((title) => isDisplayableRelatedTitle(title.title) && relatedTitleKey(title.title) !== mainTitleKey)
    .slice(0, 3)
    .map((title) => ({ ...title, posterUrl: relatedPosters[relatedTitleKey(title.title)] ?? title.posterUrl }));
  const hiddenTitleKeys = new Set(hiddenTitles.map((title) => relatedTitleKey(title.title)));
  const seenSimilarKeys = new Set<string>();
  const backgroundAlternatives = batch
    .filter((item) => relatedTitleKey(item.title) !== mainTitleKey)
    .map((item) => ({
      title: item.title,
      year: item.year,
      posterUrl: item.omdbPosterUrl,
      confidence: item.confidence,
    }));
  const legacyAlternatives = pick.alternatives.map((item, index) => {
    const [titlePart] = item.split(" (");
    const title = titlePart.trim();
    const year = item.match(/\((\d{4})\)/)?.[1] ?? "";
    return {
      title,
      year,
      posterUrl: relatedPosters[relatedTitleKey(title)] || pick.alternativePosterUrls?.[index],
      confidence: Math.max(78, pick.confidence - 2 - index),
    };
  });
  const similar = [...backgroundAlternatives, ...legacyAlternatives].filter((item) => {
    const key = relatedTitleKey(item.title);
    if (!isDisplayableRelatedTitle(item.title) || !key || key === mainTitleKey || hiddenTitleKeys.has(key) || seenSimilarKeys.has(key)) return false;
    seenSimilarKeys.add(key);
    return true;
  }).slice(0, 4);
  const hasMorePicks = hiddenTitles.length > 0 || similar.length > 0;

  // Posters for the section above are deliberately not part of the primary response (see
  // enrichRecommendation) — fetch them once, only when the user actually opens the section.
  useEffect(() => {
    if (!showMorePicks) return;
    const fetchKey = `${pick.title}-${pick.year}`;
    if (relatedPostersFetchedForRef.current === fetchKey) return;

    const titles = [
      ...hiddenTitles.map((title) => ({ title: title.title, year: title.year })),
      ...similar.map((item) => ({ title: item.title, year: item.year })),
    ].filter((item) => item.title && !relatedPosters[relatedTitleKey(item.title)]);
    if (titles.length === 0) {
      relatedPostersFetchedForRef.current = fetchKey;
      return;
    }

    fetch("/api/related-posters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`related-posters: ${res.status}`))))
      .then((data: { posters?: Array<{ title: string; posterUrl?: string }> }) => {
        // Only mark this pick's related posters as fetched on success — a failed request
        // (network blip, timeout) should be retried on the next render rather than permanently
        // skipped until the primary title changes.
        relatedPostersFetchedForRef.current = fetchKey;
        if (!data.posters?.length) return;
        setRelatedPosters((prev) => {
          const next = { ...prev };
          for (const poster of data.posters ?? []) {
            if (poster.posterUrl) next[relatedTitleKey(poster.title)] = poster.posterUrl;
          }
          return next;
        });
      })
      .catch(() => {
        // Leave relatedPostersFetchedForRef unset so a later render (e.g. a state update from
        // elsewhere on the page) gives this a chance to retry rather than failing silently forever.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMorePicks, pick.title, pick.year]);

  const artworkPosition = useMemo(() => {
    const seed = `${pick.title}-${pick.year}`.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return `${seed % 2 === 0 ? "center" : "top"}`;
  }, [pick.title, pick.year]);

  const whyItFitsLabel = "Why it fits";

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
            <span className="text-white/60">{LOADING_STAGE_COPY[loadingStage] ?? LOADING_STAGE_COPY[DEFAULT_LOADING_STAGE]}</span>...
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
          {fetchError?.startsWith("You've reached today's free limit") && (
            <div className="mx-auto mt-5 w-full max-w-sm">
              {unlockDone ? (
                <p className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-200">
                  You&apos;re unlocked for more today — try again.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-white/50">Want more today? Leave your email to unlock a higher limit.</p>
                  <input
                    type="email"
                    value={unlockEmail}
                    onChange={(event) => setUnlockEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="h-12 w-full rounded-xl border border-white/12 bg-black/28 px-4 text-white outline-none placeholder:text-white/28 focus:border-red-300/45"
                  />
                  <button
                    type="button"
                    onClick={handleUnlockSubmit}
                    disabled={unlockSubmitting || !unlockEmail.trim()}
                    className="h-12 rounded-xl bg-gradient-to-b from-red-500 to-red-900 font-semibold text-white disabled:opacity-50"
                  >
                    {unlockSubmitting ? "Unlocking..." : "Unlock more today"}
                  </button>
                </div>
              )}
            </div>
          )}
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
                  onClick={() => captureEvent("watch-click", {
                    runId: session?.runId,
                    title: pick.title,
                    year: pick.year,
                    label: primaryAction.label,
                    verified: primaryAction.verified,
                    provider: pick.whereToWatch.primary,
                  })}
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
                  <p className="text-sm text-white/44">{confidenceLabel}</p>
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
        <section className={`mt-5 grid gap-5 ${showMorePicks && hiddenTitles.length > 0 ? "lg:grid-cols-[0.75fr_1fr]" : ""}`}>
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

          {showMorePicks && hiddenTitles.length > 0 && (
          <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/70"><Layers size={16} /> Related discoveries</p>
            <h2 className="mb-3 text-xl text-amber-100">{pick.hiddenLayer.headline}</h2>
            <p className="text-white/58">{pick.hiddenLayer.insight}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {hiddenTitles.map((title) => (
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
          </article>
          )}
        </section>
        )}

        {!noSubscriptionMatch && hasMorePicks && !showMorePicks && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowMorePicks(true)}
              className="inline-flex h-12 items-center gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-5 text-sm font-medium text-white/68 transition hover:border-white/24 hover:text-white"
            >
              Need another option? <ArrowRight size={16} />
            </button>
          </div>
        )}

        {!noSubscriptionMatch && showMorePicks && similar.length > 0 && (
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
                      <p className="mt-3 inline-flex rounded-full border border-emerald-400/25 px-2 py-1 text-xs text-emerald-200">{Math.round(item.confidence)}% match</p>
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
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="hover:text-white/70">Powered by TMDB</a>
          </span>
        </footer>
      </section>
    </main>
  );
}
