import { extractIntent } from "@/lib/intent";
import { requestText } from "@/lib/recommendation-utils";
import { IntentContract, RecommendRequest } from "@/lib/types";

const PRIMARY_VALUES = new Set([
  "scare",
  "cry",
  "comedy",
  "thriller",
  "romance",
  "weird",
  "comfort",
  "gore",
  "drama",
  "discovery",
  "unknown",
]);

const FORMAT_VALUES = new Set<IntentContract["format"]>(["film", "series", "episode", "any"]);
const INTENSITY_VALUES = new Set<IntentContract["intensity"]>(["safe", "curious", "bold", "unhinged"]);

function firstKnownPrimary(values: string[]): string {
  for (const value of values) {
    const normalized = value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-");
    if (PRIMARY_VALUES.has(normalized)) return normalized;
  }
  return "unknown";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : [];
}

function numberConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0.55;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

export function localIntentContract(input: RecommendRequest): IntentContract {
  const intent = extractIntent(input);
  return {
    primary: firstKnownPrimary(intent.primaryIntents),
    secondary: intent.primaryIntents.filter((item) => item !== firstKnownPrimary(intent.primaryIntents)).slice(0, 6),
    hardAvoids: intent.hardAvoids,
    softAvoids: intent.softAvoids,
    format: intent.requestedFormat ?? "any",
    language: intent.requestedLanguage ?? input.languagePreferences?.[0] ?? "any",
    situation: [],
    intensity: input.craziness === 3 ? "unhinged" : input.craziness === 2 ? "bold" : input.craziness === 0 ? "safe" : "curious",
    emotionalGoal: "Infer the best emotional outcome from the request while respecting hard constraints.",
    confidence: 0.55,
    ambiguity: "",
    source: "local",
  };
}

export function normalizeIntentContract(raw: unknown, input: RecommendRequest): IntentContract {
  const local = localIntentContract(input);
  if (!raw || typeof raw !== "object") return local;
  const value = raw as Record<string, unknown>;
  const primaryRaw = typeof value.primary === "string" ? value.primary : "";
  const primary = firstKnownPrimary([primaryRaw, ...stringArray(value.secondary), local.primary]);
  const formatRaw = typeof value.format === "string" ? value.format.toLowerCase().trim() : "";
  const intensityRaw = typeof value.intensity === "string" ? value.intensity.toLowerCase().trim() : "";

  return {
    primary,
    secondary: stringArray(value.secondary),
    hardAvoids: [...new Set([...local.hardAvoids, ...stringArray(value.hardAvoids).map((item) => item.toLowerCase())])],
    softAvoids: [...new Set([...local.softAvoids, ...stringArray(value.softAvoids).map((item) => item.toLowerCase())])],
    format: FORMAT_VALUES.has(formatRaw as IntentContract["format"]) ? formatRaw as IntentContract["format"] : local.format,
    language: typeof value.language === "string" && value.language.trim() ? value.language.trim() : local.language,
    situation: stringArray(value.situation),
    intensity: INTENSITY_VALUES.has(intensityRaw as IntentContract["intensity"]) ? intensityRaw as IntentContract["intensity"] : local.intensity,
    emotionalGoal: typeof value.emotionalGoal === "string" && value.emotionalGoal.trim()
      ? value.emotionalGoal.trim()
      : local.emotionalGoal,
    confidence: numberConfidence(value.confidence),
    ambiguity: typeof value.ambiguity === "string" ? value.ambiguity.trim() : "",
    source: "llm",
  };
}

export function buildIntentContractPrompt(input: RecommendRequest): string {
  const local = localIntentContract(input);
  const text = requestText(input) || "No free text provided.";
  return `
You are F.U.N's intent interpreter. Read the viewer request and classify what they actually want.
Do not recommend a title.
Do not infer from one keyword alone. Decide whether words like scared, horror, sad, or weird are desired outcomes or avoidances.

User text and controls:
- Text: ${text}
- Country: ${input.country ?? "not provided"}
- Platforms: ${input.platforms?.join(", ") || "not specified"}
- Platform filter: ${input.platformFilter ?? "any"}
- Selected mood: ${input.mood?.join(", ") || "none"}
- Selected wants: ${input.wants?.join(", ") || "none"}
- Selected avoids: ${input.avoids?.join(", ") || "none"}
- Time: ${input.time ?? "not provided"}
- Energy: ${input.energy ?? "not provided"}
- Language preference: ${input.languagePreferences?.join(", ") || "any"}
- Taste risk: ${local.intensity}

Return one compact JSON object only:
{
  "primary": "scare|cry|comedy|thriller|romance|weird|comfort|gore|drama|discovery|unknown",
  "secondary": ["short labels"],
  "hardAvoids": ["horror|gore|violence|sex|graphic violence when clearly rejected"],
  "softAvoids": ["slow pacing|heavy drama|sad ending when the user wants less of these"],
  "format": "film|series|episode|any",
  "language": "requested language/culture lane or any",
  "situation": ["partner|friends|family|bedtime|transit|work|waiting when typed"],
  "intensity": "safe|curious|bold|unhinged",
  "emotionalGoal": "one short sentence describing the desired emotional outcome",
  "confidence": 0.0,
  "ambiguity": "short note if request has conflicting signals, else empty"
}
`;
}
