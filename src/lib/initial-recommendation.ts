// The first "ask" request, owned by a module instead of the home page component.
//
// The request used to live entirely inside page.tsx's click handler: it set `fun:loading`,
// navigated to /recommendation, and kept the fetch alive in that page's closure. Anything that
// killed that JS context or its connection — a reload on the loading screen, a phone locking, the
// PWA being backgrounded and its socket dropped — lost the request while `fun:loading` stayed set,
// so the loading screen sat there until its 85s watchdog said "took too long".
//
// Two recoveries now cover that:
//   1. A dropped connection (fetch rejects with a network error) is retried once, waiting for the
//      tab to be visible again first.
//   2. The request itself is persisted, and a heartbeat marks it as alive. If /recommendation finds
//      a loading flag with no live owner (see resumeOrphanedRecommendation), it re-runs the stored
//      request instead of waiting out the watchdog.

import {
  createRecommendationSession,
  getOrCreateSessionId,
  recommendationStorageKey,
  rememberRecommendationHistory,
  rememberRecommendationTitles,
} from "@/lib/recommendation-session";
import { captureRecommendationRun } from "@/lib/recommendation-analytics";
import { IntentContract, RecommendRequest, Recommendation, RecommendationDisplayState } from "@/lib/types";

export const LOADING_KEY = "fun:loading";
export const LOADING_STARTED_KEY = "fun:loading-started-at";
export const LOADING_STAGE_KEY = "fun:loading-stage";
export const RECOMMENDATION_ERROR_KEY = "fun:recommendation-error";
const PENDING_REQUEST_KEY = "fun:pending-request";
const HEARTBEAT_KEY = "fun:loading-heartbeat";

// The server caps itself at 60s (maxDuration in /api/recommend), so anything past this is a dead
// connection rather than a slow answer.
const REQUEST_TIMEOUT_MS = 70000;
const HEARTBEAT_INTERVAL_MS = 1000;
// Generous on purpose: timers in a hidden tab are throttled, and another tab that is merely slow
// to beat must not be mistaken for a dead one.
const HEARTBEAT_STALE_MS = 6000;
const MAX_RESUMES = 1;
const PENDING_MAX_AGE_MS = 5 * 60 * 1000;
const INTERRUPTED_MESSAGE = "Your request was interrupted. Please try again.";

type PendingRequest = {
  request: RecommendRequest;
  runId: string;
  createdAt: number;
  resumes: number;
};

type RecommendResponse = Recommendation & {
  _batch?: Recommendation[];
  _trust?: { displayState?: RecommendationDisplayState; batchComplete?: boolean; intentContract?: IntentContract };
};

// Lives only as long as this JS context — a reload resets it, which is exactly the signal
// resumeOrphanedRecommendation needs.
let inFlightRunId: string | null = null;

export function captureEvent(type: string, payload: Record<string, unknown>) {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: getOrCreateSessionId(), type, payload }),
  }).catch(() => {});
}

// Reads the NDJSON stream from a `stream: true` /api/recommend request (see route.ts's
// buildResult/emitStage). Surfaces each real pipeline stage to the loading screen (via localStorage,
// the cross-page channel recommendation/page.tsx polls) as it happens, and resolves with the final
// payload once the terminal "result" line arrives — or throws on "error"/an empty stream.
async function readNdjsonResult(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Could not generate a pick.");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const parsed = JSON.parse(line) as { type: string; stage?: string; payload?: unknown; error?: string };
      if (parsed.type === "stage" && parsed.stage) {
        localStorage.setItem(LOADING_STAGE_KEY, parsed.stage);
      } else if (parsed.type === "result") {
        return parsed.payload;
      } else if (parsed.type === "error") {
        throw new Error(parsed.error || "Recommendation failed. Check API keys or model output.");
      }
    }
  }
  throw new Error("Could not generate a pick.");
}

class ServerMessageError extends Error {}

async function requestOnce(request: RecommendRequest): Promise<RecommendResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Surface the server's actual error message (rate limit, geo-scope preview block, etc.)
      // instead of a generic string — a real, expected block looked identical to a crash without it.
      let message = "Could not generate a pick.";
      try {
        const errorBody = await response.json() as { error?: string };
        if (errorBody?.error) message = errorBody.error;
      } catch {
        // response wasn't JSON — keep the generic message
      }
      throw new ServerMessageError(message);
    }
    return await readNdjsonResult(response) as RecommendResponse;
  } finally {
    window.clearTimeout(timeout);
  }
}

// fetch() rejects with a TypeError when the connection itself fails (offline, socket dropped while
// the tab was suspended). Server-reported errors and our own abort are deliberately not included.
function isConnectionError(error: unknown): boolean {
  return error instanceof TypeError;
}

function whenVisible(): Promise<void> {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

function readPending(): PendingRequest | null {
  try {
    const raw = localStorage.getItem(PENDING_REQUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRequest;
    return parsed?.request && typeof parsed.runId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function markLoadingStarted() {
  localStorage.setItem(LOADING_KEY, "true");
  localStorage.setItem(LOADING_STARTED_KEY, String(Date.now()));
  localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
}

function clearLoadingState() {
  localStorage.removeItem(LOADING_KEY);
  localStorage.removeItem(LOADING_STARTED_KEY);
  localStorage.removeItem(LOADING_STAGE_KEY);
  localStorage.removeItem(HEARTBEAT_KEY);
  localStorage.removeItem(PENDING_REQUEST_KEY);
}

function storeResult(data: RecommendResponse, request: RecommendRequest, runId: string) {
  const batch = data._batch ?? [data];
  rememberRecommendationTitles(batch.map((item) => item.title));
  rememberRecommendationHistory(batch, request, runId);
  localStorage.setItem(
    recommendationStorageKey,
    JSON.stringify(createRecommendationSession(
      batch[0],
      request,
      batch,
      data._trust?.displayState,
      runId,
      data._trust?.batchComplete,
      data._trust?.intentContract,
    )),
  );
  captureEvent("recommendation", {
    runId,
    title: batch[0].title,
    year: batch[0].year,
    confidence: batch[0].confidence,
    parsedIntent: batch[0].parsedIntent,
    batch: batch.map((item) => ({ title: item.title, year: item.year, confidence: item.confidence })),
    availabilityStatus: batch[0].whereToWatch.status,
    providerCount: batch[0].whereToWatch.providers?.length ?? 0,
    displayState: data._trust?.displayState,
    source: "initial",
  });
  captureRecommendationRun({
    runId,
    source: "initial",
    request,
    recommendation: batch[0],
    batch,
    displayState: data._trust?.displayState,
  });
}

async function execute(pending: PendingRequest): Promise<void> {
  const { request, runId } = pending;
  // Everything up to the first await runs synchronously, so the caller can navigate to
  // /recommendation right after calling this and the loading flags are already in place.
  inFlightRunId = runId;
  localStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify(pending));
  localStorage.removeItem(RECOMMENDATION_ERROR_KEY);
  // Cleared so a fresh ask never briefly shows the previous request's last stage before its own
  // first "understanding" line arrives.
  localStorage.removeItem(LOADING_STAGE_KEY);
  markLoadingStarted();
  const heartbeat = window.setInterval(() => {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  }, HEARTBEAT_INTERVAL_MS);

  try {
    let data: RecommendResponse;
    try {
      data = await requestOnce(request);
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      // The connection dropped — typically the tab was backgrounded or the phone locked. Wait
      // until someone is actually looking again, then give it one more go with a fresh clock so
      // the loading screen's watchdog doesn't fire mid-retry.
      await whenVisible();
      localStorage.removeItem(LOADING_STAGE_KEY);
      markLoadingStarted();
      data = await requestOnce(request);
    }
    storeResult(data, request, runId);
  } catch (error) {
    localStorage.setItem(
      RECOMMENDATION_ERROR_KEY,
      error instanceof Error && error.name === "AbortError"
        ? "The recommendation took too long. Please try again."
        : error instanceof ServerMessageError ? error.message
        : isConnectionError(error) ? "Connection lost. Check your network and try again."
        : error instanceof Error ? error.message : "Something went wrong.",
    );
  } finally {
    window.clearInterval(heartbeat);
    // A newer ask may have taken over while this one was still settling.
    if (inFlightRunId === runId) {
      inFlightRunId = null;
      clearLoadingState();
    }
  }
}

export function runInitialRecommendation(request: RecommendRequest, runId: string): Promise<void> {
  return execute({ request, runId, createdAt: Date.now(), resumes: 0 });
}

// Called by /recommendation while it shows the loading screen. Returns true when it took over an
// orphaned request (or ended one that can't be resumed) — the caller just keeps polling as usual.
export function resumeOrphanedRecommendation(): boolean {
  if (inFlightRunId) return false;
  if (localStorage.getItem(LOADING_KEY) !== "true") return false;
  // Another tab (or this page a moment before a reload) may still own it.
  const lastBeat = Number(localStorage.getItem(HEARTBEAT_KEY) ?? 0);
  if (Date.now() - lastBeat < HEARTBEAT_STALE_MS) return false;

  const pending = readPending();
  const resumable = pending &&
    pending.resumes < MAX_RESUMES &&
    Date.now() - pending.createdAt < PENDING_MAX_AGE_MS;
  if (!resumable) {
    localStorage.setItem(RECOMMENDATION_ERROR_KEY, INTERRUPTED_MESSAGE);
    clearLoadingState();
    return true;
  }
  void execute({ ...pending, resumes: pending.resumes + 1 });
  return true;
}
