// Shared data model behind two features: (1) "unlock more today" by leaving an email after
// hitting the daily rate limit, and (2) a low-key "interested in F.U.N Premium" capture. Both are
// the same underlying concept — an email-identified record — so one store serves both rather than
// two disconnected mechanisms. No payment processing exists yet: subscriptionStatus starts at
// "none" for everyone, "pending" is reserved for premium interest capture, and "active" is
// reserved for a future real Stripe integration — this only lays the data shape so that work is
// additive later, not a rebuild.
//
// Same Upstash REST pipeline pattern as anonymous-profile-store.ts / rate-limit.ts — no new
// dependency, fails open on Redis trouble.

export type SubscriberRecord = {
  email: string;
  createdAt: string;
  dailyUnlockGrantedAt?: string;
  subscriptionStatus: "none" | "pending" | "active";
};

function credentials() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  };
}

function normalizeEmail(email: string): string | null {
  const clean = email.trim().toLowerCase();
  // Deliberately simple — this only needs to reject obvious garbage, not fully validate RFC 5322.
  if (!clean || clean.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  return clean;
}

function subscriberKey(email: string): string | null {
  const clean = normalizeEmail(email);
  return clean ? `fun:subscriber:${clean}` : null;
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
  if (!response.ok) throw new Error(`Subscriber store write failed (${response.status})`);
}

async function readOne(key: string): Promise<SubscriberRecord | null> {
  const { url, token } = credentials();
  if (!url || !token) return null;
  const response = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) return null;
  const { result } = (await response.json()) as { result: string | null };
  if (!result) return null;
  try {
    return JSON.parse(result) as SubscriberRecord;
  } catch {
    return null;
  }
}

export async function getSubscriber(email: string): Promise<SubscriberRecord | null> {
  const key = subscriberKey(email);
  if (!key) return null;
  return readOne(key);
}

// Upserts, preserving subscriptionStatus/createdAt/dailyUnlockGrantedAt unless explicitly patched.
export async function upsertSubscriber(email: string, patch: Partial<Omit<SubscriberRecord, "email">> = {}): Promise<boolean> {
  const key = subscriberKey(email);
  const clean = normalizeEmail(email);
  if (!key || !clean) return false;

  const existing = await readOne(key);
  const record: SubscriberRecord = {
    email: clean,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    dailyUnlockGrantedAt: patch.dailyUnlockGrantedAt ?? existing?.dailyUnlockGrantedAt,
    subscriptionStatus: patch.subscriptionStatus ?? existing?.subscriptionStatus ?? "none",
  };
  await pipeline([["SET", key, JSON.stringify(record)]]);
  return true;
}
