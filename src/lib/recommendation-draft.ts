import type { CrazinessLevel } from "@/lib/types";

export const recommendationDraftKey = "fun:request-draft";
export type RecommendationDraft = {
  inputMode: "choose" | "describe";
  selectedMoods: string[];
  selectedAvoids: string[];
  selectedWants: string[];
  time: string;
  energy: string;
  risk: CrazinessLevel;
  platformFilter: "mine" | "any";
  indieMode: boolean;
  selfText: string;
  reference: string;
};

export function saveRecommendationDraft(draft: RecommendationDraft) {
  try { sessionStorage.setItem(recommendationDraftKey, JSON.stringify(draft)); } catch { /* Storage is optional. */ }
}

export function clearRecommendationDraft() {
  try { sessionStorage.removeItem(recommendationDraftKey); } catch { /* Storage is optional. */ }
}

export function loadRecommendationDraft(): RecommendationDraft | null {
  try {
    const raw = sessionStorage.getItem(recommendationDraftKey);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !["choose", "describe"].includes(d.inputMode) || !["mine", "any"].includes(d.platformFilter)) return null;
    if (![d.selectedMoods, d.selectedAvoids, d.selectedWants].every((a) => Array.isArray(a) && a.every((v) => typeof v === "string"))) return null;
    if (![d.time, d.energy, d.selfText, d.reference].every((v) => typeof v === "string")) return null;
    if (![0, 1, 2, 3].includes(d.risk) || typeof d.indieMode !== "boolean") return null;
    return d;
  } catch { return null; }
}
