"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Ban,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock3,
  Droplet,
  Film,
  Flame,
  Ghost,
  Heart,
  Layers,
  Lock,
  Monitor,
  PenLine,
  Play,
  Search,
  Shield,
  Smile,
  Sparkles,
  Star,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import OnboardingFlow, { loadOnboarding, OnboardingData } from "@/components/OnboardingFlow";
import { createRecommendationSession, loadSeenTitles, recommendationStorageKey } from "@/lib/recommendation-session";
import { RecommendRequest, Recommendation, WatchProvider } from "@/lib/types";

type IconType = typeof User;

type PickerOption = {
  label: string;
  icon: IconType;
};

const moodOptions: PickerOption[] = [
  { label: "tired", icon: Smile },
  { label: "horny", icon: Flame },
  { label: "happy", icon: Smile },
  { label: "lonely", icon: User },
  { label: "nostalgic", icon: Clock3 },
];

const avoidOptions: PickerOption[] = [
  { label: "violence", icon: Shield },
  { label: "gore", icon: Droplet },
  { label: "heavy drama", icon: Shield },
  { label: "horror", icon: Ghost },
];

const wantOptions: PickerOption[] = [
  { label: "emotional", icon: Heart },
  { label: "funny", icon: Smile },
  { label: "sexy", icon: Sparkles },
  { label: "comforting", icon: Heart },
  { label: "weird", icon: Ghost },
];

const timeOptions: PickerOption[] = [
  { label: "90 min", icon: Clock3 },
  { label: "under 2 hours", icon: Clock3 },
  { label: "one episode", icon: Monitor },
  { label: "no preference", icon: Sparkles },
];

const defaultPick: Recommendation = {
  title: "Afterglow",
  year: "2024",
  format: "Film",
  runtime: "1h 46m",
  vibe: "moody, intimate, elegant",
  confidence: 91,
  oneLine: "Two strangers. One night. Everything changes.",
  whyItFits: [
    "It has the emotional pull you asked for without turning heavy.",
    "It fits a short evening window and keeps the choice simple.",
    "It feels premium and specific instead of algorithmically generic.",
  ],
  whereToWatch: {
    status: "unverified",
    primary: "Availability not verified",
    note: "Generate a pick to see where to watch.",
  },
  hiddenLayer: {
    headline: "What your current platforms are missing",
    insight: "Generate a pick and F.U.N will reveal what your subscriptions aren't showing you.",
    classyJab: "Your taste may be wider than your current subscriptions.",
  },
  alternatives: [],
};

function toTitleCase(value: string) {
  return value.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function providerMark(name: string) {
  if (name.startsWith("+")) return name;
  if (name.toLowerCase().startsWith("availability")) return "?";
  return name.charAt(0).toUpperCase();
}

function providerTone(provider: WatchProvider): "blue" | "red" | "teal" | "plain" {
  if (provider.access === "rent") return "red";
  if (provider.access === "buy") return "teal";
  if (provider.access === "included" || provider.access === "subscription") return "blue";
  return "plain";
}

function providerDetail(provider: WatchProvider) {
  if (provider.note) return provider.note;
  if (provider.price) return provider.price;
  if (provider.access === "included") return "Included";
  if (provider.access === "subscription") return "Subscription";
  if (provider.access === "rent") return "Rent";
  if (provider.access === "buy") return "Buy";
  return "Check provider";
}

function MovieImage({
  posterUrl,
  title,
  year,
  className = "",
  objectPosition = "center",
}: {
  posterUrl?: string;
  title: string;
  year?: string;
  className?: string;
  objectPosition?: string;
}) {
  if (posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={posterUrl} alt={title} className={`object-cover ${className}`} style={{ objectPosition }} />;
  }
  void year;
  return <div className={`bg-gradient-to-br from-[#1a1625] via-[#12141c] to-[#0a0b10] ${className}`} />;
}

function OptionButton({ option, active, onClick }: { option: PickerOption; active: boolean; onClick: () => void }) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-9 min-w-0 items-center gap-2 rounded-lg border px-4 text-sm text-white transition ${
        active
          ? "border-red-400/70 bg-red-500/16 shadow-[0_0_28px_rgba(239,68,68,0.26)]"
          : "border-white/12 bg-white/[0.055] hover:border-white/28 hover:bg-white/[0.09]"
      }`}
    >
      <Icon size={17} className={active ? "text-red-200" : "text-white/82"} />
      <span className="truncate">{option.label}</span>
    </button>
  );
}

function ProviderCard({ provider }: { provider: WatchProvider }) {
  const tone = providerTone(provider);
  const colorClass =
    tone === "blue" ? "text-blue-300" : tone === "red" ? "text-red-300" : tone === "teal" ? "text-teal-300" : "text-white";

  return (
    <div className="flex h-[132px] w-[84px] flex-col items-center justify-center rounded-xl border border-white/12 bg-white/[0.055] px-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {provider.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={provider.logoUrl} alt={provider.name} className="h-10 w-10 rounded-lg object-contain" />
      ) : (
        <div className={`text-4xl font-black ${colorClass}`}>{providerMark(provider.name)}</div>
      )}
      <div className="mt-2 text-sm text-white">{provider.name}</div>
      <div className={tone === "red" ? "mt-1 text-xs text-red-300" : "mt-1 text-xs text-white/54"}>{providerDetail(provider)}</div>
    </div>
  );
}

function AlternativeCard({ title, posterUrl, meta }: { title: string; posterUrl?: string; meta: string }) {
  return (
    <article className="group relative h-[192px] w-[128px] shrink-0 overflow-hidden rounded-xl border border-white/12 bg-white/[0.055]">
      <MovieImage
        posterUrl={posterUrl}
        title={title}
        className="absolute inset-0 h-full w-full transition duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-3">
        <h4 className="line-clamp-2 font-serif text-sm uppercase leading-tight tracking-[0.08em] text-white">{title}</h4>
        {meta && <p className="mt-1 text-xs text-white/55">{meta}</p>}
      </div>
    </article>
  );
}

const CAROUSEL_MOODS = ["exhausted", "nostalgic", "restless", "wired", "lonely", "content", "anxious", "hopeful"];
const CAROUSEL_VIBES = [
  "visually stunning",
  "quietly moving",
  "darkly funny",
  "wildly weird",
  "warmly comforting",
  "emotionally raw",
  "like Parasite but lighter",
  "like Baby Driver but funny",
  "in the spirit of Her",
];

function SelfDescribeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const [moodIdx, setMoodIdx] = useState(0);
  const [vibeIdx, setVibeIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setMoodIdx((i) => (i + 1) % CAROUSEL_MOODS.length);
        setVibeIdx((i) => (i + 1) % CAROUSEL_VIBES.length);
        setVisible(true);
      }, 250);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={4}
        className="w-full resize-none rounded-xl border border-white/12 bg-black/24 px-4 py-3.5 text-sm text-white outline-none placeholder:text-transparent focus:border-red-300/50"
      />
      {!value && !focused && (
        <div className="pointer-events-none absolute inset-0 flex flex-wrap items-start gap-x-1 px-4 py-3.5 text-sm text-white/36">
          <span>I'm</span>
          <span
            className="text-white/62 transition-opacity duration-300"
            style={{ opacity: visible ? 1 : 0 }}
          >
            {CAROUSEL_MOODS[moodIdx]}
          </span>
          <span>— want something</span>
          <span
            className="text-white/62 transition-opacity duration-300"
            style={{ opacity: visible ? 1 : 0 }}
          >
            {CAROUSEL_VIBES[vibeIdx]}
          </span>
        </div>
      )}
    </div>
  );
}

function toggleList(value: string, list: string[], setter: (next: string[]) => void) {
  setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
}

export default function Home() {
  const router = useRouter();
  const resultRef = useRef<HTMLDivElement>(null);
  const alternativesScrollRef = useRef<HTMLDivElement>(null);

  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [onboardingReady, setOnboardingReady] = useState(false);

  const [mode, setMode] = useState<"choose" | "self">("choose");
  const [moods, setMoods] = useState(["tired"]);
  const [avoids, setAvoids] = useState(["violence"]);
  const [wants, setWants] = useState(["emotional"]);
  const [time, setTime] = useState(["90 min"]);
  const [selfText, setSelfText] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<Recommendation>(defaultPick);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<"mine" | "any">("any");

  useEffect(() => {
    const saved = loadOnboarding();
    setOnboarding(saved);
    setOnboardingReady(true);

    try {
      const raw = localStorage.getItem(recommendationStorageKey);
      if (raw) {
        const session = JSON.parse(raw);
        if (session?.recommendation) {
          setPick(session.recommendation);
          setHasGenerated(true);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const promptPreview = useMemo(() => {
    if (mode === "self" && selfText.trim()) return selfText.trim();
    return [
      moods.length ? `I'm ${moods.join(" and ")}` : "I'm open",
      wants.length ? `I want ${wants.join(", ")}` : "I want something good",
      avoids.length ? `I don't want ${avoids.join(", ")}` : "",
      time.length ? `I have ${time.join(" or ")}` : "I have the evening",
    ].filter(Boolean).join(". ");
  }, [mode, selfText, moods, wants, avoids, time]);

  const watchProviders = useMemo<WatchProvider[]>(() => {
    if (pick.whereToWatch.providers?.length) return pick.whereToWatch.providers;
    return [
      {
        name: pick.whereToWatch.status === "verified" ? pick.whereToWatch.primary : "Availability",
        access: "unknown",
        note: pick.whereToWatch.status === "verified" ? pick.whereToWatch.note : "Not verified yet",
      },
    ];
  }, [pick.whereToWatch]);

  async function findPick() {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 80000);

    const now = new Date();
    const hour = now.getHours();
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
    const timeOfDay = hour < 6 ? "late night / early hours" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "late night";
    const month = now.getMonth();
    const season = month < 3 || month === 11 ? "winter" : month < 6 ? "spring" : month < 9 ? "summer" : "autumn";
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const contextHint = `${isWeekend ? "Weekend" : "Weekday"} ${timeOfDay} (${dayName}), ${season}`;

    const requestInput: RecommendRequest = {
      mode,
      mood: mode === "choose" ? moods : undefined,
      wants: mode === "choose" ? wants : undefined,
      avoids: mode === "choose" ? avoids : undefined,
      time: mode === "choose" && time[0] && time[0] !== "no preference" ? time[0] : undefined,
      country: onboarding?.country || "Poland",
      platforms: onboarding?.platforms || ["Netflix", "Prime Video"],
      selfText: mode === "self" ? selfText : undefined,
      reference: reference.trim() || undefined,
      seenTitles: loadSeenTitles(),
      platformFilter,
      contextHint,
    };

    // Navigate immediately — recommendation page shows cinematic loading state
    localStorage.setItem("fun:loading", "true");
    localStorage.setItem("fun:loading-started-at", String(Date.now()));
    localStorage.removeItem("fun:recommendation-error");
    router.push("/recommendation");

    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestInput),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not generate a pick.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as any;
      const batch: Recommendation[] = data._batch ?? [data];
      localStorage.setItem(
        recommendationStorageKey,
        JSON.stringify(createRecommendationSession(batch[0], requestInput, batch)),
      );
    } catch (unknownError) {
      localStorage.setItem(
        "fun:recommendation-error",
        unknownError instanceof Error && unknownError.name === "AbortError"
          ? "The recommendation took too long. Please try again."
          : unknownError instanceof Error ? unknownError.message : "Something went wrong.",
      );
    } finally {
      window.clearTimeout(timeout);
      localStorage.removeItem("fun:loading");
      localStorage.removeItem("fun:loading-started-at");
      setLoading(false);
    }
  }

  if (!onboardingReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#030303] text-white">
        <div className="text-center">
          <div className="text-3xl font-medium tracking-[0.34em]">
            F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
          </div>
          <p className="mt-4 text-sm text-white/45">Preparing your one pick.</p>
        </div>
      </main>
    );
  }
  if (!onboarding) return <OnboardingFlow onComplete={(data) => setOnboarding(data)} />;

  const hiddenTitles = pick.hiddenLayer.titles ?? [];

  return (
    <main className="min-h-screen overflow-hidden bg-[#030303] text-white">
      <div
        className="absolute inset-x-0 top-0 h-[63vh] min-h-[500px] bg-cover bg-center opacity-88"
        style={{ backgroundImage: "url('/fun/hero-cinematic.png')" }}
      />
      <div className="absolute inset-x-0 top-0 h-[63vh] min-h-[500px] bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.05),rgba(0,0,0,0.52)_58%,rgba(0,0,0,0.92)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[63vh] min-h-[500px] bg-gradient-to-b from-black/30 via-black/18 to-[#030303]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#030303_0%,rgba(3,3,3,0.25)_26%,rgba(3,3,3,0.18)_62%,#030303_100%)]" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-[1780px] flex-col px-5 pb-5 pt-4 sm:px-8 lg:px-12">
        <header className="flex h-12 items-center justify-between border-b border-white/[0.07]">
          <div className="text-3xl font-medium tracking-[0.34em] text-white">
            F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
          </div>

          <nav className="hidden items-center gap-9 text-base text-white/76 md:flex">
            <span className="relative text-red-400">
              Home
              <span className="absolute -bottom-4 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-red-500" />
            </span>
          </nav>

          <div className="flex items-center gap-5">
            <Search size={24} className="text-white" />
            <div className="hidden h-8 w-px bg-white/12 sm:block" />
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-white/20 bg-white/10 text-sm font-semibold">
                {onboarding.countryCode}
              </div>
              <span className="hidden text-sm text-white/82 sm:inline">{onboarding.country}</span>
              <ChevronDown size={15} className="hidden text-white/72 sm:block" />
            </div>
          </div>
        </header>

        <section className="mx-auto mt-11 w-full max-w-5xl text-center">
          <h1 className="font-serif text-[clamp(3rem,5.6vw,5.95rem)] font-normal leading-[0.95] tracking-normal text-white">
            One perfect pick.
            <br />
            No more scrolling.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-6 text-white/72">
            Mood-based recommendations. Streaming intelligence.
            <br className="hidden sm:block" />
            One perfect match, just for you.
          </p>
        </section>

        <section className="mx-auto mt-5 w-full max-w-[1040px] rounded-2xl border border-white/18 bg-[#111315]/78 p-3 shadow-[0_22px_90px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
          <div className="mx-auto grid max-w-[420px] grid-cols-2 rounded-xl border border-white/12 bg-white/[0.055] p-1">
            <button
              type="button"
              onClick={() => setMode("choose")}
              className={`flex h-9 items-center justify-center gap-2 rounded-lg text-sm transition ${
                mode === "choose"
                  ? "bg-red-500/28 text-white shadow-[0_0_24px_rgba(239,68,68,0.32)] ring-1 ring-red-400/45"
                  : "text-white/72"
              }`}
            >
              <Star size={16} className="text-red-300" />
              Choose
            </button>
            <button
              type="button"
              onClick={() => setMode("self")}
              className={`flex h-9 items-center justify-center gap-2 rounded-lg text-sm transition ${
                mode === "self"
                  ? "bg-red-500/28 text-white shadow-[0_0_24px_rgba(239,68,68,0.32)] ring-1 ring-red-400/45"
                  : "text-white/72"
              }`}
            >
              <PenLine size={16} />
              Self-describe
            </button>
          </div>

          {mode === "choose" ? (
            <div className="mt-4 grid gap-3 px-2 pb-1 sm:grid-cols-[104px_1fr] sm:items-start">
              <div className="flex h-9 items-center gap-3 text-sm text-white">
                <User size={19} />
                <span>I'm</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                {moodOptions.map((option) => (
                  <OptionButton key={option.label} option={option} active={moods.includes(option.label)} onClick={() => toggleList(option.label, moods, setMoods)} />
                ))}
              </div>

              <div className="flex h-9 items-center gap-3 text-sm text-white">
                <Ban size={19} />
                <span>I don't want</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {avoidOptions.map((option) => (
                  <OptionButton key={option.label} option={option} active={avoids.includes(option.label)} onClick={() => toggleList(option.label, avoids, setAvoids)} />
                ))}
              </div>

              <div className="flex h-9 items-center gap-3 text-sm text-white">
                <Heart size={19} />
                <span>I want</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                {wantOptions.map((option) => (
                  <OptionButton key={option.label} option={option} active={wants.includes(option.label)} onClick={() => toggleList(option.label, wants, setWants)} />
                ))}
              </div>

              <div className="flex h-9 items-center gap-3 text-sm text-white">
                <Clock3 size={19} />
                <span>Time</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {timeOptions.map((option) => (
                  <OptionButton key={option.label} option={option} active={time.includes(option.label)} onClick={() => setTime([option.label])} />
                ))}
              </div>

              <div className="flex h-9 items-center gap-3 text-sm text-white/70">
                <Film size={19} />
                <span className="whitespace-nowrap">In the spirit of</span>
              </div>
              <div className="relative">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. Baby Driver, Parasite, Her… (optional)"
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/22"
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 px-2 pb-1">
              <SelfDescribeInput value={selfText} onChange={setSelfText} />
            </div>
          )}

          <div className="mt-4 px-2">
            <p className="mb-2 text-xs uppercase tracking-widest text-white/28">Search within</p>
            <div className="flex w-fit rounded-xl border border-white/[0.1] bg-black/30 p-1">
              <button
                type="button"
                onClick={() => setPlatformFilter("any")}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition ${
                  platformFilter === "any"
                    ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "text-white/38 hover:text-white/60"
                }`}
              >
                All cinema
              </button>
              <button
                type="button"
                onClick={() => setPlatformFilter("mine")}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition ${
                  platformFilter === "mine"
                    ? "bg-emerald-500/18 text-emerald-100 shadow-[inset_0_1px_0_rgba(52,211,153,0.1)]"
                    : "text-white/38 hover:text-white/60"
                }`}
              >
                My subscriptions
              </button>
            </div>
            <p className="mt-1.5 text-xs text-white/28">
              {platformFilter === "mine"
                ? `Picks from: ${(onboarding?.platforms ?? []).slice(0, 3).join(" · ")}`
                : "Includes films outside your current apps"}
            </p>
          </div>

          <div className="mt-3 grid gap-3 px-2 sm:grid-cols-[1fr_220px]">
            {mode === "choose" && (
              <div className="relative">
                <input
                  value={promptPreview}
                  readOnly
                  className="h-12 w-full rounded-lg border border-white/10 bg-black/16 px-4 pr-11 text-sm text-white/60 outline-none"
                />
                <Sparkles size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
              </div>
            )}
            <button
              type="button"
              onClick={findPick}
              disabled={loading}
              className={`flex h-12 items-center justify-center gap-3 rounded-lg bg-gradient-to-b from-red-500 to-red-900 px-6 font-semibold text-white shadow-[0_12px_30px_rgba(127,29,29,0.45)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70 ${mode === "self" ? "col-span-full sm:col-span-1 sm:col-start-2" : ""}`}
            >
              {loading ? "Finding..." : "Find my pick"}
              <ArrowRight size={20} />
            </button>
          </div>
          <div className="min-h-9 px-3 pt-3 text-sm">
            {loading && (
              <p className="inline-flex items-center gap-2 text-white/70">
                <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.85)]" />
                Finding one match for tonight...
              </p>
            )}
            {!loading && hasGenerated && !error && (
              <p className="text-white/64">
                Your pick is ready: <span className="text-white">{pick.title}</span>
              </p>
            )}
            {error && <p className="text-red-200">{error}</p>}
          </div>
        </section>

        <section className="mt-auto grid gap-7 pt-8 lg:grid-cols-[1fr_0.72fr_1fr] lg:items-start">
          <div ref={resultRef} className="min-w-0 scroll-mt-8">
            <h2 className="mb-3 flex items-center gap-3 text-lg text-white">
              <Star size={20} className="text-red-400" />
              {hasGenerated ? "Your One Pick" : "Tonight's Pick"}
            </h2>
            <article
              className={`relative h-[164px] overflow-hidden rounded-xl border bg-white/[0.045] transition ${
                hasGenerated ? "border-red-300/35 shadow-[0_0_44px_rgba(239,68,68,0.16)]" : "border-white/14"
              }`}
            >
              <MovieImage
                posterUrl={pick.omdbPosterUrl}
                title={pick.title}
                year={pick.year}
                className="absolute inset-y-0 left-0 h-full w-[48%] opacity-92"
                objectPosition="top"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/12 via-[#0b0b0d]/72 to-[#0b0b0d]" />
              <Bookmark size={22} className="absolute right-5 top-5 text-white/64" />
              <div className="absolute bottom-5 left-[48%] right-6 top-5">
                <h3 className="font-serif text-2xl uppercase tracking-[0.14em] text-white">{pick.title}</h3>
                <p className="mt-2 text-sm text-white/56">
                  {pick.year} <span className="px-2">-</span> {toTitleCase(pick.vibe.split(",")[0] || pick.format)}{" "}
                  <span className="px-2">-</span> {pick.runtime}
                </p>
                <p className="mt-3 line-clamp-2 text-sm leading-5 text-white/68">{pick.oneLine}</p>
                <button
                  type="button"
                  onClick={() => setShowWhy((open) => !open)}
                  className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-white/12 bg-white/[0.075] px-4 text-sm text-white/88"
                >
                  <Play size={15} fill="currentColor" />
                  {showWhy ? "Hide why" : "Why this pick?"}
                </button>
              </div>
            </article>
            {showWhy && (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/32 p-4 text-sm leading-5 text-white/70">
                <div className="mb-2 flex items-center gap-2 text-white">
                  <Sparkles size={16} className="text-red-300" />
                  Why it fits tonight
                </div>
                <div className="space-y-2">
                  {pick.whyItFits.slice(0, 3).map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-white/12 lg:border-x lg:px-6">
            <h2 className="mb-3 flex items-center gap-3 text-lg text-white">
              <Sparkles size={20} className="text-red-400" />
              Where to Watch
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-1">
              {watchProviders.slice(0, 3).map((provider) => (
                <ProviderCard
                  key={`${provider.name}-${provider.access}-${provider.price || provider.note || ""}`}
                  provider={provider}
                />
              ))}
              {watchProviders.length > 3 && (
                <div className="flex h-[132px] w-[84px] flex-col items-center justify-center rounded-xl border border-white/12 bg-white/[0.055] px-2 text-center">
                  <div className="text-2xl font-black text-white">{`+${watchProviders.length - 3}`}</div>
                  <div className="mt-2 text-sm text-white">More</div>
                </div>
              )}
            </div>
          </div>

          {/* Hidden Layer — distinct amber treatment, the emotional hook + share trigger */}
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-3 text-lg text-white">
                <Flame size={20} className="text-amber-400" />
                {pick.hiddenLayer.headline}
              </h2>
              {hasGenerated && (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                  not on your apps
                </span>
              )}
            </div>
            <p className="mb-3 text-sm text-white/58">{pick.hiddenLayer.insight}</p>

            {hiddenTitles.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {hiddenTitles.map((ht) => (
                  <article
                    key={`${ht.title}-${ht.year}`}
                    className="relative min-w-[120px] overflow-hidden rounded-xl border border-amber-400/20 bg-amber-500/[0.06] shadow-[0_0_24px_rgba(251,191,36,0.06)]"
                  >
                    <div className="relative h-[140px] w-[120px] overflow-hidden">
                      <MovieImage
                        posterUrl={ht.posterUrl}
                        title={ht.title}
                        year={ht.year}
                        className="absolute inset-0 h-full w-full opacity-90"
                      />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/12 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <h4 className="font-serif text-sm uppercase leading-tight tracking-[0.1em] text-white">{ht.title}</h4>
                      {ht.platform && <p className="mt-0.5 text-xs text-amber-300/80">{ht.platform}</p>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-amber-400/15 bg-amber-500/[0.05] px-4 py-3 text-sm italic text-amber-200/60">
                {pick.hiddenLayer.classyJab}
              </p>
            )}
          </div>
        </section>

        {pick.alternatives.length > 0 && (
          <section className="pt-3">
            <h2 className="mb-3 flex items-center gap-2 text-lg text-white">
              More picks you'll love
              <ChevronRight size={19} />
            </h2>
            <div className="flex items-end gap-3">
              <div ref={alternativesScrollRef} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                {pick.alternatives.map((alt, i) => {
                  const [titlePart] = alt.split(" (");
                  const yearMatch = alt.match(/\((\d{4})\)/);
                  const year = yearMatch?.[1] ?? "";
                  return (
                    <AlternativeCard
                      key={`${alt}-${i}`}
                      title={titlePart}
                      posterUrl={pick.alternativePosterUrls?.[i]}
                      meta={year}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => alternativesScrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })}
                className="mb-2 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/14 bg-white/[0.06] text-white transition hover:bg-white/[0.12]"
              >
                <ChevronRight size={22} />
              </button>
            </div>
          </section>
        )}

        <footer className="grid gap-4 border-t border-white/[0.08] py-3 text-sm text-white/45 sm:grid-cols-4">
          <span className="flex items-center justify-center gap-3">
            <Layers size={18} /> All your services in one place
          </span>
          <span className="flex items-center justify-center gap-3">
            <Heart size={18} /> Personalized to your mood
          </span>
          <span className="flex items-center justify-center gap-3">
            <Clock3 size={18} /> Saves you time, every time
          </span>
          <span className="flex items-center justify-center gap-3">
            <Lock size={18} /> Privacy-first by design
          </span>
        </footer>
      </section>
    </main>
  );
}
