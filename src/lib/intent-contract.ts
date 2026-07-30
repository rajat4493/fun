import { extractIntent } from "@/lib/intent";
import { hasNegatedConcept, intentRequestText } from "@/lib/recommendation-utils";
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
  const text = [input.selfText, ...(input.mood ?? []), ...(input.wants ?? []), ...(input.avoids ?? [])].filter(Boolean).join(" ");
  const wantsCatharsis = /\b(devastating|cathartic|catharsis|make me cry|want to cry|need to cry|cry it out|tearjerker|sob|emotional release|let it (all )?out|gut-wrenching)\b/i.test(text);
  const griefSignal = /\b(grief|grieving|bereaved|mourning|lost (my|someone|a))\b/i.test(text);
  const breakupSignal = /\b(breakup|break-up|broke up|got dumped|dumped me|heartbroken|broken heart|relationship ended)\b/i.test(text);
  const reliefSignal = /\b(not more (sadness|loss|grief)|don't want (more )?(sadness|loss|grief)|do not want (more )?(sadness|loss|grief)|don't want to fall apart|do not want to fall apart|holds? me gently|something (kind|warm|gentle|light|easy|comforting)|comfort me|cheer me up|take my mind off|help me (recover|reset|feel better)|nothing (sad|depressing|heavy)|not (sad|depressing|heavy)|no romance|not romantic)\b/i.test(text);
  const wantsEmotionalRelief = reliefSignal && !wantsCatharsis && (griefSignal || breakupSignal || intent.primaryIntents.includes("comfort"));

  // Emotional register: detect nuanced secondary signals from free text.
  // "brutal week/day" describes the user's life, not desired content — exclude those idioms.
  // Comfort-seeking language overrides darkness words entirely.
  const extraSecondary: string[] = [];
  const seekingComfort = /\b(something (kind|warm|gentle|light|easy|comforting)|feel easy|feel at ease|comfort me|cheer me up|asks nothing|nothing heavy|no heavy|unwind|feel.good|feel better|lift me)\b/i.test(text);
  const darknessPattern = /\b(bleak|nihilistic|grim|hopeless|morally.(complex|complicated|messy)|disturbing|provocative|brutal(?!\s+(week|day|month|year|shift|commute|schedule))|unflinching|confrontational|harrowing|raw cinema|dark and honest|zero mercy)\b/i;
  const darknessSignal = darknessPattern.test(text) &&
    !hasNegatedConcept(text, /\b(bleak|grim|dark|heavy|disturbing|brutal)\b/i);
  if (darknessSignal && !seekingComfort) {
    extraSecondary.push("bleak");
  }
  if (/\b(gut.wrenching|heartbreaking|devastating|devastation|emotionally.heavy|poignant|melancholy|melancholic)\b/i.test(text)) {
    extraSecondary.push("cathartic");
  }
  if (/\b(surreal|bizarre|strange|weird|absurd|avant.garde|experimental|formally.unusual)\b/i.test(text)) {
    if (!intent.primaryIntents.includes("weird")) extraSecondary.push("weird");
  }
  if (wantsEmotionalRelief) {
    extraSecondary.push("emotional-relief", "gentle-comfort");
  }

  // Sensitive situation: detect emotional state requiring safety handling
  const extraSituation: string[] = [];
  if (/\b(panic attack|panic|anxiety|anxious|overthinking|spiraling|overwhelmed)\b/i.test(text)) {
    extraSituation.push("panic-anxiety");
  }
  if (griefSignal) {
    extraSituation.push("grief");
  }
  if (griefSignal && wantsEmotionalRelief) {
    extraSituation.push("grief-relief");
  }
  if (breakupSignal) {
    extraSituation.push(wantsEmotionalRelief ? "breakup-recovery" : "breakup");
  }
  if (/\b(can't sleep|cant sleep|insomnia|before bed|bedtime)\b/i.test(text)) {
    extraSituation.push("bedtime");
  }
  if (/\b(with (my )?(partner|girlfriend|boyfriend|wife|husband)|date night)\b/i.test(text)) {
    extraSituation.push("partner");
  }
  if (/\b(with friends|friends over|group watch|movie night)\b/i.test(text)) {
    extraSituation.push("friends");
  }
  if (/\b(with (my )?(parents|family)|family visiting|family movie|family night)\b/i.test(text)) {
    extraSituation.push("family");
  }
  if (/\b(train|plane|flight|cab|taxi|bus|commute|commuting|journey|road trip|in transit|travelling|traveling)\b/i.test(text)) {
    extraSituation.push("transit");
  }
  if (/\b(waiting room|waiting at|delayed train|airport gate|layover|queue)\b/i.test(text)) {
    extraSituation.push("waiting");
  }
  if (/\b(at work|lunch break|between meetings|before (a|my) meeting|office break)\b/i.test(text)) {
    extraSituation.push("work");
  }

  const hasDarkness = extraSecondary.includes("bleak");
  // Map "bleak/morally complex" requests to "drama" when primary is unknown — enables the darkness commitment clause
  const rawPrimary = firstKnownPrimary(intent.primaryIntents);
  const primary = wantsEmotionalRelief
    ? "comfort"
    : rawPrimary === "unknown" && hasDarkness
      ? "drama"
      : rawPrimary;
  const secondaryBase = intent.primaryIntents.filter((item) => item !== primary).slice(0, 4);

  return {
    primary,
    secondary: [...new Set([...secondaryBase, ...extraSecondary])].slice(0, 6),
    hardAvoids: intent.hardAvoids,
    softAvoids: intent.softAvoids,
    format: intent.requestedFormat ?? "any",
    language: intent.requestedLanguage ?? input.languagePreferences?.[0] ?? "any",
    situation: extraSituation,
    intensity: input.craziness === 3 ? "unhinged" : input.craziness === 2 ? "bold" : input.craziness === 0 ? "safe" : "curious",
    emotionalGoal: wantsEmotionalRelief
      ? "Provide emotionally containing relief without centering fresh grief, heartbreak, or romantic longing."
      : hasDarkness
        ? "Morally complex, bleak, or challenging emotional territory — do not soften to accessible or redemptive."
        : "Infer the best emotional outcome from the request while respecting hard constraints.",
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
  const inferredPrimary = firstKnownPrimary([primaryRaw, ...stringArray(value.secondary), local.primary]);
  // A model sometimes promotes a structured avoidance to the primary intent
  // ("romantic + comforting", avoids=["gore"] → primary "gore"). Explicit
  // controls are authoritative: an avoided concept cannot become the desired
  // outcome unless local parsing independently found it as a positive request.
  const primary = local.hardAvoids.includes(inferredPrimary) &&
    ![local.primary, ...local.secondary].includes(inferredPrimary)
    ? local.primary
    : inferredPrimary;
  const formatRaw = typeof value.format === "string" ? value.format.toLowerCase().trim() : "";
  const intensityRaw = typeof value.intensity === "string" ? value.intensity.toLowerCase().trim() : "";
  const llmSecondary = stringArray(value.secondary).filter((item) => {
    const normalized = item.toLowerCase();
    return !local.hardAvoids.includes(normalized) || [local.primary, ...local.secondary].includes(normalized);
  });
  const llmHardAvoids = stringArray(value.hardAvoids).map((item) => item.toLowerCase());
  const localPrimarySignals = new Set([local.primary, ...local.secondary]);
  const reconciledLlmHardAvoids = llmHardAvoids.filter((avoid) => {
    // The semantic classifier may echo a desired genre as an avoidance when a
    // nearby modifier is negative ("real horror, no jump scares"). Local
    // structured/negation parsing remains authoritative for explicit avoids.
    if (avoid === "horror" && localPrimarySignals.has("scare") && !local.hardAvoids.includes("horror")) return false;
    if (
      ["gore", "horror", "violence", "graphic violence"].includes(avoid) &&
      localPrimarySignals.has("gore") &&
      !local.hardAvoids.includes(avoid)
    ) return false;
    return true;
  });

  return {
    primary,
    // Merge local emotional-register signals (bleak, cathartic, weird) — the LLM often omits them
    secondary: [...new Set([...llmSecondary, ...local.secondary])].slice(0, 8),
    hardAvoids: [...new Set([...local.hardAvoids, ...reconciledLlmHardAvoids])],
    softAvoids: [...new Set([...local.softAvoids, ...stringArray(value.softAvoids).map((item) => item.toLowerCase())])],
    format: FORMAT_VALUES.has(formatRaw as IntentContract["format"]) ? formatRaw as IntentContract["format"] : local.format,
    language: typeof value.language === "string" && value.language.trim() ? value.language.trim() : local.language,
    // Situation is a factual viewing constraint, not a creative inference. The
    // classifier may explain typed context, but it must not invent bedtime,
    // transit, waiting, or social context that the user never supplied.
    situation: local.situation,
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
  // Free text and positive controls belong in the semantic sentence. Avoidance
  // controls are supplied separately below; including them in both places made
  // the classifier read "horror" as simultaneously wanted and rejected.
  const text = intentRequestText(input) || "No free text provided.";
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
  "confidence": 0.85,
  "ambiguity": "short note if request has conflicting signals, else empty"
}

Confidence is a number from 0 to 1 describing how certain you are about the interpretation. Use a realistic value such as 0.85 for a clear request; do not copy the example mechanically. Selected avoids are authoritative boundaries, not evidence that the user wants those concepts.
`;
}
