"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.js";
import Ban from "lucide-react/dist/esm/icons/ban.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import Heart from "lucide-react/dist/esm/icons/heart.js";
import Lock from "lucide-react/dist/esm/icons/lock.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Shield from "lucide-react/dist/esm/icons/shield.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import { ONBOARDING_KEY } from "@/components/OnboardingFlow";
import {
  dismissedPostWatchPromptKey,
  feedbackStorageKey,
  hasPostWatchFeedback,
  loadRecommendationHistory,
  recentRecommendationTitlesKey,
  RecommendationHistoryItem,
  recommendationStorageKey,
  recommendationHistoryKey,
  savePostWatchFeedback,
  seenTitlesKey,
} from "@/lib/recommendation-session";

type MemoryState = {
  onboarding: boolean;
  lastRecommendation: boolean;
  recentTitles: string[];
  seenTitles: string[];
  feedbackCount: number;
  history: RecommendationHistoryItem[];
};

const keys = [
  ONBOARDING_KEY,
  recommendationStorageKey,
  recentRecommendationTitlesKey,
  seenTitlesKey,
  feedbackStorageKey,
  recommendationHistoryKey,
  dismissedPostWatchPromptKey,
];

function Logo() {
  return (
    <span className="text-3xl font-medium tracking-[0.34em] text-white">
      F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
    </span>
  );
}

function readArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

function readMemory(): MemoryState {
  let feedbackCount = 0;
  try {
    const feedback = localStorage.getItem(feedbackStorageKey);
    feedbackCount = feedback ? (JSON.parse(feedback) as unknown[]).length : 0;
  } catch {
    feedbackCount = 0;
  }

  return {
    onboarding: Boolean(localStorage.getItem(ONBOARDING_KEY)),
    lastRecommendation: Boolean(localStorage.getItem(recommendationStorageKey)),
    recentTitles: readArray(recentRecommendationTitlesKey),
    seenTitles: readArray(seenTitlesKey),
    feedbackCount,
    history: loadRecommendationHistory(),
  };
}

export default function MemoryPage() {
  const [memory, setMemory] = useState<MemoryState | null>(null);

  useEffect(() => {
    setMemory(readMemory());
  }, []);

  function clearKey(key: string) {
    localStorage.removeItem(key);
    setMemory(readMemory());
  }

  function clearAll() {
    keys.forEach((key) => localStorage.removeItem(key));
    setMemory(readMemory());
  }

  function rateHistoryPick(reason: "perfect" | "good-not-perfect" | "not-for-me" | "quit-halfway" | "could-not-find", item: RecommendationHistoryItem) {
    savePostWatchFeedback(reason, item);
    setMemory(readMemory());
  }

  if (!memory) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#030303] text-white">
        <Logo />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#030303] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_18%_70%,rgba(185,28,28,0.16),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(251,191,36,0.09),transparent_28%),#030303]" />
      <section className="relative mx-auto max-w-[1320px] px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex h-14 items-center justify-between border-b border-white/[0.08] pb-4">
          <Link href="/" className="inline-flex items-center gap-5">
            <ArrowLeft size={22} className="text-white/70" />
            <Logo />
          </Link>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-red-300/25 bg-red-500/[0.08] px-4 text-sm text-red-100 transition hover:bg-red-500/[0.14]"
          >
            <Trash2 size={15} /> Clear all local memory
          </button>
        </header>

        <section className="py-12">
          <h1 className="font-serif text-[clamp(3.8rem,7vw,7rem)] leading-[0.94]">What F.U.N remembers</h1>
          <p className="mt-5 max-w-3xl text-xl leading-8 text-white/62">
            For this MVP, memory stays on this device unless feedback/event collection is configured for private product analytics. No accounts are required.
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="flex items-center gap-3 text-2xl"><Shield size={23} className="text-amber-200" /> Preferences</h2>
            <p className="mt-3 text-white/54">Country, language, and selected subscriptions.</p>
            <div className="mt-6 flex items-center justify-between rounded-xl border border-white/10 bg-black/26 p-4">
              <span>{memory.onboarding ? "Saved locally" : "Not saved yet"}</span>
              {memory.onboarding && (
                <button type="button" onClick={() => clearKey(ONBOARDING_KEY)} className="text-sm text-red-200 hover:text-white">Clear</button>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="flex items-center gap-3 text-2xl"><Database size={23} className="text-amber-200" /> Recent picks</h2>
            <p className="mt-3 text-white/54">Used to avoid stale repeated recommendations.</p>
            <div className="mt-6 rounded-xl border border-white/10 bg-black/26 p-4">
              <p>{memory.recentTitles.length} titles remembered</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {memory.recentTitles.slice(0, 8).map((title) => (
                  <span key={title} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/58">{title}</span>
                ))}
              </div>
              {memory.recentTitles.length > 0 && (
                <button type="button" onClick={() => clearKey(recentRecommendationTitlesKey)} className="mt-5 text-sm text-red-200 hover:text-white">Clear recent picks</button>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="flex items-center gap-3 text-2xl"><RefreshCw size={23} className="text-amber-200" /> Already seen</h2>
            <p className="mt-3 text-white/54">Used to skip titles you marked as watched.</p>
            <div className="mt-6 rounded-xl border border-white/10 bg-black/26 p-4">
              <p>{memory.seenTitles.length} titles marked seen</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {memory.seenTitles.slice(0, 8).map((title) => (
                  <span key={title} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/58">{title}</span>
                ))}
              </div>
              {memory.seenTitles.length > 0 && (
                <button type="button" onClick={() => clearKey(seenTitlesKey)} className="mt-5 text-sm text-red-200 hover:text-white">Clear seen titles</button>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 lg:col-span-2">
            <h2 className="flex items-center gap-3 text-2xl"><Heart size={23} className="text-amber-200" /> Feedback</h2>
            <p className="mt-3 text-white/54">Used to learn whether F.U.N is solving the actual mood or missing the point.</p>
            <div className="mt-6 flex items-center justify-between rounded-xl border border-white/10 bg-black/26 p-4">
              <span>{memory.feedbackCount} feedback signals saved locally</span>
              {memory.feedbackCount > 0 && (
                <button type="button" onClick={() => clearKey(feedbackStorageKey)} className="text-sm text-red-200 hover:text-white">Clear feedback</button>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 lg:col-span-3">
            <h2 className="flex items-center gap-3 text-2xl"><Heart size={23} className="text-amber-200" /> Rate watched picks</h2>
            <p className="mt-3 max-w-3xl text-white/54">
              Use this after watching. F.U.N only asks once on the homepage, but your history stays here for later.
            </p>
            <div className="mt-6 grid gap-3">
              {memory.history.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-black/26 p-4 text-white/46">No recommendation history yet.</div>
              )}
              {memory.history.slice(0, 12).map((item) => {
                const rated = hasPostWatchFeedback(item.title, item.year);
                return (
                  <div key={`${item.title}-${item.year}`} className="grid gap-4 rounded-xl border border-white/10 bg-black/26 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-lg text-white">{item.title} <span className="text-white/38">({item.year})</span></p>
                      <p className="mt-1 line-clamp-1 text-sm text-white/46">{item.oneLine}</p>
                    </div>
                    {rated ? (
                      <span className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/[0.07] px-4 text-sm text-emerald-100">
                        <CheckCircle2 size={15} /> Rated
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => rateHistoryPick("perfect", item)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-300/28 px-3 text-sm text-emerald-100"><Heart size={15} /> Loved</button>
                        <button type="button" onClick={() => rateHistoryPick("good-not-perfect", item)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-300/24 px-3 text-sm text-amber-100"><CheckCircle2 size={15} /> Good</button>
                        <button type="button" onClick={() => rateHistoryPick("not-for-me", item)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/12 px-3 text-sm text-white/64"><Ban size={15} /> Not for me</button>
                        <button type="button" onClick={() => rateHistoryPick("quit-halfway", item)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/12 px-3 text-sm text-white/64"><RefreshCw size={15} /> Quit</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.055] p-6">
            <h2 className="flex items-center gap-3 text-2xl text-amber-100"><Lock size={23} /> Control</h2>
            <div className="mt-5 space-y-3 text-white/62">
              <p className="flex gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-amber-200" /> No streaming passwords are needed.</p>
              <p className="flex gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-amber-200" /> Private preview analytics may store recommendation prompts when enabled, so do not enter sensitive personal information.</p>
              <p className="flex gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-amber-200" /> You can clear local memory anytime.</p>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
