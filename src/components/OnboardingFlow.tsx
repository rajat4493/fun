"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronDown, MapPin, Tv } from "lucide-react";

export const ONBOARDING_KEY = "fun:onboarding";

export type OnboardingData = {
  country: string;
  countryCode: string;
  languagePreferences?: string[];
  platforms: string[];
};

const COUNTRIES = [
  { name: "Poland", code: "PL" },
  { name: "United Kingdom", code: "GB" },
  { name: "Germany", code: "DE" },
  { name: "France", code: "FR" },
  { name: "Spain", code: "ES" },
  { name: "Italy", code: "IT" },
  { name: "Netherlands", code: "NL" },
  { name: "United States", code: "US" },
  { name: "India", code: "IN" },
  { name: "Portugal", code: "PT" },
  { name: "Sweden", code: "SE" },
  { name: "Denmark", code: "DK" },
  { name: "Belgium", code: "BE" },
  { name: "Austria", code: "AT" },
  { name: "Ireland", code: "IE" },
];

const PLATFORM_OPTIONS: Record<string, string[]> = {
  IN: [
    "Netflix",
    "Prime Video",
    "JioHotstar",
    "Zee5",
    "SonyLIV",
    "Hoichoi",
    "Aha",
    "Sun NXT",
    "MX Player",
    "YouTube",
  ],
  PL: [
    "Netflix",
    "Prime Video",
    "Disney+",
    "HBO Max",
    "Apple TV+",
    "SkyShowtime",
    "CANAL+",
    "Player",
    "TVP VOD",
    "Polsat Box Go",
    "MUBI",
    "YouTube",
  ],
  default: [
    "Netflix",
    "Prime Video",
    "Disney+",
    "HBO Max",
    "Apple TV+",
    "MUBI",
    "YouTube",
  ],
};

const LANGUAGE_OPTIONS: Record<string, string[]> = {
  IN: ["Hindi", "Malayalam", "Tamil", "Telugu", "Bengali", "Marathi", "Kannada", "English"],
  PL: ["Polish", "English", "European cinema"],
  default: ["Local language", "English", "No preference"],
};

function detectCountry(): { name: string; code: string } {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (locale.includes("Warsaw") || locale.includes("Europe/Warsaw")) return { name: "Poland", code: "PL" };
    if (locale.includes("London")) return { name: "United Kingdom", code: "GB" };
    if (locale.includes("Vienna")) return { name: "Austria", code: "AT" };
    if (locale.includes("Berlin")) return { name: "Germany", code: "DE" };
    if (locale.includes("Paris") || locale.includes("Brussels")) return { name: "France", code: "FR" };
    if (locale.includes("New_York") || locale.includes("Chicago") || locale.includes("Los_Angeles")) return { name: "United States", code: "US" };
  } catch {
    // ignore
  }
  return { name: "Poland", code: "PL" };
}

function platformOptionsForCountry(countryCode: string) {
  return PLATFORM_OPTIONS[countryCode] ?? PLATFORM_OPTIONS.default;
}

function defaultPlatformsForCountry(countryCode: string) {
  const options = platformOptionsForCountry(countryCode);
  return options.includes("Netflix") ? ["Netflix"] : options.slice(0, 1);
}

export function loadOnboarding(): OnboardingData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingData;
  } catch {
    return null;
  }
}

export function saveOnboarding(data: OnboardingData) {
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(data));
}

export default function OnboardingFlow({ onComplete }: { onComplete: (data: OnboardingData) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedCountry, setSelectedCountry] = useState(() => detectCountry());
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(["No preference"]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(() => defaultPlatformsForCountry(detectCountry().code));
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const languageOptions = [...new Set([...(LANGUAGE_OPTIONS[selectedCountry.code] ?? LANGUAGE_OPTIONS.default), "No preference"])];
  const platformOptions = platformOptionsForCountry(selectedCountry.code);

  function togglePlatform(platform: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  }

  function toggleLanguage(language: string) {
    setSelectedLanguages((prev) => {
      if (language === "No preference") return ["No preference"];
      const next = prev.includes(language)
        ? prev.filter((item) => item !== language)
        : [...prev.filter((item) => item !== "No preference"), language];
      return next.length > 0 ? next : ["No preference"];
    });
  }

  function handleComplete() {
    const data: OnboardingData = {
      country: selectedCountry.name,
      countryCode: selectedCountry.code,
      languagePreferences: selectedLanguages.includes("No preference") ? [] : selectedLanguages,
      platforms: selectedPlatforms,
    };
    saveOnboarding(data);
    onComplete(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#030303]">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-30"
        style={{ backgroundImage: "url('/fun/hero-cinematic.png')" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-[#030303]/80 to-[#030303]" />

      <div className="relative mx-auto w-full max-w-xl px-6">
        <div className="mb-10 text-center">
          <div className="mb-2 text-3xl font-medium tracking-[0.34em] text-white">
            F<span className="text-red-500">.</span>U<span className="text-red-500">.</span>N
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className={`h-1 w-10 rounded-full transition-colors ${step >= 1 ? "bg-red-500" : "bg-white/20"}`} />
            <div className={`h-1 w-10 rounded-full transition-colors ${step >= 2 ? "bg-red-500" : "bg-white/20"}`} />
          </div>
        </div>

        {step === 1 && (
          <div className="rounded-2xl border border-white/12 bg-[#111315]/90 p-8 shadow-[0_22px_90px_rgba(0,0,0,0.72)] backdrop-blur-2xl">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10">
              <MapPin size={20} className="text-red-300" />
            </div>
            <h1 className="mt-4 font-serif text-3xl text-white">Where are you watching from?</h1>
            <p className="mt-2 text-sm text-white/54">We'll check what's actually available on streaming in your country.</p>

            <div className="relative mt-7">
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex h-12 w-full items-center justify-between rounded-xl border border-white/14 bg-white/[0.06] px-4 text-white transition hover:border-white/28"
              >
                <span>{selectedCountry.name}</span>
                <ChevronDown size={16} className={`text-white/54 transition ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-white/14 bg-[#1a1c1e] shadow-2xl">
                  {COUNTRIES.map((c) => (
                    <button
                      type="button"
                      key={c.code}
                      onClick={() => {
                        setSelectedCountry(c);
                        setSelectedLanguages(["No preference"]);
                        setSelectedPlatforms(defaultPlatformsForCountry(c.code));
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-3 text-sm transition hover:bg-white/[0.07] ${
                        selectedCountry.code === c.code ? "text-white" : "text-white/72"
                      }`}
                    >
                      {c.name}
                      {selectedCountry.code === c.code && <Check size={15} className="text-red-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6">
              <p className="text-sm font-medium text-white">Language mood</p>
              <p className="mt-1 text-xs text-white/44">Optional. We will still follow your written prompt first.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {languageOptions.map((language) => {
                  const active = selectedLanguages.includes(language);
                  return (
                    <button
                      type="button"
                      key={language}
                      onClick={() => toggleLanguage(language)}
                      className={`h-9 rounded-full border px-4 text-sm transition ${
                        active
                          ? "border-red-400/50 bg-red-500/12 text-white shadow-[0_0_18px_rgba(239,68,68,0.16)]"
                          : "border-white/10 bg-white/[0.04] text-white/68 hover:border-white/22 hover:text-white"
                      }`}
                    >
                      {language}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-red-500 to-red-900 font-semibold text-white shadow-[0_12px_30px_rgba(127,29,29,0.45)] transition hover:brightness-110"
            >
              Continue
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-2xl border border-white/12 bg-[#111315]/90 p-8 shadow-[0_22px_90px_rgba(0,0,0,0.72)] backdrop-blur-2xl">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10">
              <Tv size={20} className="text-red-300" />
            </div>
            <h1 className="mt-4 font-serif text-3xl text-white">What do you subscribe to?</h1>
            <p className="mt-2 text-sm text-white/54">F.U.N uses this to reveal what you're missing — not to limit what you see.</p>

            <div className="mt-6 grid grid-cols-2 gap-2">
              {platformOptions.map((platform) => {
                const active = selectedPlatforms.includes(platform);
                return (
                  <button
                    type="button"
                    key={platform}
                    onClick={() => togglePlatform(platform)}
                    className={`flex h-11 items-center justify-between rounded-xl border px-4 text-sm transition ${
                      active
                        ? "border-red-400/50 bg-red-500/12 text-white shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                        : "border-white/10 bg-white/[0.04] text-white/72 hover:border-white/22 hover:text-white"
                    }`}
                  >
                    {platform}
                    {active && <Check size={14} className="text-red-300" />}
                  </button>
                );
              })}
            </div>

            {selectedPlatforms.length === 0 && (
              <p className="mt-3 text-center text-sm text-white/42">Select at least one, or pick none if you just browse free.</p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex h-12 w-14 items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] text-white/72 transition hover:text-white"
              >
                ←
              </button>
              <button
                type="button"
                onClick={handleComplete}
                className="flex flex-1 items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-red-500 to-red-900 font-semibold text-white shadow-[0_12px_30px_rgba(127,29,29,0.45)] transition hover:brightness-110"
              >
                Find my pick
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
