import type { RecommendationSession } from "@/lib/recommendation-session";

const ACTIVE = "fun:active-request";
const RESULT = "fun:last-recommendation";
const PRIORITY_CHANNEL = "fun-recommendation-priority";
export const recommendationForegroundEvent = "fun:foreground-recommendation";
const transientKeys = [ACTIVE, RESULT, "fun:loading", "fun:loading-started-at", "fun:loading-stage", "fun:recommendation-error"];
const fallback = new Map<string, string | null>();

// The current request/result belongs to one tab. Long-term history stays in localStorage.
export const recommendationTabStorage = {
  getItem(key: string): string | null { if (fallback.has(key)) return fallback.get(key) ?? null; try { return sessionStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string) { fallback.set(key, value); try { sessionStorage.setItem(key, value); fallback.delete(key); } catch { /* retain in-memory value */ } },
  removeItem(key: string) { fallback.set(key, null); try { sessionStorage.removeItem(key); fallback.delete(key); } catch { /* tombstone prevents old state returning */ } },
};

export function beginRecommendationRequest(runId: string): void {
  recommendationTabStorage.setItem(ACTIVE, runId);
  recommendationTabStorage.removeItem(RESULT);
  recommendationTabStorage.removeItem("fun:recommendation-error");
  // Foreground work always wins. Same-tab listeners receive the DOM event; other tabs receive
  // the short-lived BroadcastChannel message. Neither mechanism stores prompts or user choices.
  if (typeof window !== "undefined") {
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(new CustomEvent(recommendationForegroundEvent, { detail: { runId } }));
    }
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PRIORITY_CHANNEL);
      channel.postMessage({ runId });
      channel.close();
    }
  }
}

export function listenForForegroundRecommendation(callback: (runId?: string) => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const onForeground = (event: Event) => callback((event as CustomEvent<{ runId?: string }>).detail?.runId);
  window.addEventListener(recommendationForegroundEvent, onForeground);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(PRIORITY_CHANNEL) : null;
  if (channel) channel.onmessage = event => callback(event.data?.runId);
  return () => {
    window.removeEventListener(recommendationForegroundEvent, onForeground);
    channel?.close();
  };
}

export function ownsRecommendationRequest(runId?: string, sessionId?: string): boolean {
  if (!runId || recommendationTabStorage.getItem(ACTIVE) !== runId) return false;
  try {
    const currentId = localStorage.getItem("fun:session-id");
    return !sessionId || currentId === sessionId || (sessionId === "unknown" && !currentId);
  } catch { return sessionId === "unknown"; }
}

export function clearActiveRecommendation(): void {
  transientKeys.forEach(key => recommendationTabStorage.removeItem(key));
}

export function loadActiveRecommendation(): RecommendationSession | null {
  try {
    const raw = recommendationTabStorage.getItem(RESULT);
    if (!raw || recommendationTabStorage.getItem("fun:recommendation-error")) return null;
    const value = JSON.parse(raw) as RecommendationSession;
    const age = Date.now() - Date.parse(value.generatedAt);
    if (!value.request || !ownsRecommendationRequest(value.runId, value.request.sessionId) || !Number.isFinite(age) || age < 0 || age > 86400000) return null;
    const batch = value.batch ?? [value.recommendation];
    if (!Array.isArray(batch) || !batch.length || batch.length > 3 || batch.some(item => !item || typeof item.title !== "string" || !item.title || typeof item.vibe !== "string" || !Array.isArray(item.whyItFits) || !Array.isArray(item.alternatives) || !item.whereToWatch || !item.hiddenLayer)) return null;
    const index = value.batchIndex ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= batch.length || value.recommendation?.title !== batch[index].title) return null;
    let onboarding = null;
    try { onboarding = JSON.parse(localStorage.getItem("fun:onboarding") ?? "null"); } catch { /* optional profile may be unavailable */ }
    const listKey = (items: unknown) => Array.isArray(items) ? items.filter(item => typeof item === "string").map(item => item.toLowerCase()).sort().join("|") : "";
    if (onboarding && (onboarding.country !== value.request.country ||
      listKey(onboarding.platforms) !== listKey(value.request.platforms) ||
      listKey(onboarding.languagePreferences) !== listKey(value.request.languagePreferences))) return null;
    return value;
  } catch { return null; }
}

export function mergeBackgroundRecommendations(current: RecommendationSession, latest: RecommendationSession | null, picks: RecommendationSession["recommendation"][]): RecommendationSession | null {
  if (!latest || latest.runId !== current.runId || !ownsRecommendationRequest(current.runId, current.request.sessionId)) return null;
  const key = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const batch = [...(latest.batch ?? [latest.recommendation])];
  const seen = new Set(batch.map(item => key(item.title)));
  try {
    const explicitlySeen = JSON.parse(localStorage.getItem("fun:seen-titles") ?? "[]");
    if (Array.isArray(explicitlySeen)) explicitlySeen.filter(title => typeof title === "string").forEach(title => seen.add(key(title)));
  } catch { /* corrupt optional history must not crash a valid current pick */ }
  for (const pick of picks) {
    if (batch.length >= 3) break;
    if (!pick?.title || seen.has(key(pick.title))) continue;
    seen.add(key(pick.title)); batch.push(pick);
  }
  return { ...latest, batch, batchComplete: true };
}
