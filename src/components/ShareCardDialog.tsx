"use client";

import { useEffect, useMemo, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.js";
import Download from "lucide-react/dist/esm/icons/download.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Share2 from "lucide-react/dist/esm/icons/share-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  defaultPublicMoodLine,
  shareCardFilename,
  shareCardTags,
  ShareCardFormat,
  ShareCardStyle,
  suggestedShareCardStyle,
} from "@/lib/share-card";
import type { IntentContract, RecommendRequest, Recommendation } from "@/lib/types";

type ShareCardDialogProps = {
  recommendation: Recommendation;
  request: RecommendRequest;
  intentContract?: IntentContract;
  onClose: () => void;
  onShared: (method: "native" | "download") => void;
};

const styles: Array<{ value: ShareCardStyle; label: string }> = [
  { value: "cinematic", label: "Cinematic" },
  { value: "playful", label: "Playful" },
  { value: "intense", label: "Intense" },
];

const formats: Array<{ value: ShareCardFormat; label: string }> = [
  { value: "story", label: "Story 9:16" },
  { value: "feed", label: "Feed 4:5" },
];

const previewThemes: Record<ShareCardStyle, {
  background: string;
  accent: string;
  muted: string;
  titleClass: string;
}> = {
  cinematic: {
    background: "linear-gradient(145deg,#070706 0%,#17120d 58%,#090807 100%)",
    accent: "#efcb83",
    muted: "#bcb3a6",
    titleClass: "font-serif normal-case",
  },
  playful: {
    background: "linear-gradient(145deg,#071315 0%,#142126 55%,#090d11 100%)",
    accent: "#ff796d",
    muted: "#a9bdc0",
    titleClass: "font-sans normal-case",
  },
  intense: {
    background: "linear-gradient(145deg,#050505 0%,#160b0b 55%,#050505 100%)",
    accent: "#ff5a54",
    muted: "#bba9a7",
    titleClass: "font-mono uppercase",
  },
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ShareCardDialog({
  recommendation,
  request,
  intentContract,
  onClose,
  onShared,
}: ShareCardDialogProps) {
  const [moodLine, setMoodLine] = useState(() => defaultPublicMoodLine(request, recommendation, intentContract));
  const [style, setStyle] = useState<ShareCardStyle>(() => suggestedShareCardStyle(request, recommendation, intentContract));
  const [format, setFormat] = useState<ShareCardFormat>("story");
  const [busyAction, setBusyAction] = useState<"share" | "download" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tags = useMemo(() => shareCardTags(request, recommendation, intentContract), [request, recommendation, intentContract]);
  const theme = previewThemes[style];

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  async function createCard() {
    const response = await fetch("/api/share-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        title: recommendation.title,
        year: recommendation.year,
        posterUrl: recommendation.omdbPosterUrl,
        moodLine,
        tags,
        style,
        format,
      }),
    });
    if (!response.ok) throw new Error("The card could not be created.");
    return response.blob();
  }

  async function handleNativeShare() {
    if (!moodLine.trim() || busyAction) return;
    setBusyAction("share");
    setMessage(null);
    try {
      const blob = await createCard();
      const file = new File([blob], shareCardFilename(recommendation.title, format), { type: "image/png" });
      const shareData: ShareData = {
        files: [file],
        text: `Tonight I’m watching ${recommendation.title}.`,
      };
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        onShared("native");
      } else {
        downloadBlob(blob, file.name);
        setMessage("Card downloaded. It is ready to post.");
        onShared("download");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Could not open sharing. Download the card instead.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDownload() {
    if (!moodLine.trim() || busyAction) return;
    setBusyAction("download");
    setMessage(null);
    try {
      const blob = await createCard();
      downloadBlob(blob, shareCardFilename(recommendation.title, format));
      setMessage("Card downloaded.");
      onShared("download");
    } catch {
      setMessage("The card could not be created. Please try again.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/82 px-4 py-6 backdrop-blur-xl"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-card-title"
        className="relative grid w-full max-w-5xl gap-7 rounded-2xl border border-white/12 bg-[#0b0b0c] p-5 shadow-[0_36px_120px_rgba(0,0,0,0.72)] sm:p-7 lg:grid-cols-[0.72fr_1.28fr]"
      >
        <button
          type="button"
          aria-label="Close share card"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/45 text-white/62 transition hover:border-white/24 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="mx-auto flex w-full max-w-[330px] items-center justify-center pt-7 lg:pt-0">
          <div
            className={`relative w-full overflow-hidden border border-white/16 shadow-[0_28px_90px_rgba(0,0,0,0.55)] ${format === "story" ? "aspect-[9/16]" : "aspect-[4/5]"}`}
            style={{ background: theme.background, borderRadius: 18 }}
          >
            <div className="absolute inset-3 rounded-[12px] border border-white/10" />
            <div className="absolute left-[7%] top-[6%] text-[8px] uppercase tracking-[0.3em]" style={{ color: theme.muted }}>
              Tonight I needed
            </div>
            <p className="absolute left-[7%] top-[11%] w-[84%] text-[clamp(1.35rem,3.7vw,2rem)] font-medium leading-[1.02] text-white">
              {moodLine || "Your public mood goes here."}
            </p>
            <div className={`absolute left-[7%] ${format === "story" ? "top-[36%]" : "top-[38%]"} w-[44%]`}>
              <p className="text-[10px]" style={{ color: theme.accent }}>So I’m watching</p>
              <p className={`mt-2 text-[clamp(1.4rem,4.2vw,2.35rem)] font-semibold leading-[0.92] text-white ${theme.titleClass}`}>
                {recommendation.title}
              </p>
              <p className="mt-2 text-[9px]" style={{ color: theme.muted }}>{recommendation.year}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-full border px-1.5 py-0.5 text-[7px] text-white/76" style={{ borderColor: `${theme.accent}66` }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div
              className={`absolute right-[7%] overflow-hidden rounded-[10px] border border-white/20 bg-[#141418] ${format === "story" ? "top-[38%] h-[43%] w-[40%]" : "top-[39%] h-[45%] w-[38%]"}`}
            >
              {recommendation.omdbPosterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={recommendation.omdbPosterUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center p-4 text-center text-sm" style={{ color: theme.accent }}>
                  {recommendation.title}
                </div>
              )}
            </div>
            <p className="absolute bottom-[8%] left-[7%] text-[8px]" style={{ color: theme.muted }}>
              Trusting this choice. Ask me tomorrow.
            </p>
            <p className="absolute bottom-[4%] right-[7%] text-[7px] tracking-wide text-white/40">
              picked with F.U.N
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-200/62">Your share card</p>
          <h2 id="share-card-title" className="mt-2 font-serif text-3xl text-white">Make the mood yours.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/46">
            Only this public line, the movie, and its mood tags appear. Your original prompt stays private.
          </p>

          <label className="mt-6 block">
            <span className="mb-2 block text-sm text-white/72">Public mood</span>
            <textarea
              value={moodLine}
              maxLength={110}
              rows={3}
              onChange={(event) => setMoodLine(event.target.value)}
              className="w-full resize-none rounded-xl border border-white/12 bg-white/[0.045] px-4 py-3 text-base leading-6 text-white outline-none transition placeholder:text-white/24 focus:border-amber-200/35"
            />
            <span className="mt-1 block text-right text-xs text-white/28">{moodLine.length}/110</span>
          </label>

          <div className="mt-4">
            <span className="mb-2 block text-sm text-white/72">Style</span>
            <div className="grid grid-cols-3 gap-2">
              {styles.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStyle(option.value)}
                  className={`h-11 rounded-lg border text-sm transition ${
                    style === option.value
                      ? "border-amber-200/42 bg-amber-300/10 text-white"
                      : "border-white/10 bg-white/[0.035] text-white/46 hover:text-white"
                  }`}
                >
                  {style === option.value && <Check size={13} className="mr-1.5 inline" />}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <span className="mb-2 block text-sm text-white/72">Size</span>
            <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/35 p-1">
              {formats.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormat(option.value)}
                  className={`h-10 rounded-lg text-sm transition ${
                    format === option.value ? "bg-white/[0.1] text-white" : "text-white/42 hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleNativeShare}
              disabled={!moodLine.trim() || Boolean(busyAction)}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-red-400 to-red-800 px-5 font-semibold text-white shadow-[0_14px_34px_rgba(127,29,29,0.35)] transition hover:brightness-110 disabled:opacity-45"
            >
              {busyAction === "share" ? <LoaderCircle size={18} className="animate-spin" /> : <Share2 size={18} />}
              Share card
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!moodLine.trim() || Boolean(busyAction)}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/[0.045] px-5 font-semibold text-white/68 transition hover:border-white/28 hover:text-white disabled:opacity-45"
            >
              {busyAction === "download" ? <LoaderCircle size={18} className="animate-spin" /> : <Download size={18} />}
              Download
            </button>
          </div>
          {message && <p role="status" className="mt-3 text-sm text-amber-100/72">{message}</p>}
        </div>
      </section>
    </div>
  );
}
