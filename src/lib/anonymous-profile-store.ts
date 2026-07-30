type ProfileRecommendation = {
  runId: string;
  source: string;
  title: string;
  year: string;
  format: string;
  confidence?: number;
  displayState?: string;
  createdAt: string;
};

type ProfileFeedback = {
  runId?: string;
  reason: string;
  phase?: string;
  title: string;
  year: string;
  createdAt: string;
};

function credentials() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  };
}

function profileKey(sessionId: string, suffix: string): string | null {
  const clean = sessionId.trim().replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 96);
  if (!clean || clean === "unknown" || clean === "ssr") return null;
  return `fun:profile:${clean}:${suffix}`;
}

async function pipeline(commands: Array<Array<string | number>>): Promise<void> {
  const { url, token } = credentials();
  if (!url || !token || commands.length === 0) return;
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`Profile memory write failed (${response.status})`);
}

export async function appendProfileRecommendation(
  sessionId: string,
  recommendation: ProfileRecommendation,
): Promise<void> {
  const historyKey = profileKey(sessionId, "recommendations");
  const titlesKey = profileKey(sessionId, "titles");
  if (!historyKey || !titlesKey) return;
  const titleKey = `${recommendation.title.trim().toLowerCase()}::${recommendation.year.trim()}`;
  await pipeline([
    ["LPUSH", historyKey, JSON.stringify(recommendation)],
    ["LTRIM", historyKey, 0, 499],
    ["SADD", titlesKey, titleKey],
    ["EXPIRE", historyKey, 31536000],
    ["EXPIRE", titlesKey, 31536000],
  ]);
}

export async function appendProfileFeedback(
  sessionId: string,
  feedback: ProfileFeedback,
): Promise<void> {
  const feedbackKey = profileKey(sessionId, "feedback");
  if (!feedbackKey) return;
  await pipeline([
    ["LPUSH", feedbackKey, JSON.stringify(feedback)],
    ["LTRIM", feedbackKey, 0, 499],
    ["EXPIRE", feedbackKey, 31536000],
  ]);
}

export async function deleteAnonymousProfile(sessionId: string): Promise<void> {
  const keys = ["recommendations", "titles", "feedback"]
    .map((suffix) => profileKey(sessionId, suffix))
    .filter((key): key is string => Boolean(key));
  if (keys.length === 0) return;
  await pipeline([["DEL", ...keys]]);
}
