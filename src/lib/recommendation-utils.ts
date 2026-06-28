import { RecommendRequest } from "@/lib/types";

export function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function extractJson(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }
  const match = trimmed.match(/[\[\{][\s\S]*[\]\}]/);
  if (!match) throw new Error("Model did not return JSON");
  return match[0];
}

export function requestText(input: RecommendRequest): string {
  return [
    input.selfText,
    input.reference,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.avoids?.join(" "),
  ].filter(Boolean).join(" ");
}

export function parseAltTitle(alt: string): { title: string; year: string } {
  const match = alt.match(/^(.+?)\s*\((\d{4})\)$/);
  return match ? { title: match[1].trim(), year: match[2] } : { title: alt, year: "" };
}

export function isOnUserPlatforms(providers: Array<{ name: string; access: string }>, userPlatforms: string[]): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const userNorm = userPlatforms.map(normalize);
  return providers
    .filter((provider) => provider.access === "subscription")
    .some((provider) => {
      const providerNorm = normalize(provider.name);
      return userNorm.some((user) => providerNorm.includes(user) || user.includes(providerNorm));
    });
}
