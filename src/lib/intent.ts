import { RecommendRequest } from "@/lib/types";
import { hasNegatedConcept, requestText } from "@/lib/recommendation-utils";

export type RecommendationIntent = {
  requestText: string;
  primaryIntents: string[];
  hardAvoids: string[];
  softAvoids: string[];
  requestedFormat?: "film" | "series" | "episode";
  runtimeLimitMinutes?: number;
  requestedLanguage?: string;
  hiddenGem: boolean;
  familySafe: boolean;
  workSafe: boolean;
};

const LANGUAGE_NAMES: Array<[RegExp, string]> = [
  [/\bhindi\b/i, "Hindi"],
  [/\bmalayalam\b/i, "Malayalam"],
  [/\btamil\b/i, "Tamil"],
  [/\btelugu\b/i, "Telugu"],
  [/\bbengali\b|\bbangla\b/i, "Bengali"],
  [/\bmarathi\b/i, "Marathi"],
  [/\bkannada\b/i, "Kannada"],
  [/\bkorean\b/i, "Korean"],
  [/\bjapanese\b/i, "Japanese"],
  [/\bfrench\b/i, "French"],
  [/\bpolish\b/i, "Polish"],
  [/\bspanish\b/i, "Spanish"],
  [/\bitalian\b/i, "Italian"],
  [/\bgerman\b/i, "German"],
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function requestedLanguage(text: string): string | undefined {
  for (const [pattern, name] of LANGUAGE_NAMES) {
    if (pattern.test(text)) return name;
  }
  return undefined;
}

function extractRuntimeLimit(text: string): number | undefined {
  const minuteLimit = text.match(/\b(?:under|less than|within|up to|max(?:imum)?|no more than)\s+(\d{1,3})\s*(?:min|mins|minutes)\b/i);
  if (minuteLimit) return Number(minuteLimit[1]);

  const plainMinutes = text.match(/\b(\d{1,3})\s*(?:min|mins|minutes)\b/i);
  if (plainMinutes) return Number(plainMinutes[1]);

  if (/\b(?:under|less than|within|up to|max(?:imum)?|no more than)\s+(?:two|2)\s+hours?\b/i.test(text)) return 120;
  return undefined;
}

function requestedFormat(text: string): RecommendationIntent["requestedFormat"] {
  if (/\b(one|1)\s+episode\b|\ban episode\b/i.test(text)) return "episode";
  if (/\b(series|show|season|episodes|binge)\b/i.test(text)) return "series";
  if (/\b(movie|film|feature)\b/i.test(text)) return "film";
  return undefined;
}

export function extractIntent(input: RecommendRequest): RecommendationIntent {
  const text = requestText(input);
  const hardAvoids = new Set<string>();
  const softAvoids = new Set<string>();
  const primaryIntents = new Set<string>();

  for (const avoid of input.avoids ?? []) {
    const value = avoid.toLowerCase().trim();
    if (/\bgore|gory|blood\b/.test(value)) hardAvoids.add("gore");
    else if (/\bhorror|scary\b/.test(value)) hardAvoids.add("horror");
    else if (/\bviolence|violent\b/.test(value)) hardAvoids.add("violence");
    else if (/\bsex|sexual|nudity|erotic|explicit\b/.test(value)) hardAvoids.add("sex");
    else if (/\bslow|slow burn|slow-burn\b/.test(value)) softAvoids.add("slow pacing");
    else if (/\bheavy drama|heavy\b/.test(value)) softAvoids.add("heavy drama");
    else if (/\bsad ending|tragic ending|sad\b/.test(value)) softAvoids.add("sad ending");
  }

  if (hasNegatedConcept(text, /\bgore|gory|blood|bloody|splatter|body horror\b/i)) hardAvoids.add("gore");
  if (hasNegatedConcept(text, /\bviolence|violent|brutal|graphic violence\b/i)) hardAvoids.add("violence");
  if (hasNegatedConcept(text, /\bhorror|scary|ghost|haunted|supernatural\b/i)) hardAvoids.add("horror");
  if (hasNegatedConcept(text, /\bsex|sexual|nudity|erotic|explicit|raunchy|awkward sexual content\b/i)) hardAvoids.add("sex");

  if (hasNegatedConcept(text, /\bheavy drama|heavy|trauma|depressing|bleak\b/i)) softAvoids.add("heavy drama");
  if (hasNegatedConcept(text, /\bsad ending|tragic ending|sad\b/i)) softAvoids.add("sad ending");
  if (hasNegatedConcept(text, /\bslow|slow burn|slow-burn\b/i)) softAvoids.add("slow pacing");

  const familySafe = /\b(family safe|family-safe|with family|with parents|parents|kids|children)\b/i.test(text);
  const workSafe = /\b(work safe|work-safe|at work|office|lunch break|between meetings)\b/i.test(text);
  if (familySafe) {
    hardAvoids.add("sex");
    hardAvoids.add("gore");
    hardAvoids.add("horror");
    hardAvoids.add("graphic violence");
  }
  if (workSafe) {
    hardAvoids.add("sex");
    hardAvoids.add("graphic violence");
  }

  if (/\b(shit scared|scare|scared|scary|terrify|terrified|terrifying|frighten|frightened|frightening|creep out|creepy|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i.test(text) &&
    !hasNegatedConcept(text, /\b(scary|scare|scared|terrify|terrified|frighten|frightened|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i)) {
    primaryIntents.add("scare");
  }
  if (/\b(make (me|my partner|us|them) cry|tearjerker|tear jerker|cry|crying|sob|weep|devastating|emotionally wreck|break my heart)\b/i.test(text) &&
    !hasNegatedConcept(text, /\b(cry|crying|sad|devastating|depressing|bleak|heavy)\b/i)) {
    primaryIntents.add("cry");
  }
  if (/\b(comedy|funny|laugh|hilarious|witty|humor|humour)\b/i.test(text)) primaryIntents.add("comedy");
  if (/\b(thriller|suspense|mystery|crime thriller|tense and clever|paranoid|whodunit)\b/i.test(text)) primaryIntents.add("thriller");
  if (/\b(romance|romantic|love story|date night)\b/i.test(text)) primaryIntents.add("romance");
  if (/\b(weird|strange|offbeat|surreal|absurd|bizarre|unusual)\b/i.test(text)) primaryIntents.add("weird");
  if (/\b(calm|calming|soothe|soothing|relax|relaxing|comfort|comforting|cozy|cosy)\b/i.test(text)) primaryIntents.add("comfort");
  if (/\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(text) &&
    !hasNegatedConcept(text, /\b(gore|gory|blood|bloody|violence|violent)\b/i)) {
    primaryIntents.add("gore");
  }

  const format = requestedFormat(text);
  if (format) primaryIntents.add(format);

  const runtimeLimitMinutes = extractRuntimeLimit(text);
  if (runtimeLimitMinutes) primaryIntents.add("runtime-limit");

  const hiddenGem = /\b(hidden\s+gem|underrated|overlooked|buried|less\s+obvious|probably haven't seen|probably have not seen)\b/i.test(text);
  if (hiddenGem) primaryIntents.add("hidden-gem");

  return {
    requestText: text,
    primaryIntents: unique([...primaryIntents]),
    hardAvoids: unique([...hardAvoids]),
    softAvoids: unique([...softAvoids]),
    requestedFormat: format,
    runtimeLimitMinutes,
    requestedLanguage: requestedLanguage(text),
    hiddenGem,
    familySafe,
    workSafe,
  };
}
