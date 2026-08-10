"use client";

import { useEffect, useMemo, useState } from "react";

// Stage keys match route.ts's real emitStage checkpoints (see recommendation/page.tsx's
// LOADING_STAGE_KEY polling) — this component never simulates or advances a stage on its own.
export type LoadingStage = "understanding" | "checking-fit" | "verifying";

type RecommendationLoadingScreenProps = {
  stage: LoadingStage;
};

const STAGE_TEXT: Record<LoadingStage, string> = {
  understanding: "Understanding your mood",
  "checking-fit": "Checking the fit",
  verifying: "Verifying availability",
};

type LoadingLine = { title: string; line: string };

// Ambient film-language only — a witty, recognisable title + mood pairing rotating behind the real
// status line above. Never a claim that the system is literally searching each title; the actual
// backend stage is shown separately and only ever advances on real events (see STAGE_TEXT).
const LOADING_LINES: LoadingLine[] = [
  { title: "Parasite", line: "for the perfect trap" },
  { title: "The Bear", line: "for pressure" },
  { title: "Fleabag", line: "for bite" },
  { title: "Past Lives", line: "for impossible timing" },
  { title: "The Godfather", line: "for family pressure" },
  { title: "Moonlight", line: "for quiet ache" },
  { title: "Before Sunrise", line: "for one-night magic" },
  { title: "The Handmaiden", line: "for elegant danger" },
  { title: "Super Deluxe", line: "for beautiful chaos" },
  { title: "A Separation", line: "for moral tension" },

  { title: "Knives Out", line: "for a stylish mess" },
  { title: "The Menu", line: "for a very bad dinner reservation" },
  { title: "Paddington 2", line: "for kindness, actually" },
  { title: "Derry Girls", line: "for glorious chaos" },
  { title: "The Good Place", line: "for existential snacks" },
  { title: "Severance", line: "for work-life horror" },
  { title: "Succession", line: "for family brunch with knives" },
  { title: "The Office", line: "for a meeting that could have been an email" },
  { title: "Hot Fuzz", line: "for an extremely serious village" },
  { title: "What We Do in the Shadows", line: "for flatmates with fangs" },

  { title: "The Princess Bride", line: "for true love and minor swordplay" },
  { title: "My Cousin Vinny", line: "for courtroom confidence" },
  { title: "The Grand Budapest Hotel", line: "for immaculate chaos" },
  { title: "Clueless", line: "for excellent judgment, eventually" },
  { title: "Bridesmaids", line: "for friendship under pressure" },
  { title: "The Devil Wears Prada", line: "for a little professional terror" },
  { title: "Schitt's Creek", line: "for finding your people" },
  { title: "Ted Lasso", line: "for hope with a whistle" },
  { title: "Taskmaster", line: "for nonsense taken seriously" },
  { title: "The IT Crowd", line: "for one more perfectly avoidable disaster" },

  { title: "Spirited Away", line: "for wonder with teeth" },
  { title: "Amélie", line: "for small acts of magic" },
  { title: "The Secret Life of Walter Mitty", line: "for leaving the map behind" },
  { title: "Arrival", line: "for feelings beyond language" },
  { title: "Her", line: "for a very modern loneliness" },
  { title: "About Time", line: "for the moments you would keep" },
  { title: "The Holdovers", line: "for warmth in the wrong season" },
  { title: "Little Miss Sunshine", line: "for joy in a yellow van" },
  { title: "Aftersun", line: "for the ache after a good day" },
  { title: "The Truman Show", line: "for when something feels off" },

  { title: "Get Out", line: "for a weekend that gets complicated" },
  { title: "The White Lotus", line: "for a holiday with consequences" },
  { title: "Black Mirror", line: "for one more reason to fear your phone" },
  { title: "Gone Girl", line: "for date-night trust issues" },
  { title: "Saltburn", line: "for manners, money, and mayhem" },
  { title: "The Dark Knight", line: "for chaos with a plan" },
  { title: "Midsommar", line: "for sunshine and terrible decisions" },
  { title: "The Last of Us", line: "for love at the end of everything" },
  { title: "Andor", line: "for rebellion done properly" },
  { title: "Mad Max: Fury Road", line: "for a very direct route forward" },

  { title: "Interstellar", line: "for feelings at cosmic scale" },
  { title: "Blade Runner 2049", line: "for beautiful existential weather" },
  { title: "Everything Everywhere All at Once", line: "for when life opens too many tabs" },
  { title: "The Matrix", line: "for a suspiciously ordinary Tuesday" },
  { title: "Dune", line: "for destiny, dust, and drama" },
  { title: "Poor Things", line: "for becoming gloriously yourself" },
  { title: "The Fall Guy", line: "for romance with stunt work" },
  { title: "Ratatouille", line: "for a little ambition in the kitchen" },
  { title: "The Lord of the Rings", line: "for the long way home" },
  { title: "The Mitchells vs. the Machines", line: "for family versus everything" },
];

const CARD_INTERVAL_MS = 3800;
const ROW_HEIGHT = "clamp(104px, 16vw, 196px)";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function RecommendationLoadingScreen({ stage }: RecommendationLoadingScreenProps) {
  // Shuffled once per mount (one per loading session) — cycling through never repeats a title until
  // the whole list is exhausted, which real request timings (a few seconds to low tens of seconds)
  // never come close to reaching.
  const lines = useMemo(() => shuffle(LOADING_LINES), []);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const motionOff = paused || reducedMotion;

  useEffect(() => {
    if (motionOff) return;
    const interval = setInterval(() => setIndex((i) => i + 1), CARD_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [motionOff]);

  return (
    <main className="relative flex h-dvh min-h-screen w-full flex-col overflow-hidden bg-[#030303] text-white">
      <AmbientCinemaLight active={!motionOff} />

      <div className="relative z-20 flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <span className="text-xl font-medium tracking-[0.3em] text-white/90 sm:text-2xl">
          F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
        </span>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="rounded-full border border-white/15 bg-black/30 px-3 py-1.5 text-[11px] font-medium text-white/60 backdrop-blur transition hover:border-white/25 hover:text-white/85"
        >
          {paused ? "Resume motion" : "Pause motion"}
        </button>
      </div>

      <div className="relative z-20 mt-3 flex items-center justify-center gap-2 px-6 text-center text-xs text-white/55 sm:text-sm">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.85)] motion-safe:animate-pulse" />
        <span aria-live="polite">{STAGE_TEXT[stage]}</span>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 sm:px-10">
        <span className="mb-1 text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300/90 sm:mb-2">
          Searching
        </span>
        <div
          className="relative w-full max-w-xl overflow-hidden"
          style={{ height: `calc(${ROW_HEIGHT} * 3)` }}
        >
          <div
            className="absolute inset-x-0"
            style={{
              top: ROW_HEIGHT,
              transform: `translateY(calc(${ROW_HEIGHT} * ${-index}))`,
              transitionProperty: "transform",
              transitionDuration: motionOff ? "0ms" : "1100ms",
              transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {lines.map((item, i) => {
              const distance = i - index;
              if (Math.abs(distance) > 2) {
                return <div key={item.title} style={{ height: ROW_HEIGHT }} />;
              }
              return <CarouselRow key={item.title} item={item} distance={distance} motionOff={motionOff} />;
            })}
          </div>

          {!motionOff && (
            <div key={index} aria-hidden className="light-sweep pointer-events-none absolute inset-0 motion-safe:animate-[lightSweep_1100ms_ease-out]" />
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-[#030303] to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#030303] to-transparent" />
        </div>
      </div>

      <div className="relative z-20 h-[max(2rem,env(safe-area-inset-bottom))] sm:h-10" aria-hidden />
    </main>
  );
}

function CarouselRow({ item, distance, motionOff }: { item: LoadingLine; distance: number; motionOff: boolean }) {
  const isCenter = distance === 0;
  const abs = Math.abs(distance);
  const scale = isCenter ? 1 : abs === 1 ? 0.74 : 0.56;
  const opacity = isCenter ? 1 : abs === 1 ? 0.3 : 0.08;
  const blur = isCenter ? 0 : abs === 1 ? 3 : 6;
  const rotateX = isCenter ? 0 : distance < 0 ? 16 : -16;

  return (
    <div
      className="flex flex-col items-center justify-center px-4 text-center"
      style={{
        height: ROW_HEIGHT,
        opacity,
        filter: `blur(${blur}px)`,
        transform: `perspective(1000px) rotateX(${rotateX}deg) translateZ(${isCenter ? 0 : -160}px) scale(${scale})`,
        transitionProperty: motionOff ? "none" : "opacity, filter, transform",
        transitionDuration: motionOff ? "0ms" : "1100ms",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-hidden={!isCenter}
    >
      <span
        className={
          "select-none font-serif leading-[1.02] text-white " +
          (isCenter ? "text-[11.5vw] sm:text-6xl md:text-7xl" : "text-[7vw] sm:text-3xl md:text-4xl")
        }
      >
        {item.title}
      </span>
      <span className={"mt-1.5 italic text-white/55 sm:mt-2 " + (isCenter ? "text-base sm:text-lg" : "text-xs sm:text-sm text-white/30")}>
        {item.line}
      </span>
    </div>
  );
}

const GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix type='matrix' values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(%23n)'/></svg>";

function AmbientCinemaLight({ active }: { active: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className={"absolute inset-0" + (active ? " bloom-pulse" : "")}
        style={{
          background:
            "radial-gradient(ellipse at 50% 28%, rgba(251,191,36,0.05), transparent 55%), " +
            "radial-gradient(ellipse at 18% 82%, rgba(127,29,29,0.16), transparent 50%), " +
            "radial-gradient(ellipse at 82% 78%, rgba(127,29,29,0.12), transparent 52%), #030303",
        }}
      />
      <div
        className={"absolute inset-0 mix-blend-overlay" + (active ? " grain-drift" : "")}
        style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`, backgroundSize: "180px 180px" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-[#030303]" />
    </div>
  );
}
