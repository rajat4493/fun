"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Compass,
  Drama,
  Flame,
  Globe2,
  Heart,
  Lock,
  Monitor,
  PenLine,
  PlayCircle,
  Search,
  Shield,
  Smile,
  Sparkles,
  Star,
  type LucideIcon,
  User,
  Users,
  Zap,
} from "lucide-react";
import OnboardingFlow, {
  COUNTRIES,
  defaultPlatformsForCountry,
  LANGUAGE_OPTIONS,
  loadOnboarding,
  OnboardingData,
  platformOptionsForCountry,
  saveOnboarding,
} from "@/components/OnboardingFlow";
import {
  createRecommendationSession,
  dismissPostWatchPrompt,
  FeedbackReason,
  getOrCreateSessionId,
  hasDismissedPostWatchPrompt,
  hasPostWatchFeedback,
  loadRecommendationFeedbackContext,
  loadRecommendationHistory,
  loadRecommendationMemoryTitles,
  RecommendationHistoryItem,
  RecommendationSession,
  loadSeenTitles,
  recommendationStorageKey,
  rememberRecommendationHistory,
  rememberRecommendationTitles,
  savePostWatchFeedback,
} from "@/lib/recommendation-session";
import { CrazinessLevel, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

type Option = {
  label: string;
  icon: LucideIcon;
  helper?: string;
};

const moods: Option[] = [
  { label: "tired", icon: Smile },
  { label: "happy", icon: Smile },
  { label: "lonely", icon: User },
  { label: "nostalgic", icon: Clock3 },
  { label: "stressed", icon: Zap },
  { label: "curious", icon: Search },
];

const avoids: Option[] = [
  { label: "violence", icon: Shield },
  { label: "gore", icon: Flame },
  { label: "heavy drama", icon: Shield },
  { label: "horror", icon: Drama },
  { label: "sad ending", icon: Ban },
  { label: "slow", icon: Clock3 },
];

const wants: Option[] = [
  { label: "emotional", icon: Heart },
  { label: "funny", icon: Smile },
  { label: "comforting", icon: Heart },
  { label: "inspiring", icon: Sparkles },
  { label: "romantic", icon: Heart },
  { label: "weird", icon: Compass },
];

const timeOptions = ["90 min", "under 2 hours", "one episode", "no preference"];
const energyOptions = ["Very low", "Low", "Medium", "High"];
const contextOptions = ["Alone", "Partner", "Friends", "Family"];
const riskOptions: Array<{ level: CrazinessLevel; label: string; helper: string; icon: LucideIcon }> = [
  { level: 0, label: "Safe", helper: "Feel-good & familiar", icon: Shield },
  { level: 1, label: "Curious", helper: "Try something new", icon: Search },
  { level: 2, label: "Bold", helper: "Deep & challenging", icon: Sparkles },
  { level: 3, label: "Unhinged", helper: "Wild & unexpected", icon: Star },
];
const POST_WATCH_PROMPT_DELAY_MS = 30 * 60 * 1000;

const defaultPick: Recommendation = {
  title: "The Station Agent",
  year: "2003",
  format: "Film",
  runtime: "88 min",
  vibe: "heartwarming, quiet, humane",
  confidence: 95,
  oneLine: "A tender story about unexpected friendships and finding your place.",
  whyItFits: [
    "It is warm without being sugary.",
    "The runtime is lean enough for a tired evening.",
    "It gives comfort through character chemistry, not noise.",
  ],
  whereToWatch: {
    status: "unverified",
    primary: "Generate a pick",
    note: "F.U.N will check availability for your region.",
  },
  hiddenLayer: {
    headline: "Your taste may be wider",
    insight: "Generate a pick and F.U.N will reveal whether your services fit the mood.",
    classyJab: "One pick, verified where possible.",
  },
  alternatives: ["Chef (2014)", "Once (2007)", "About Time (2013)"],
};

function languageOptionsFor(countryCode: string) {
  return [...new Set([...(LANGUAGE_OPTIONS[countryCode] ?? LANGUAGE_OPTIONS.default), "No preference"])];
}

function toggle(value: string, current: string[], setter: (next: string[]) => void) {
  setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
}

function Logo() {
  return (
    <span className="text-3xl font-medium tracking-[0.34em] text-white">
      F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
    </span>
  );
}

function RegionLanguageButton({ onboarding, onClick }: { onboarding: OnboardingData; onClick: () => void }) {
  const language = onboarding.languagePreferences?.length ? onboarding.languagePreferences.slice(0, 2).join(", ") : "Any language";
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 max-w-[62vw] items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:border-white/24 hover:bg-white/[0.08]"
    >
      <Globe2 size={16} />
      <span className="truncate">{onboarding.country} · {language}</span>
      <ChevronDown size={15} className="text-white/44" />
    </button>
  );
}

function RegionLanguagePanel({
  onboarding,
  onChange,
  onClose,
}: {
  onboarding: OnboardingData;
  onChange: (next: OnboardingData) => void;
  onClose: () => void;
}) {
  const languageOptions = languageOptionsFor(onboarding.countryCode);

  function setCountry(code: string) {
    const country = COUNTRIES.find((item) => item.code === code);
    if (!country) return;
    const valid = platformOptionsForCountry(country.code);
    const platforms = onboarding.platforms.filter((platform) => valid.includes(platform));
    const next = {
      country: country.name,
      countryCode: country.code,
      languagePreferences: [],
      platforms: platforms.length ? platforms : defaultPlatformsForCountry(country.code),
    };
    saveOnboarding(next);
    onChange(next);
  }

  function toggleLanguage(language: string) {
    const current = onboarding.languagePreferences ?? [];
    const nextLanguages = language === "No preference"
      ? []
      : current.includes(language)
        ? current.filter((item) => item !== language)
        : [...current, language];
    const next = { ...onboarding, languagePreferences: nextLanguages };
    saveOnboarding(next);
    onChange(next);
  }

  return (
    <div className="absolute right-0 top-12 z-30 w-[min(92vw,390px)] rounded-2xl border border-white/12 bg-[#111111]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)] backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">Region & language</p>
          <p className="mt-1 text-xs leading-4 text-white/42">Availability follows your country. Language guides the recommendation.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/58 hover:text-white">
          Done
        </button>
      </div>
      <div className="mt-4 grid max-h-40 grid-cols-2 gap-2 overflow-y-auto pr-1">
        {COUNTRIES.map((country) => (
          <button
            key={country.code}
            type="button"
            onClick={() => setCountry(country.code)}
            className={`h-9 rounded-lg border px-3 text-left text-sm transition ${
              onboarding.countryCode === country.code ? "border-red-400/45 bg-red-500/14 text-white" : "border-white/10 bg-white/[0.04] text-white/62 hover:text-white"
            }`}
          >
            {country.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {languageOptions.map((language) => {
          const active = language === "No preference"
            ? !(onboarding.languagePreferences?.length)
            : onboarding.languagePreferences?.includes(language);
          return (
            <button
              key={language}
              type="button"
              onClick={() => toggleLanguage(language)}
              className={`h-8 rounded-full border px-3 text-xs transition ${
                active ? "border-amber-300/45 bg-amber-400/12 text-white" : "border-white/10 bg-white/[0.04] text-white/58 hover:text-white"
              }`}
            >
              {language}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChoiceButton({ option, active, onClick }: { option: Option; active: boolean; onClick: () => void }) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-14 min-w-0 items-center justify-center gap-3 rounded-xl border px-3 py-3 text-sm transition-all duration-150 ${
        active
          ? "border-red-400 bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]"
          : "border-white/12 bg-white/[0.045] text-white/72 hover:border-white/24 hover:text-white"
      }`}
    >
      <Icon size={19} className={active ? "text-red-300" : "text-white/60"} />
      <span className="min-w-0 leading-5">{option.label}</span>
    </button>
  );
}

function PlatformChip({ name }: { name: string }) {
  const marks: Record<string, string> = {
    Netflix: "N",
    "Prime Video": "prime",
    "Disney+": "D+",
    "Apple TV+": "tv+",
    "HBO Max": "max",
    "JioHotstar": "JH",
    Zee5: "Z5",
    SonyLIV: "SL",
    MUBI: "M",
  };
  return (
    <span className="grid min-h-11 min-w-14 place-items-center rounded-lg border border-white/10 bg-white/[0.055] px-3 py-2 text-center text-xs font-semibold leading-4 text-white/82 sm:min-w-16 sm:text-sm">
      {marks[name] ?? name.slice(0, 3)}
    </span>
  );
}

function pickContextHint() {
  const now = new Date();
  const hour = now.getHours();
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
  const timeOfDay = hour < 6 ? "late night / early hours" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "late night";
  const month = now.getMonth();
  const season = month < 3 || month === 11 ? "winter" : month < 6 ? "spring" : month < 9 ? "summer" : "autumn";
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  return `${isWeekend ? "Weekend" : "Weekday"} ${timeOfDay} (${dayName}), ${season}`;
}

async function captureEvent(type: string, payload: Record<string, unknown>) {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: getOrCreateSessionId(), type, payload }),
  }).catch(() => {});
}

function isPlaceholderPick(recommendation?: Recommendation | null) {
  return !recommendation || (
    recommendation.title === defaultPick.title &&
    recommendation.year === defaultPick.year
  );
}

function isOldEnoughForWatchFeedback(createdAt?: string) {
  if (!createdAt) return true;
  const createdTime = new Date(createdAt).getTime();
  if (Number.isNaN(createdTime)) return true;
  return Date.now() - createdTime > POST_WATCH_PROMPT_DELAY_MS;
}

function findPostWatchCandidateFromHistory(): RecommendationHistoryItem | null {
  return loadRecommendationHistory()
    .filter((item) =>
      isOldEnoughForWatchFeedback(item.createdAt) &&
      !hasPostWatchFeedback(item.title, item.year) &&
      !hasDismissedPostWatchPrompt(item.title, item.year),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputMode, setInputMode] = useState<"choose" | "describe">("choose");
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [selectedAvoids, setSelectedAvoids] = useState<string[]>([]);
  const [selectedWants, setSelectedWants] = useState<string[]>([]);
  const [time, setTime] = useState("90 min");
  const [energy, setEnergy] = useState("Low");
  const [viewingContext, setViewingContext] = useState("Alone");
  const [risk, setRisk] = useState<CrazinessLevel>(0);
  const [platformFilter, setPlatformFilter] = useState<"mine" | "any">("mine");
  const [indieMode, setIndieMode] = useState(false);
  const [selfText, setSelfText] = useState("");
  const [reference, setReference] = useState("");
  const [pick, setPick] = useState<Recommendation>(defaultPick);
  const [postWatchCandidate, setPostWatchCandidate] = useState<RecommendationHistoryItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = loadOnboarding();
    setOnboarding(saved);
    try {
      const raw = localStorage.getItem(recommendationStorageKey);
      if (raw) {
        const session = JSON.parse(raw) as Partial<RecommendationSession>;
        if (session.recommendation && !isPlaceholderPick(session.recommendation)) {
          setPick(session.recommendation);
          if (
            isOldEnoughForWatchFeedback(session.generatedAt) &&
            !hasPostWatchFeedback(session.recommendation.title, session.recommendation.year) &&
            !hasDismissedPostWatchPrompt(session.recommendation.title, session.recommendation.year)
          ) {
            setPostWatchCandidate({
              id: `${session.recommendation.title}-${session.recommendation.year}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              title: session.recommendation.title,
              year: session.recommendation.year,
              format: session.recommendation.format,
              confidence: session.recommendation.confidence,
              oneLine: session.recommendation.oneLine,
              posterUrl: session.recommendation.omdbPosterUrl,
              request: session.request ?? { mode: "choose" },
              whereToWatch: session.recommendation.whereToWatch,
              createdAt: session.generatedAt || new Date().toISOString(),
            });
          } else {
            setPostWatchCandidate(findPostWatchCandidateFromHistory());
          }
        } else {
          setPostWatchCandidate(findPostWatchCandidateFromHistory());
        }
      } else {
        setPostWatchCandidate(findPostWatchCandidateFromHistory());
      }
    } catch {
      // ignore local storage issues
    }
    setReady(true);
  }, []);

  function saveReturnFeedback(reason: FeedbackReason) {
    if (!postWatchCandidate) return;
    savePostWatchFeedback(reason, postWatchCandidate);
    dismissPostWatchPrompt(postWatchCandidate.title, postWatchCandidate.year);
    captureEvent("feedback", {
      phase: "post-watch",
      reason,
      title: postWatchCandidate.title,
      year: postWatchCandidate.year,
      format: postWatchCandidate.format,
      confidence: postWatchCandidate.confidence,
      country: postWatchCandidate.request.country,
      mood: postWatchCandidate.request.mood,
      wants: postWatchCandidate.request.wants,
      avoids: postWatchCandidate.request.avoids,
      languagePreferences: postWatchCandidate.request.languagePreferences,
      craziness: postWatchCandidate.request.craziness,
      platformFilter: postWatchCandidate.request.platformFilter,
    });
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: getOrCreateSessionId(),
        phase: "post-watch",
        reason,
        title: postWatchCandidate.title,
        year: postWatchCandidate.year,
        format: postWatchCandidate.format,
        confidence: postWatchCandidate.confidence,
        country: postWatchCandidate.request.country,
        mood: postWatchCandidate.request.mood,
        wants: postWatchCandidate.request.wants,
        avoids: postWatchCandidate.request.avoids,
        languagePreferences: postWatchCandidate.request.languagePreferences,
        craziness: postWatchCandidate.request.craziness,
        platformFilter: postWatchCandidate.request.platformFilter,
      }),
    }).catch(() => {});
    setPostWatchCandidate(null);
  }

  function dismissReturnFeedback() {
    if (!postWatchCandidate) return;
    dismissPostWatchPrompt(postWatchCandidate.title, postWatchCandidate.year);
    setPostWatchCandidate(null);
  }

  async function findPick() {
    if (!onboarding || loading) return;
    if (inputMode === "describe" && !selfText.trim() && !reference.trim()) return;
    setLoading(true);

    const recentTitles = (() => {
      try {
        const raw = localStorage.getItem(recommendationStorageKey);
        if (!raw) return loadRecommendationMemoryTitles();
        const session = JSON.parse(raw) as { recommendation?: Recommendation; batch?: Recommendation[] };
        return [
          ...loadRecommendationMemoryTitles(),
          session.recommendation?.title,
          ...(session.batch ?? []).map((item) => item.title),
        ].filter((title): title is string => Boolean(title)).slice(0, 40);
      } catch {
        return loadRecommendationMemoryTitles();
      }
    })();

    const requestInput: RecommendRequest = {
      mode: inputMode === "describe" ? "self" : "choose",
      mood: inputMode === "describe" ? undefined : selectedMoods,
      wants: inputMode === "describe" ? undefined : selectedWants,
      // Avoidances are safety constraints, not mood signals — always pass them regardless of mode.
      avoids: selectedAvoids.length > 0 ? selectedAvoids : undefined,
      time: time !== "no preference" ? time : undefined,
      energy,
      viewingContext,
      country: onboarding.country,
      languagePreferences: onboarding.languagePreferences,
      platforms: onboarding.platforms,
      selfText: inputMode === "describe" ? selfText.trim() || undefined : undefined,
      reference: inputMode === "describe" ? reference.trim() || undefined : undefined,
      seenTitles: loadSeenTitles(),
      recentTitles,
      platformFilter,
      discoveryMode: indieMode ? "indie" : "standard",
      contextHint: pickContextHint(),
      craziness: risk,
      feedbackContext: loadRecommendationFeedbackContext(),
    };

    localStorage.setItem("fun:loading", "true");
    localStorage.setItem("fun:loading-started-at", String(Date.now()));
    localStorage.removeItem("fun:recommendation-error");
    captureEvent("ask", {
      country: requestInput.country,
      languagePreferences: requestInput.languagePreferences,
      platforms: requestInput.platforms,
      mood: requestInput.mood,
      wants: requestInput.wants,
      avoids: requestInput.avoids,
      time: requestInput.time,
      energy,
      viewingContext,
      platformFilter,
      discoveryMode: indieMode ? "indie" : "standard",
      craziness: risk,
      hasFreeText: inputMode === "describe" && Boolean(selfText.trim()),
      hasReference: Boolean(reference.trim()),
    });
    router.push("/recommendation");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 85000);
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(requestInput),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not generate a pick.");
      const data = await response.json() as Recommendation & { _batch?: Recommendation[]; _trust?: { displayState?: RecommendationDisplayState } };
      const batch = data._batch ?? [data];
      rememberRecommendationTitles(batch.map((item) => item.title));
      rememberRecommendationHistory(batch, requestInput);
      localStorage.setItem(recommendationStorageKey, JSON.stringify(createRecommendationSession(batch[0], requestInput, batch, data._trust?.displayState)));
      captureEvent("recommendation", {
        title: batch[0].title,
        year: batch[0].year,
        confidence: batch[0].confidence,
        batch: batch.map((item) => ({ title: item.title, year: item.year, confidence: item.confidence })),
        availabilityStatus: batch[0].whereToWatch.status,
        providerCount: batch[0].whereToWatch.providers?.length ?? 0,
      });
    } catch (error) {
      localStorage.setItem(
        "fun:recommendation-error",
        error instanceof Error && error.name === "AbortError"
          ? "The recommendation took too long. Please try again."
          : error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      window.clearTimeout(timeout);
      localStorage.removeItem("fun:loading");
      localStorage.removeItem("fun:loading-started-at");
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#030303] text-white">
        <Logo />
      </main>
    );
  }

  if (!onboarding) return <OnboardingFlow onComplete={(data) => setOnboarding(data)} />;

  const canFindPick = inputMode === "choose" || Boolean(selfText.trim() || reference.trim());

  return (
    <main className="min-h-screen overflow-hidden bg-[#030303] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_78%_20%,rgba(65,92,111,0.22),transparent_30%),radial-gradient(circle_at_18%_62%,rgba(185,28,28,0.16),transparent_32%),#030303]" />
      <section className="relative mx-auto w-full max-w-[1540px] px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
        <header className="relative flex h-12 items-center justify-between">
          <Logo />
          <nav className="hidden items-center gap-10 text-sm text-white/68 lg:flex">
            <a href="#how" className="hover:text-white">How it works</a>
            <Link href="/memory" className="hover:text-white">Memory</Link>
          </nav>
          <div className="relative">
            <RegionLanguageButton onboarding={onboarding} onClick={() => setSettingsOpen((open) => !open)} />
            {settingsOpen && (
              <RegionLanguagePanel
                onboarding={onboarding}
                onChange={setOnboarding}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </header>

        <section className="grid min-h-[560px] items-center gap-8 py-10 lg:grid-cols-[0.92fr_1.08fr] xl:min-h-[620px]">
          <div className="max-w-[680px]">
            <h1 className="font-serif text-[clamp(3.6rem,6.8vw,7rem)] leading-[0.9] tracking-normal">
              One perfect pick.
              <br />
              <span className="text-amber-200">No more scrolling.</span>
            </h1>
            <p className="mt-7 max-w-xl text-xl leading-8 text-white/68">
              F.U.N gives you one movie based on your mood, avoidances, time, and what is on your subscriptions.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="#mood" className="inline-flex min-h-14 min-w-[220px] items-center justify-center gap-4 rounded-xl bg-gradient-to-b from-red-400 to-red-800 px-6 py-4 text-base font-semibold text-white shadow-[0_18px_54px_rgba(127,29,29,0.4)] transition hover:brightness-110 sm:min-h-16 sm:min-w-[250px] sm:text-lg">
                Find my pick <ArrowRight size={22} />
              </a>
              <a href="#how" className="inline-flex min-h-14 min-w-[170px] items-center justify-center gap-3 rounded-xl border border-white/16 bg-white/[0.045] px-6 py-4 text-base text-white/86 transition hover:border-white/28 hover:bg-white/[0.08] sm:min-h-16 sm:min-w-[190px] sm:text-lg">
                <PlayCircle size={22} className="text-amber-200" /> How it works
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-3 text-sm text-white/68">
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3"><CheckCircle2 size={16} className="text-amber-200" /> Works with your subscriptions</span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3"><Shield size={16} className="text-amber-200" /> Respects your mood & avoidances</span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3"><User size={16} className="text-amber-200" /> No accounts needed</span>
            </div>
          </div>

          <div className="relative hidden min-h-[400px] lg:block xl:min-h-[440px]">
            <div className="absolute inset-0 rounded-[2rem] bg-cover bg-center opacity-82 shadow-[inset_0_-140px_90px_rgba(3,3,3,0.92)]" style={{ backgroundImage: "url('/fun/hero-cinematic.png')" }} />
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-r from-[#030303] via-transparent to-transparent" />
          </div>
        </section>

        {postWatchCandidate && (
          <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="min-w-0">
                <p className="text-sm uppercase tracking-[0.2em] text-amber-200/70">Last pick</p>
                <h2 className="mt-2 text-2xl text-white">Did you watch {postWatchCandidate.title}?</h2>
                <p className="mt-1 text-white/48">One tap helps F.U.N learn after the movie, not before it.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => saveReturnFeedback("perfect")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-300/35 bg-emerald-400/[0.08] px-4 text-sm text-emerald-100">
                  <Heart size={16} /> Loved it
                </button>
                <button type="button" onClick={() => saveReturnFeedback("good-not-perfect")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/[0.07] px-4 text-sm text-amber-100">
                  <CheckCircle2 size={16} /> Good
                </button>
                <button type="button" onClick={() => saveReturnFeedback("not-for-me")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.045] px-4 text-sm text-white/68 hover:text-white">
                  <Ban size={16} /> Not for me
                </button>
                <button type="button" onClick={dismissReturnFeedback} className="inline-flex h-11 items-center rounded-xl border border-white/10 px-4 text-sm text-white/42 hover:text-white">
                  Not now
                </button>
              </div>
            </div>
          </section>
        )}

        <section id="mood" className="rounded-2xl border border-white/10 bg-[#090909]/82 p-5 shadow-[0_26px_100px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-8">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-[clamp(2.5rem,4.4vw,4.8rem)] leading-none">How are you feeling tonight?</h2>
              <p className="mt-3 text-white/56">Pick one or more. We will respect your avoidances first.</p>
            </div>
            <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full border border-amber-300/35 bg-amber-400/[0.06] px-5 text-sm text-amber-100">
              <Heart size={16} /> Save mood
            </button>
          </div>

          <div className="space-y-5">
            <div className="max-w-xl rounded-xl border border-white/10 bg-black/24 p-1">
              <div className="grid grid-cols-2">
                <button
                  type="button"
                  onClick={() => setInputMode("choose")}
                  className={`h-12 rounded-lg text-sm transition ${inputMode === "choose" ? "bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "text-white/50 hover:text-white"}`}
                >
                  <Sparkles size={16} className="mr-2 inline" /> Choose
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("describe")}
                  className={`h-12 rounded-lg text-sm transition ${inputMode === "describe" ? "bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "text-white/50 hover:text-white"}`}
                >
                  <PenLine size={16} className="mr-2 inline" /> Describe
                </button>
              </div>
            </div>

            {inputMode === "choose" ? (
              <>
                <div className="grid gap-4 lg:grid-cols-[140px_1fr] lg:items-center">
                  <div className="border-l-2 border-red-400 pl-5 text-lg">I'm feeling</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {moods.map((option) => (
                      <ChoiceButton key={option.label} option={option} active={selectedMoods.includes(option.label)} onClick={() => toggle(option.label, selectedMoods, setSelectedMoods)} />
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[140px_1fr] lg:items-center">
                  <div className="border-l-2 border-red-400 pl-5 text-lg">I don't want</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {avoids.map((option) => (
                      <ChoiceButton key={option.label} option={option} active={selectedAvoids.includes(option.label)} onClick={() => toggle(option.label, selectedAvoids, setSelectedAvoids)} />
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[140px_1fr] lg:items-center">
                  <div className="border-l-2 border-red-400 pl-5 text-lg">I want</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {wants.map((option) => (
                      <ChoiceButton key={option.label} option={option} active={selectedWants.includes(option.label)} onClick={() => toggle(option.label, selectedWants, setSelectedWants)} />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid gap-5 rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:grid-cols-[1.2fr_0.8fr]">
                <label>
                  <span className="mb-3 flex items-center gap-2 text-lg"><PenLine size={18} /> Describe it your way</span>
                  <textarea value={selfText} onChange={(event) => setSelfText(event.target.value)} rows={5} placeholder="I want a hidden gem thriller, or something like Friends but in Hindi..." className="w-full resize-none rounded-xl border border-white/12 bg-black/28 px-4 py-3 text-white outline-none placeholder:text-white/28 focus:border-red-300/45" />
                  <span className="mt-2 block text-sm text-white/42">Describe mode ignores the mood buttons and uses your words directly.</span>
                  {selectedAvoids.length > 0 && (
                    <span className="mt-2 flex items-center gap-2 text-sm text-amber-200/70">
                      <Shield size={13} /> Avoidances still active: {selectedAvoids.join(", ")}
                    </span>
                  )}
                </label>
                <label>
                  <span className="mb-3 flex items-center gap-2 text-lg"><FilmIcon /> Reference title</span>
                  <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional: Shameless, Parasite, Fleabag..." className="h-14 w-full rounded-xl border border-white/12 bg-black/28 px-4 text-white outline-none placeholder:text-white/28 focus:border-red-300/45" />
                  <span className="mt-2 block text-sm text-white/42">Use this when you want the feeling of one title translated into another region or language.</span>
                </label>
              </div>
            )}

            <div className="grid gap-6 border-t border-white/8 pt-5 lg:grid-cols-[160px_1fr_1.1fr]">
              <label className="block">
                <span className="mb-3 flex items-center gap-2 text-lg"><Clock3 size={18} /> Time</span>
                <select value={time} onChange={(event) => setTime(event.target.value)} className="h-14 w-full rounded-xl border border-white/12 bg-black/32 px-4 text-white outline-none">
                  {timeOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <div>
                <span className="mb-3 flex items-center gap-2 text-lg"><Zap size={18} /> Energy</span>
                <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/26 p-1 sm:grid-cols-4">
                  {energyOptions.map((option) => (
                    <button key={option} type="button" onClick={() => setEnergy(option)} className={`min-h-12 rounded-lg px-2 py-2 text-sm leading-5 transition ${energy === option ? "bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "text-white/48 hover:text-white"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-3 flex items-center gap-2 text-lg"><Users size={18} /> Context</span>
                <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/26 p-1 sm:grid-cols-4">
                  {contextOptions.map((option) => (
                    <button key={option} type="button" onClick={() => setViewingContext(option)} className={`min-h-12 rounded-lg px-2 py-2 text-sm leading-5 transition ${viewingContext === option ? "bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "text-white/48 hover:text-white"}`}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-white/8 pt-5">
              <span className="mb-3 flex items-center gap-2 text-lg"><Sparkles size={18} /> Taste Risk</span>
              <div className="grid gap-2 rounded-xl border border-white/10 bg-black/26 p-1 sm:grid-cols-4">
                {riskOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button key={option.level} type="button" onClick={() => setRisk(option.level)} className={`min-h-20 rounded-lg border px-4 py-3 text-center transition-all duration-150 ${risk === option.level ? "border-red-400 bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "border-transparent text-white/54 hover:bg-white/[0.04] hover:text-white"}`}>
                      <span className="flex items-center justify-center gap-2"><Icon size={17} /> {option.label}</span>
                      <span className="mt-1 block text-sm text-white/42">{option.helper}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-white/8 pt-5">
              <div className="max-w-3xl">
                <span className="mb-3 block text-sm uppercase tracking-widest text-white/36">Where to search</span>
                  <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/26 p-1">
                    <button type="button" onClick={() => setPlatformFilter("mine")} className={`h-14 rounded-lg text-base transition ${platformFilter === "mine" ? "bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "text-white/50 hover:text-white"}`}>My subscriptions</button>
                    <button type="button" onClick={() => setPlatformFilter("any")} className={`h-14 rounded-lg text-base transition ${platformFilter === "any" ? "bg-red-950/55 text-white shadow-[0_0_6px_rgba(248,113,113,0.8),0_0_18px_rgba(239,68,68,0.5),0_0_40px_rgba(239,68,68,0.2)]" : "text-white/50 hover:text-white"}`}>All cinema</button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {onboarding.platforms.slice(0, 7).map((platform) => <PlatformChip key={platform} name={platform} />)}
                    {onboarding.platforms.length > 7 && <span className="grid h-11 min-w-14 place-items-center rounded-lg border border-dashed border-white/20 text-white/58">+{onboarding.platforms.length - 7}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIndieMode((value) => !value)}
                    className={`mt-4 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                      indieMode
                        ? "border-amber-300/45 bg-amber-400/[0.09] text-amber-100"
                        : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/22 hover:text-white"
                    }`}
                  >
                    <span>
                      <span className="block font-medium">Go indie</span>
                      <span className="mt-1 block text-sm text-white/42">Prefer smaller, under-marketed, discovery-first picks.</span>
                    </span>
                    <span className={`h-6 w-11 rounded-full border p-0.5 transition ${indieMode ? "border-amber-300/45 bg-amber-300/25" : "border-white/16 bg-black/30"}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${indieMode ? "translate-x-5" : ""}`} />
                    </span>
                  </button>
              </div>
            </div>

            <div className="mx-auto max-w-4xl pt-2">
              <button type="button" onClick={findPick} disabled={loading || !canFindPick} className="inline-flex h-16 w-full items-center justify-center gap-4 rounded-xl bg-gradient-to-b from-amber-200 to-amber-500 text-xl font-semibold text-black shadow-[0_18px_58px_rgba(251,191,36,0.18)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55">
                {loading ? "Finding your pick..." : "Find my pick"} <ArrowRight size={24} />
              </button>
              <p className="mt-3 text-center text-sm text-white/38"><Lock size={14} className="mr-2 inline text-amber-200" /> We will respect your mood and avoidances.</p>
            </div>
          </div>
        </section>

        <section id="how" className="mt-10 rounded-2xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
          <div className="mb-7 flex items-center justify-center gap-6 text-center text-xl text-amber-200">
            <span className="hidden h-px flex-1 bg-white/10 md:block" />
            It's simple. Three steps to stop scrolling.
            <span className="hidden h-px flex-1 bg-white/10 md:block" />
          </div>
          <div className="grid gap-8 lg:grid-cols-3">
            <div>
              <div className="mb-4 grid h-8 w-8 place-items-center rounded-full border border-red-400/50 text-amber-200">1</div>
              <h3 className="text-xl">Tell us the mood</h3>
              <p className="mt-2 text-white/56">Share how you feel, what you do not want, your time, and your subscriptions.</p>
            </div>
            <div>
              <div className="mb-4 grid h-8 w-8 place-items-center rounded-full border border-red-400/50 text-amber-200">2</div>
              <h3 className="text-xl">Get one pick</h3>
              <p className="mt-2 text-white/56">F.U.N searches for one match that fits the emotional job, not a list of twenty.</p>
              <div className="mt-5 flex overflow-hidden rounded-xl border border-white/10 bg-black/30">
                <div className="h-28 w-24 bg-cover bg-center" style={{ backgroundImage: `url('${pick.omdbPosterUrl ?? "/fun/story-stills-sheet.png"}')` }} />
                <div className="min-w-0 p-4">
                  <p className="font-serif text-xl text-white">{pick.title}</p>
                  <p className="mt-1 text-sm text-white/46">{pick.year} · {pick.runtime} · {pick.vibe.split(",")[0]}</p>
                  <p className="mt-2 line-clamp-2 text-sm text-white/58">{pick.oneLine}</p>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-4 grid h-8 w-8 place-items-center rounded-full border border-red-400/50 text-amber-200">3</div>
              <h3 className="text-xl">Watch on the right app</h3>
              <p className="mt-2 text-white/56">We tell you where it is available when we can verify it, so you can watch now.</p>
              <div className="mt-5 flex gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
                {["Netflix", "Prime Video", "Disney+", "Apple TV+", "HBO Max"].map((platform) => <PlatformChip key={platform} name={platform} />)}
              </div>
            </div>
          </div>
          <p className="mt-8 text-center text-white/46">One pick, verified where possible. No logins. No endless lists.</p>
        </section>
        <footer className="mt-8 flex flex-wrap items-center justify-center gap-6 border-t border-white/[0.06] pt-6 text-sm text-white/32">
          <Link href="/privacy" className="hover:text-white/60">Privacy</Link>
          <a href="mailto:feedback@findurnext.com" className="hover:text-white/60">Give feedback</a>
        </footer>
      </section>
    </main>
  );
}

function FilmIcon() {
  return <Monitor size={18} />;
}
