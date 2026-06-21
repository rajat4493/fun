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
  Play,
  Shield,
  Sparkles,
  Star,
} from "lucide-react";
import {
  defaultRecommendation,
  providerDetail,
  providerMark,
  providerTone,
  RecommendationSession,
  recommendationStorageKey,
  toTitleCase,
  watchProvidersFor,
} from "@/lib/recommendation-session";
import { Recommendation, WatchProvider } from "@/lib/types";

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
  const seed = `${title}-${year || ""}`.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const slot = seed % 8;
  const col = slot % 4;
  const row = Math.floor(slot / 4);
  const x = col === 0 ? 0 : col === 3 ? 100 : col * 33.333;
  const y = row === 0 ? 0 : 100;
  return (
    <div
      className={`bg-cover bg-no-repeat ${className}`}
      style={{
        backgroundImage: "url('/fun/story-stills-sheet.png')",
        backgroundPosition: artworkPosition ?? `${x}% ${y}%`,
        backgroundSize: "400% 200%",
      }}
    />
  );
}

function ProviderCard({ provider }: { provider: WatchProvider }) {
  const tone = providerTone(provider);
  const colorClass =
    tone === "blue" ? "text-blue-300" : tone === "red" ? "text-red-300" : tone === "teal" ? "text-teal-300" : "text-white";

  return (
    <div className="rounded-xl border border-white/12 bg-white/[0.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {provider.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={provider.logoUrl} alt={provider.name} className="h-12 w-12 rounded-lg object-contain" />
      ) : (
        <div className={`grid h-12 w-12 place-items-center rounded-lg bg-black/30 text-3xl font-black ${colorClass}`}>
          {providerMark(provider.name)}
        </div>
      )}
      <div className="mt-5 text-lg text-white">{provider.name}</div>
      <div className="mt-1 text-sm text-white/54">{providerDetail(provider)}</div>
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
  const [ready, setReady] = useState(false);
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      setNoSession(true);
    } else {
      setSession(s);
    }
    setReady(true);
  }, []);

  const pick: Recommendation = session?.recommendation ?? defaultRecommendation;
  const providers = useMemo(() => watchProvidersFor(pick), [pick]);
  const primaryVibe = toTitleCase(pick.vibe.split(",")[0] || pick.format);
  const verified = pick.whereToWatch.status === "verified";
  const hiddenTitles = pick.hiddenLayer.titles ?? [];

  const artworkPosition = useMemo(() => {
    const seed = `${pick.title}-${pick.year || ""}`.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    const slot = seed % 8;
    const col = slot % 4;
    const row = Math.floor(slot / 4);
    const x = col === 0 ? 0 : col === 3 ? 100 : col * 33.333;
    const y = row === 0 ? 0 : 100;
    return `${x}% ${y}%`;
  }, [pick.title, pick.year]);

  if (!ready) return null;

  if (noSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#030303] text-white">
        <div className="text-center">
          <div className="mb-4 text-5xl font-medium tracking-[0.34em]">
            F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
          </div>
          <h1 className="font-serif text-3xl text-white/80">No recommendation yet</h1>
          <p className="mt-3 text-base text-white/46">Pick your mood first and we'll find your one perfect match.</p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-3 rounded-xl bg-gradient-to-b from-red-500 to-red-900 px-6 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(127,29,29,0.45)] transition hover:brightness-110"
          >
            <Star size={18} />
            Pick your mood
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#030303] text-white">
      {pick.posterUrl ? (
        <div
          className="fixed inset-0 scale-110 bg-cover bg-center opacity-20 blur-2xl"
          style={{ backgroundImage: `url('${pick.posterUrl}')` }}
        />
      ) : (
        <div
          className="fixed inset-0 bg-cover bg-center opacity-60"
          style={{
            backgroundImage: "url('/fun/story-stills-sheet.png')",
            backgroundPosition: artworkPosition,
            backgroundSize: "400% 200%",
          }}
        />
      )}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_74%_24%,rgba(239,68,68,0.2),transparent_25%),linear-gradient(90deg,#030303_0%,rgba(3,3,3,0.78)_44%,rgba(3,3,3,0.9)_100%)]" />
      <div className="fixed inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#030303] to-transparent" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-[1760px] flex-col px-5 pb-8 pt-4 sm:px-8 lg:px-12">
        <header className="flex h-12 items-center justify-between border-b border-white/[0.07]">
          <Link href="/" className="flex items-center gap-4 text-white">
            <span className="text-3xl font-medium tracking-[0.34em]">
              F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/14 bg-white/[0.06] px-4 text-sm text-white/78 transition hover:border-white/28 hover:text-white"
          >
            <ArrowLeft size={16} />
            New mood
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-red-300/25 bg-red-500/12 px-3 py-1.5 text-sm text-red-100">
              <Star size={15} className="text-red-300" />
              Your one pick for tonight
            </div>

            <h1 className="font-serif text-[clamp(4rem,8vw,8.4rem)] font-normal uppercase leading-[0.86] tracking-normal text-white">
              {pick.title}
            </h1>

            <p className="mt-6 max-w-2xl text-2xl leading-8 text-white/78">{pick.oneLine}</p>

            <div className="mt-7 flex flex-wrap gap-3">
              <InfoPill icon={Calendar} label={pick.year} />
              <InfoPill icon={Film} label={pick.format} />
              <InfoPill icon={Clock3} label={pick.runtime} />
              <InfoPill icon={Heart} label={primaryVibe} />
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#watch"
                className="inline-flex h-12 items-center gap-3 rounded-lg bg-gradient-to-b from-red-500 to-red-900 px-6 font-semibold text-white shadow-[0_14px_40px_rgba(127,29,29,0.45)] transition hover:brightness-110"
              >
                <Play size={18} fill="currentColor" />
                Where to watch
              </a>
              <a
                href="#why"
                className="inline-flex h-12 items-center gap-3 rounded-lg border border-white/14 bg-white/[0.07] px-6 font-semibold text-white/88 transition hover:border-white/28 hover:bg-white/[0.1]"
              >
                <Sparkles size={18} />
                Why this pick
              </a>
            </div>
          </div>

          <div className="relative min-h-[520px]">
            <div className="absolute -inset-6 rounded-[2rem] bg-red-500/10 blur-3xl" />
            <div className="relative h-full min-h-[520px] overflow-hidden rounded-2xl border border-white/14 bg-white/[0.055] shadow-[0_28px_100px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.08)]">
              <MovieImage
                posterUrl={pick.posterUrl}
                title={pick.title}
                year={pick.year}
                artworkPosition={artworkPosition}
                className="absolute inset-0 h-full w-full"
                objectPosition="top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/12 to-transparent" />
              <div className="absolute left-5 top-5 rounded-full border border-white/14 bg-black/42 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/72">
                {pick.posterUrl ? "Poster via TMDB" : "Mood artwork"}
              </div>
              <Bookmark size={24} className="absolute right-5 top-5 text-white/70" />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/14 bg-black/44 px-3 py-1.5 text-sm text-white/76">
                    {pick.confidence}% match
                  </span>
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      verified
                        ? "border-emerald-300/28 bg-emerald-400/10 text-emerald-100"
                        : "border-white/14 bg-black/44 text-white/70"
                    }`}
                  >
                    {verified ? <BadgeCheck size={15} /> : <Shield size={15} />}
                    {verified ? "Availability verified" : "Availability not verified yet"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 border-t border-white/[0.08] pt-7 lg:grid-cols-[1fr_0.85fr_1fr]">
          <article id="why" className="rounded-2xl border border-white/10 bg-black/38 p-5">
            <h2 className="flex items-center gap-3 text-xl text-white">
              <Sparkles size={20} className="text-red-300" />
              Why it fits tonight
            </h2>
            <div className="mt-5 space-y-4">
              {pick.whyItFits.slice(0, 3).map((reason, index) => (
                <div key={reason} className="flex gap-4">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.07] text-sm text-white/74">
                    {index + 1}
                  </div>
                  <p className="text-base leading-6 text-white/72">{reason}</p>
                </div>
              ))}
            </div>
          </article>

          <article id="watch" className="rounded-2xl border border-white/10 bg-black/38 p-5">
            <h2 className="flex items-center gap-3 text-xl text-white">
              <BadgeCheck size={20} className={verified ? "text-emerald-300" : "text-white/48"} />
              Where to watch
            </h2>
            <p className="mt-3 text-sm leading-5 text-white/56">{pick.whereToWatch.note}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {providers.slice(0, 3).map((provider) => (
                <ProviderCard
                  key={`${provider.name}-${provider.access}-${provider.price || provider.note || ""}`}
                  provider={provider}
                />
              ))}
            </div>
            {pick.tmdbAttribution && (
              <p className="mt-4 text-xs text-white/30">{pick.tmdbAttribution}</p>
            )}
          </article>

          {/* Hidden Layer — amber accent, the emotional/share hook */}
          <article className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.05] p-5 shadow-[0_0_40px_rgba(251,191,36,0.06)]">
            <h2 className="flex items-center gap-3 text-xl text-white">
              <Layers size={20} className="text-amber-300" />
              {pick.hiddenLayer.headline}
            </h2>
            <p className="mt-3 text-base leading-6 text-white/72">{pick.hiddenLayer.insight}</p>

            {hiddenTitles.length > 0 ? (
              <div className="mt-4 flex gap-3">
                {hiddenTitles.map((ht) => (
                  <div key={`${ht.title}-${ht.year}`} className="relative h-[156px] w-[104px] shrink-0 overflow-hidden rounded-xl border border-amber-400/20">
                    <MovieImage
                      posterUrl={ht.posterUrl}
                      title={ht.title}
                      year={ht.year}
                      className="absolute inset-0 h-full w-full"
                      objectPosition="top"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-2">
                      <p className="line-clamp-2 text-xs font-medium leading-tight text-white">{ht.title}</p>
                      {ht.platform && <p className="mt-0.5 truncate text-xs text-amber-300/80">{ht.platform}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-amber-400/15 bg-black/28 p-4 text-sm leading-5 text-amber-200/60">
                {pick.hiddenLayer.classyJab}
              </p>
            )}
          </article>
        </section>

        <section className="pt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl text-white">If you want a nearby mood</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {pick.alternatives.slice(0, 3).map((alternative, i) => {
              const [titlePart] = alternative.split(" (");
              const yearMatch = alternative.match(/\((\d{4})\)/);
              const year = yearMatch?.[1] ?? "";
              const posterUrl = pick.alternativePosterUrls?.[i];
              return (
                <div
                  key={alternative}
                  className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.05]"
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
                </div>
              );
            })}
          </div>
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4 text-sm text-white/42">
          <span>One pick, verified where possible, no accounts.</span>
          <Link href="/" className="inline-flex items-center gap-2 text-white/68 hover:text-white">
            Refine mood
            <ChevronRight size={16} />
          </Link>
        </footer>
      </section>
    </main>
  );
}
