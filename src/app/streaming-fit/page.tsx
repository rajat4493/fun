"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right.js";
import BarChart3 from "lucide-react/dist/esm/icons/bar-chart-3.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import Flame from "lucide-react/dist/esm/icons/flame.js";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.js";
import Heart from "lucide-react/dist/esm/icons/heart.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import Lock from "lucide-react/dist/esm/icons/lock.js";
import PauseCircle from "lucide-react/dist/esm/icons/circle-pause.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Shield from "lucide-react/dist/esm/icons/shield.js";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.js";
import { loadOnboarding, OnboardingData, platformOptionsForCountry } from "@/components/OnboardingFlow";
import {
  loadRecommendationFeedback,
  loadRecommendationHistory,
  RecommendationFeedback,
  RecommendationHistoryItem,
  RecommendationSession,
  recommendationStorageKey,
} from "@/lib/recommendation-session";
import { Recommendation, WatchProvider } from "@/lib/types";

// Future commercial feature: platforms in this set may show a "Partner" badge in the UI.
// Partner status NEVER affects scoring. Scores derive solely from availability data and
// user feedback. Partnerships are disclosed visually (badge only) and do not inflate any metric.
// To onboard a partner, add their normalized name here — nothing else changes.
const PARTNER_PLATFORMS: Set<string> = new Set();

type ScoringPick = { title: string; year: string; whereToWatch: Recommendation["whereToWatch"] };

type PlatformFit = {
  name: string;
  score: number;
  status: "Keep" | "Pause" | "Try";
  note: string;
  includedCount: number;
  transactionalCount: number;
  isSelected: boolean;
  sampleSize: number;
  isPartner: boolean;
};

function Logo() {
  return (
    <span className="text-3xl font-medium tracking-[0.34em] text-white">
      F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
    </span>
  );
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickText(pick: Recommendation) {
  return [
    pick.title,
    pick.format,
    pick.runtime,
    pick.vibe,
    pick.oneLine,
    ...pick.whyItFits,
    pick.hiddenLayer.headline,
    pick.hiddenLayer.insight,
  ].join(" ");
}

function violatesAvoidance(avoids: string[] = [], pick: Recommendation) {
  const text = pickText(pick);
  return avoids.some((avoid) => {
    if (avoid === "gore") return /\b(gore|gory|bloody|splatter|body horror|graphic violence)\b/i.test(text);
    if (avoid === "violence") return /\b(violent|violence|brutal|killer|murder|revenge|war|torture|blood)\b/i.test(text);
    if (avoid === "horror") return /\b(horror|scary|haunted|ghost|supernatural|slasher|zombie|nightmare)\b/i.test(text);
    if (avoid === "heavy drama") return /\b(heavy drama|harrowing|bleak|trauma|depressing|devastating)\b/i.test(text);
    if (avoid === "sad ending") return /\b(sad ending|tragic ending|devastating ending|tragedy)\b/i.test(text);
    if (avoid === "slow") return /\b(slow|slow-burn|meditative|contemplative|glacial)\b/i.test(text);
    return false;
  });
}

function providerMatches(platform: string, provider: WatchProvider) {
  const platformKey = normalize(platform);
  const providerKey = normalize(provider.name);

  if (platformKey === "appletv" || platformKey === "appletvplus") {
    return providerKey === "appletv" || providerKey === "appletvplus";
  }
  if (platformKey === "jiohotstar") {
    return providerKey.includes("hotstar") || providerKey.includes("jiocinema");
  }
  if (platformKey === "hbomax") {
    return providerKey === "hbomax" || providerKey === "max";
  }
  return providerKey.includes(platformKey) || platformKey.includes(providerKey);
}

function matchingProviders(platform: string, providers: WatchProvider[]) {
  return providers.filter((provider) => providerMatches(platform, provider));
}

function isIncluded(provider: WatchProvider) {
  return provider.access === "included" || provider.access === "subscription";
}

// Combine current session batch with history, deduplicated by title+year.
// Caps at 40 historical picks so scoring stays fast and recent picks weigh more.
function combinedScoringPicks(session: RecommendationSession | null, history: RecommendationHistoryItem[]): ScoringPick[] {
  const sessionPicks: ScoringPick[] = session?.batch ?? (session?.recommendation ? [session.recommendation] : []);
  const sessionKeys = new Set(sessionPicks.map((p) => `${p.title.toLowerCase()}::${p.year}`));
  const historyPicks = history
    .filter((h) => !sessionKeys.has(`${h.title.toLowerCase()}::${h.year}`))
    .slice(0, 40);
  return [...sessionPicks, ...historyPicks];
}

function platformEvidence(platform: string, picks: ScoringPick[]) {
  let includedCount = 0;
  let transactionalCount = 0;
  for (const pick of picks) {
    const matched = matchingProviders(platform, pick.whereToWatch.providers ?? []);
    if (matched.some(isIncluded)) includedCount += 1;
    else if (matched.some((p) => p.access === "rent" || p.access === "buy" || p.access === "unknown")) transactionalCount += 1;
  }
  return { includedCount, transactionalCount };
}

function scorePlatform(platform: string, picks: ScoringPick[], feedback: RecommendationFeedback[], selectedPlatforms: string[]) {
  const { includedCount, transactionalCount } = platformEvidence(platform, picks);
  const selected = selectedPlatforms.some((item) => normalize(item) === normalize(platform));
  const base = picks.length
    ? Math.round(((includedCount / picks.length) * 82) + ((transactionalCount / picks.length) * 34))
    : selected ? 34 : 22;
  const positive = feedback.filter((item) => item.reason === "perfect" || item.reason === "good-not-perfect").length;
  // Platform-specific penalty: "not-on-service" only hurts the platform(s) that were listed for that pick.
  // This prevents a Prime Video failure from dragging down Netflix's score.
  const platformNotOnService = feedback.filter((item) =>
    item.reason === "not-on-service" &&
    matchingProviders(platform, item.whereToWatch?.providers ?? []).some(isIncluded),
  ).length;
  const modifier = Math.min(12, positive * 2) - Math.min(20, platformNotOnService * 5);
  const selectedNudge = selected && includedCount > 0 ? 4 : 0;
  // No artificial ceiling — if a platform genuinely serves all your picks, it can reach 100.
  return Math.max(5, Math.min(100, base + modifier + selectedNudge));
}

function platformFits(onboarding: OnboardingData | null, session: RecommendationSession | null, history: RecommendationHistoryItem[], feedback: RecommendationFeedback[], compareAll: boolean): PlatformFit[] {
  const selectedPlatforms = onboarding?.platforms?.length ? onboarding.platforms : ["Netflix", "Prime Video", "Apple TV+"];
  const allPicks = combinedScoringPicks(session, history);
  const providerNames = allPicks.flatMap((pick) => pick.whereToWatch.providers ?? []).map((p) => p.name);
  const countryOptions = onboarding ? platformOptionsForCountry(onboarding.countryCode) : [];
  const platforms = compareAll
    ? [...new Set([...selectedPlatforms, ...countryOptions, ...providerNames])].slice(0, 14)
    : selectedPlatforms;
  return platforms.map((platform) => {
    const { includedCount, transactionalCount } = platformEvidence(platform, allPicks);
    const score = scorePlatform(platform, allPicks, feedback, selectedPlatforms);
    const status: PlatformFit["status"] = score >= 70 ? "Keep" : score >= 42 ? "Pause" : "Try";
    const picksForPlatform = allPicks.filter((p) => matchingProviders(platform, p.whereToWatch.providers ?? []).length > 0).length;
    return {
      name: platform,
      score,
      status,
      note: includedCount > 0
        ? "Available in your fit data"
        : transactionalCount > 0
          ? "Rent/buy option, not subscription fit"
          : score >= 42 ? "Some signal, but not verified" : "Weak fit for this session",
      includedCount,
      transactionalCount,
      isSelected: selectedPlatforms.some((item) => normalize(item) === normalize(platform)),
      sampleSize: picksForPlatform,
      isPartner: PARTNER_PLATFORMS.has(normalize(platform)),
    };
  }).sort((a, b) => b.score - a.score);
}

function ScoreBar({ fit }: { fit: PlatformFit }) {
  const color = fit.score >= 70 ? "bg-emerald-400" : fit.score >= 42 ? "bg-amber-400" : "bg-red-400";
  const text = fit.score >= 70 ? "text-emerald-300" : fit.score >= 42 ? "text-amber-300" : "text-red-300";
  return (
    <div className="grid grid-cols-[minmax(120px,170px)_1fr_54px] items-center gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.055] font-semibold text-white">
          {fit.name.charAt(0)}
          {fit.isPartner && (
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-[#030303]" title="Partner" />
          )}
        </span>
        <div className="min-w-0">
          <span className="truncate text-white/82">{fit.name}</span>
          {fit.isPartner && <span className="ml-2 text-xs text-amber-400/70">Partner</span>}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${fit.score}%` }} />
      </div>
      <span className={`text-right text-xl font-semibold ${text}`}>{fit.score}%</span>
    </div>
  );
}

function RecommendationRow({ fit }: { fit: PlatformFit }) {
  const Icon = fit.status === "Keep" ? CheckCircle2 : fit.status === "Pause" ? PauseCircle : Sparkles;
  const tone = fit.status === "Keep" ? "text-emerald-300" : fit.status === "Pause" ? "text-amber-300" : "text-red-300";
  return (
    <div className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.045] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-4">
        <Icon size={24} className={tone} />
        <div className="min-w-0">
          <p className={`font-medium ${tone}`}>{fit.status}</p>
          <p className="text-sm text-white/46">{fit.note}</p>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-4">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-black/34 font-semibold">{fit.name.charAt(0)}</span>
        <span className="min-w-0 max-w-36 truncate text-white">{fit.name}</span>
        <span className={`min-w-12 text-right ${tone}`}>{fit.score}%</span>
      </div>
    </div>
  );
}

export default function StreamingFitPage() {
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [session, setSession] = useState<RecommendationSession | null>(null);
  const [history, setHistory] = useState<RecommendationHistoryItem[]>([]);
  const [feedback, setFeedback] = useState<RecommendationFeedback[]>([]);
  const [moodOpen, setMoodOpen] = useState(false);
  const [compareAll, setCompareAll] = useState(false);

  useEffect(() => {
    setOnboarding(loadOnboarding());
    setFeedback(loadRecommendationFeedback());
    setHistory(loadRecommendationHistory());
    try {
      const raw = localStorage.getItem(recommendationStorageKey);
      setSession(raw ? JSON.parse(raw) as RecommendationSession : null);
    } catch {
      setSession(null);
    }
  }, []);

  const fits = useMemo(() => platformFits(onboarding, session, history, feedback, compareAll), [onboarding, session, history, feedback, compareAll]);
  const picks = useMemo(() => combinedScoringPicks(session, history), [session, history]);
  const availableOnApps = picks.filter((pick) => {
    const providers = pick.whereToWatch.providers ?? [];
    return onboarding?.platforms.some((platform) => matchingProviders(platform, providers).some(isIncluded));
  }).length;
  const selectedPlatforms = onboarding?.platforms ?? [];
  const betterOutside = picks.filter((pick) => {
    const providers = pick.whereToWatch.providers ?? [];
    const onUserApps = selectedPlatforms.some((platform) => matchingProviders(platform, providers).some(isIncluded));
    const onOtherApps = providers.some((provider) => isIncluded(provider) && !selectedPlatforms.some((platform) => providerMatches(platform, provider)));
    return !onUserApps && onOtherApps;
  }).length;
  const totalPicksAnalyzed = picks.length;
  const selectedFits = fits.filter((fit) => fit.isSelected);
  const outsideFits = fits.filter((fit) => !fit.isSelected);
  const bestSelectedScore = selectedFits[0]?.score ?? 0;
  const bestOutsideFit = outsideFits[0];
  const tasteGapFound = betterOutside > 0 || Boolean(compareAll && bestOutsideFit && bestOutsideFit.score >= bestSelectedScore + 10);
  const moodLabel = [
    ...(session?.request.mood ?? []),
    ...(session?.request.wants ?? []),
  ].slice(0, 3).join(", ") || "latest mood";
  // Avoidance check only runs on full Recommendation objects (session batch), not slim history items.
  const sessionBatchPicks = session?.batch ?? (session?.recommendation ? [session.recommendation] : []);
  const trustViolationCount = session
    ? sessionBatchPicks.filter((pick) => violatesAvoidance(session.request.avoids, pick)).length
    : 0;
  const wrongVibeCount = feedback.filter((item) => item.reason === "wrong-vibe" || item.reason === "too-much-effort").length;
  const avoidanceScore = trustViolationCount > 0 ? "Low" : wrongVibeCount > 0 ? "Learning" : "High";

  return (
    <main className="min-h-screen bg-[#030303] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_18%_72%,rgba(185,28,28,0.16),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(251,191,36,0.1),transparent_26%),#030303]" />
      <section className="relative mx-auto max-w-[1720px] px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex h-14 items-center justify-between border-b border-white/[0.08] pb-4">
          <Link href="/" aria-label="Home"><Logo /></Link>
          <nav className="hidden items-center gap-10 text-sm text-white/64 lg:flex">
            <Link href="/">Home</Link>
            <Link href="/memory" className="hover:text-white">Memory</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Search size={20} className="hidden text-white/58 sm:block" />
            <span className="hidden h-7 w-px bg-white/10 sm:block" />
            <span className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 text-sm text-white/64">
              <Globe2 size={15} /> {onboarding?.country ?? "Region"} · {session?.request.languagePreferences?.[0] ?? "Any language"}
            </span>
          </div>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[1fr_0.95fr]">
          <div>
            <h1 className="font-serif text-[clamp(4rem,7vw,7.6rem)] leading-[0.92]">Your Streaming Fit</h1>
            <p className="mt-5 max-w-2xl text-2xl leading-9 text-white/66">
              We looked at what you liked, what you skipped, and what was actually available.
            </p>
            <button
              type="button"
              onClick={() => setMoodOpen((open) => !open)}
              className="mt-7 inline-flex h-12 items-center gap-3 rounded-full border border-white/12 bg-white/[0.045] px-5 text-white/74"
            >
              <Heart size={17} className="text-amber-200" /> This mood: <span className="text-white">{moodLabel}</span> <ChevronDown size={16} />
            </button>
            {moodOpen && (
              <div className="mt-3 max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/58">
                <p>Country: {session?.request.country ?? onboarding?.country ?? "Not selected"}</p>
                <p className="mt-1">Search mode: {session?.request.platformFilter === "mine" ? "My subscriptions" : "All cinema"}</p>
                <p className="mt-1">Taste Risk: {["Safe", "Curious", "Bold", "Unhinged"][session?.request.craziness ?? 0]}</p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-7">
            <div className="mb-4 text-xs uppercase tracking-widest text-amber-200/72">Your fit data</div>
            <div className="grid grid-cols-3 gap-5">
              <div>
                <p className="font-serif text-6xl">{totalPicksAnalyzed}</p>
                <p className="mt-1 text-white/56">picks analyzed</p>
              </div>
              <div className="border-x border-white/10 px-5">
                <p className="font-serif text-6xl">{availableOnApps}</p>
                <p className="mt-1 text-white/56">available on your apps</p>
              </div>
              <div>
                <p className="font-serif text-6xl">{betterOutside}</p>
                <p className="mt-1 text-white/56">subscription matches outside your apps</p>
              </div>
            </div>
            <p className="mt-6 text-sm text-white/42">Based on availability in {onboarding?.country ?? "your region"} · {session?.request.languagePreferences?.[0] ?? "Any language"}</p>
            <p className="mt-1 text-xs text-white/30">{totalPicksAnalyzed < 5 ? "Add more picks for higher accuracy" : totalPicksAnalyzed < 15 ? "Getting more accurate with each pick" : "High confidence — enough data to trust these scores"}</p>
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/18 bg-amber-400/[0.06] px-3 py-1 text-xs text-amber-100">
              <Lock size={13} /> Streaming Fit is a member-preview insight.
            </p>
          </div>
        </section>

        <section className="grid gap-7 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-serif text-2xl">How apps fit this mood <Info size={16} className="text-white/38" /></h2>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/46">
                {compareAll ? "Comparing regional services" : "Your subscriptions"}
              </span>
            </div>
            <div className="space-y-5">
              {fits.map((fit) => <ScoreBar key={fit.name} fit={fit} />)}
            </div>
            <div className="mt-6 flex flex-wrap gap-5 text-sm text-white/42">
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Strong fit</span>
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Moderate fit</span>
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-400" /> Weak fit</span>
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 font-serif text-2xl">What to do with your apps <Info size={16} className="text-white/38" /></h2>
              <span className="text-sm text-amber-200">How this works</span>
            </div>
            <div className="space-y-3">
              {fits.slice(0, 4).map((fit) => <RecommendationRow key={fit.name} fit={fit} />)}
            </div>
            <Link href="/memory" className="mt-5 inline-flex items-center gap-2 text-sm text-white/42 hover:text-white">
              <RefreshCw size={15} /> Manage remembered apps and signals
            </Link>
          </article>

          <article className={`rounded-2xl border p-6 ${tasteGapFound ? "border-amber-300/28 bg-amber-400/[0.06]" : "border-white/10 bg-white/[0.04]"}`}>
            <div className="grid gap-6 sm:grid-cols-[1fr_220px] sm:items-center">
              <div>
                <h2 className="flex items-center gap-3 font-serif text-3xl text-amber-100">
                  <Flame size={30} /> {tasteGapFound ? "Taste gap found" : "No clear taste gap yet"}
                </h2>
                <p className="mt-5 text-lg leading-7 text-white/68">
                  {tasteGapFound
                    ? bestOutsideFit
                      ? `${bestOutsideFit.name} looks stronger for this mood than your current app mix.`
                      : "Your current apps are weaker for this mood cluster. Better matches may be available on other services."
                    : "We need more picks or verified availability before recommending a platform change."}
                </p>
              </div>
              <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/22 p-4">
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-sm text-white/56">Your apps</span>
                  <span className="w-20 rounded-full bg-white/10 px-3 py-1 text-center text-sm text-white">{bestSelectedScore ? `${bestSelectedScore}%` : "Learning"}</span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-red-300" style={{ width: `${Math.max(8, bestSelectedScore)}%` }} />
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="truncate text-sm text-white/56">{bestOutsideFit?.name ?? "Other services"}</span>
                  <span className="w-20 rounded-full bg-emerald-400/12 px-3 py-1 text-center text-sm text-emerald-100">{bestOutsideFit?.score ? `${bestOutsideFit.score}%` : "Learning"}</span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-emerald-300" style={{ width: `${Math.max(8, bestOutsideFit?.score ?? 0)}%` }} />
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="mb-5 font-serif text-2xl">Why we think this</h2>
            <div className="space-y-4">
              {[
                ["Mood matches", "Content aligns with the mood signal", "High"],
                ["Avoidances respected", trustViolationCount > 0 ? "A recent pick crossed a hard boundary" : "We avoid what you do not want", avoidanceScore],
                ["Availability rate", "How much is actually on the service", availableOnApps >= 2 ? "High" : "Medium"],
                ["Watch clicks", "How often you click when we suggest", feedback.length ? "Medium" : "Learning"],
              ].map(([title, body, score]) => (
                <div key={title} className="grid grid-cols-[1fr_130px] gap-4">
                  <div>
                    <p className="text-white">{title}</p>
                    <p className="text-sm text-white/42">{body}</p>
                  </div>
                  <span className="text-right text-amber-200">{score}</span>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-7 flex flex-wrap items-center justify-between gap-5">
            <div className="flex flex-wrap gap-4">
            <Link href="/recommendation" className="inline-flex h-14 items-center gap-3 rounded-xl bg-gradient-to-b from-red-400 to-red-800 px-7 font-semibold text-white shadow-[0_18px_52px_rgba(127,29,29,0.34)]">
              See picks for this mood <ArrowRight size={20} />
            </Link>
            <button
              type="button"
              onClick={() => setCompareAll((value) => !value)}
              className="inline-flex h-14 items-center gap-3 rounded-xl border border-white/12 bg-white/[0.045] px-7 text-white/72 transition hover:border-white/24 hover:text-white"
            >
              <BarChart3 size={20} /> {compareAll ? "Show my subscriptions" : "Compare all platforms"}
            </button>
          </div>
          <p className="inline-flex items-center gap-2 text-sm text-white/36"><Lock size={15} /> Your data stays private. We do not sell or share it.</p>
        </section>
      </section>
    </main>
  );
}
