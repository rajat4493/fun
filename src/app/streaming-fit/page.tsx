"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Flame,
  Globe2,
  Heart,
  Info,
  Lock,
  PauseCircle,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { loadOnboarding, OnboardingData } from "@/components/OnboardingFlow";
import {
  loadRecommendationFeedback,
  RecommendationFeedback,
  RecommendationSession,
  recommendationStorageKey,
} from "@/lib/recommendation-session";
import { WatchProvider } from "@/lib/types";

type PlatformFit = {
  name: string;
  score: number;
  status: "Keep" | "Pause" | "Try";
  note: string;
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

function providerMatches(platform: string, providers: WatchProvider[]) {
  const platformKey = normalize(platform);
  return providers.some((provider) => {
    const providerKey = normalize(provider.name);
    return providerKey.includes(platformKey) || platformKey.includes(providerKey);
  });
}

function scorePlatform(platform: string, session: RecommendationSession | null, feedback: RecommendationFeedback[]) {
  const picks = session?.batch ?? (session?.recommendation ? [session.recommendation] : []);
  const availableCount = picks.filter((pick) => providerMatches(platform, pick.whereToWatch.providers ?? [])).length;
  const base = picks.length ? Math.round((availableCount / picks.length) * 72) : 34;
  const positive = feedback.filter((item) => item.reason === "perfect" || item.reason === "good-not-perfect").length;
  const notOnService = feedback.filter((item) => item.reason === "not-on-service").length;
  const modifier = Math.min(12, positive * 2) - Math.min(16, notOnService * 3);
  const knownBoost = ["Netflix", "Prime Video", "JioHotstar", "Disney+", "HBO Max", "Apple TV+"].includes(platform) ? 10 : 2;
  return Math.max(12, Math.min(92, base + modifier + knownBoost));
}

function platformFits(onboarding: OnboardingData | null, session: RecommendationSession | null, feedback: RecommendationFeedback[]): PlatformFit[] {
  const platforms = onboarding?.platforms?.length ? onboarding.platforms : ["Netflix", "Prime Video", "Apple TV+"];
  return platforms.map((platform) => {
    const score = scorePlatform(platform, session, feedback);
    const status: PlatformFit["status"] = score >= 70 ? "Keep" : score >= 42 ? "Pause" : "Try";
    return {
      name: platform,
      score,
      status,
      note: score >= 70 ? "Great fit for this mood" : score >= 42 ? "Some matches, but not ideal" : "Better matches may exist elsewhere",
    };
  }).sort((a, b) => b.score - a.score);
}

function ScoreBar({ fit }: { fit: PlatformFit }) {
  const color = fit.score >= 70 ? "bg-emerald-400" : fit.score >= 42 ? "bg-amber-400" : "bg-red-400";
  const text = fit.score >= 70 ? "text-emerald-300" : fit.score >= 42 ? "text-amber-300" : "text-red-300";
  return (
    <div className="grid grid-cols-[150px_1fr_54px] items-center gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.055] font-semibold text-white">
          {fit.name.charAt(0)}
        </span>
        <span className="truncate text-white/82">{fit.name}</span>
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
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center gap-4">
        <Icon size={24} className={tone} />
        <div>
          <p className={`font-medium ${tone}`}>{fit.status}</p>
          <p className="text-sm text-white/46">{fit.note}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-black/34 font-semibold">{fit.name.charAt(0)}</span>
        <span className="min-w-28 text-white">{fit.name}</span>
        <span className={tone}>{fit.score}%</span>
      </div>
    </div>
  );
}

export default function StreamingFitPage() {
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [session, setSession] = useState<RecommendationSession | null>(null);
  const [feedback, setFeedback] = useState<RecommendationFeedback[]>([]);
  const [moodOpen, setMoodOpen] = useState(false);

  useEffect(() => {
    setOnboarding(loadOnboarding());
    setFeedback(loadRecommendationFeedback());
    try {
      const raw = localStorage.getItem(recommendationStorageKey);
      setSession(raw ? JSON.parse(raw) as RecommendationSession : null);
    } catch {
      setSession(null);
    }
  }, []);

  const fits = useMemo(() => platformFits(onboarding, session, feedback), [onboarding, session, feedback]);
  const picks = session?.batch ?? (session?.recommendation ? [session.recommendation] : []);
  const availableOnApps = picks.filter((pick) => {
    const providers = pick.whereToWatch.providers ?? [];
    return onboarding?.platforms.some((platform) => providerMatches(platform, providers));
  }).length;
  const betterOutside = Math.max(0, picks.length - availableOnApps);
  const moodLabel = [
    ...(session?.request.mood ?? []),
    ...(session?.request.wants ?? []),
  ].slice(0, 3).join(", ") || "latest mood";

  return (
    <main className="min-h-screen bg-[#030303] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_18%_72%,rgba(185,28,28,0.16),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(251,191,36,0.1),transparent_26%),#030303]" />
      <section className="relative mx-auto max-w-[1720px] px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex h-14 items-center justify-between border-b border-white/[0.08] pb-4">
          <Link href="/" aria-label="Home"><Logo /></Link>
          <nav className="hidden items-center gap-10 text-sm text-white/64 lg:flex">
            <Link href="/">Home</Link>
            <span className="relative text-white">
              Streaming Fit
              <span className="absolute -bottom-4 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-red-500" />
            </span>
            <Link href="/memory" className="hover:text-white">Memory</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <a href="mailto:feedback@findurnext.com" className="hover:text-white">Give feedback</a>
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
            <div className="mb-4 text-xs uppercase tracking-widest text-amber-200/72">This session</div>
            <div className="grid grid-cols-3 gap-5">
              <div>
                <p className="font-serif text-6xl">{picks.length}</p>
                <p className="mt-1 text-white/56">picks analyzed</p>
              </div>
              <div className="border-x border-white/10 px-5">
                <p className="font-serif text-6xl">{availableOnApps}</p>
                <p className="mt-1 text-white/56">available on your apps</p>
              </div>
              <div>
                <p className="font-serif text-6xl">{betterOutside}</p>
                <p className="mt-1 text-white/56">better matches outside your apps</p>
              </div>
            </div>
            <p className="mt-6 text-sm text-white/42">Based on availability in {onboarding?.country ?? "your region"} · {session?.request.languagePreferences?.[0] ?? "Any language"}</p>
          </div>
        </section>

        <section className="grid gap-7 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="mb-6 flex items-center gap-2 font-serif text-2xl">How your apps fit this mood <Info size={16} className="text-white/38" /></h2>
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
            <button type="button" className="mt-5 inline-flex items-center gap-2 text-sm text-white/42 hover:text-white">
              <RefreshCw size={15} /> Update my apps
            </button>
          </article>

          <article className="rounded-2xl border border-amber-300/28 bg-amber-400/[0.06] p-6">
            <div className="grid gap-6 sm:grid-cols-[1fr_220px] sm:items-center">
              <div>
                <h2 className="flex items-center gap-3 font-serif text-3xl text-amber-100"><Flame size={30} /> Taste gap found</h2>
                <p className="mt-5 text-lg leading-7 text-white/68">Your current apps are weaker for this mood cluster. Better matches may be available on other services.</p>
              </div>
              <div className="relative h-36">
                <div className="absolute left-6 top-4 grid h-28 w-28 place-items-center rounded-full border border-red-400/60 bg-red-500/10 text-sm text-white/78">Your apps</div>
                <div className="absolute right-6 top-4 grid h-28 w-28 place-items-center rounded-full border border-emerald-400/60 bg-emerald-500/10 text-sm text-emerald-100">Best matches</div>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="mb-5 font-serif text-2xl">Why we think this</h2>
            <div className="space-y-4">
              {[
                ["Mood matches", "Content aligns with the mood signal", "High"],
                ["Avoidances respected", "We avoid what you do not want", "High"],
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
            <button type="button" className="inline-flex h-14 items-center gap-3 rounded-xl border border-white/12 bg-white/[0.045] px-7 text-white/62">
              <BarChart3 size={20} /> Compare all platforms
            </button>
          </div>
          <p className="inline-flex items-center gap-2 text-sm text-white/36"><Lock size={15} /> Your data stays private. We do not sell or share it.</p>
        </section>
      </section>
    </main>
  );
}
