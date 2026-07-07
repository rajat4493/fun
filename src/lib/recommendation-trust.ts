import { RawRecommendation, RecommendRequest, Recommendation } from "@/lib/types";
import { requestText } from "@/lib/recommendation-utils";

export type TrustRejection = {
  title: string;
  reasons: string[];
};

export type TrustResult<T extends RawRecommendation | Recommendation> = {
  accepted: T[];
  rejected: TrustRejection[];
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function contentText(rec: RawRecommendation | Recommendation): string {
  return [
    rec.title,
    rec.format,
    rec.runtime,
    rec.vibe,
    rec.oneLine,
    ...(rec.whyItFits ?? []),
    rec.hiddenLayer?.headline,
    rec.hiddenLayer?.insight,
    rec.hiddenLayer?.classyJab,
  ].filter(Boolean).join(" ");
}

function requestHasNegated(input: RecommendRequest, pattern: RegExp): boolean {
  const text = requestText(input);
  const negation = /\b(no|not|avoid|without|don't want|do not want|less|skip|hate)\b/i;
  return negation.test(text) && pattern.test(text);
}

function activeAvoids(input: RecommendRequest): Set<string> {
  const avoids = new Set((input.avoids ?? []).map((avoid) => avoid.toLowerCase().trim()));
  if (requestHasNegated(input, /\bgore|gory|blood|bloody|splatter|body horror\b/i)) avoids.add("gore");
  if (requestHasNegated(input, /\bviolence|violent|brutal|action\b/i)) avoids.add("violence");
  if (requestHasNegated(input, /\bhorror|scary|ghost|haunted|supernatural\b/i)) avoids.add("horror");
  if (requestHasNegated(input, /\bheavy drama|heavy|drama|trauma|depressing|bleak\b/i)) avoids.add("heavy drama");
  if (requestHasNegated(input, /\bsad ending|tragic ending|sad\b/i)) avoids.add("sad ending");
  if (requestHasNegated(input, /\bslow|slow burn|slow-burn\b/i)) avoids.add("slow");
  return avoids;
}

function explicitlyWantsIntensity(input: RecommendRequest): boolean {
  const text = requestText(input);
  const avoids = activeAvoids(input);
  if (avoids.has("gore") || avoids.has("violence") || avoids.has("horror")) return false;
  return /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror|brutal horror|horror)\b/i.test(text);
}

const knownHorrorOrGoreTitles = new Set([
  "evildeadrise",
  "evildead",
  "terrifier",
  "terrifier2",
  "thesadness",
  "martyrs",
  "inside",
  "raw",
  "titane",
  "saw",
  "hostel",
  "hereditary",
  "midsommar",
  "whenevillurks",
  "possession",
  "audition",
  "funnygames",
  "irreversible",
  "saloor120daysofsodom",
]);

const goreTerms = /\b(gore|gory|bloody|blood-soaked|blood soaked|splatter|body horror|visceral violence|graphic violence|mutilation|dismember|cannibal|extreme horror|brutal horror|torture)\b/i;
const horrorTerms = /\b(horror|scary|haunted|ghost|possession|demonic|supernatural terror|slasher|zombie|evil dead|nightmare|occult|creature feature)\b/i;
const violenceTerms = /\b(violent|violence|brutal|brutality|blood|killer|serial killer|murder|revenge|war|combat|massacre|assassin|gangster|crime thriller|survival horror|torture)\b/i;
const heavyDramaTerms = /\b(heavy drama|devastating|harrowing|bleak|trauma|traumatic|abuse|grief|suicide|terminal|war|genocide|true crime|moral punishment|emotionally punishing|depressing)\b/i;
const sadEndingTerms = /\b(sad ending|tragic ending|devastating ending|bleak ending|heartbreaking|tragedy|tragic|grief)\b/i;
const slowTerms = /\b(slow|slow-burn|slow burn|meditative|contemplative|glacial|minimalist|patient pacing|hypnotic)\b/i;
const weirdTerms = /\b(weird|strange|unusual|offbeat|quirky|absurd|surreal|experimental|cult|wildly inventive|formally strange|bizarre|odd|unhinged)\b/i;
const funnyTerms = /\b(funny|comedy|comic|witty|satire|satirical|slapstick|banter|absurd|laugh|playful|farce)\b/i;

function parseRuntimeMinutes(runtime: string): number | null {
  const value = runtime.toLowerCase();
  const hourMinute = value.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2] ?? 0);
  const minute = value.match(/(\d+)\s*(?:min|mins|minutes|m)\b/);
  if (minute) return Number(minute[1]);
  return null;
}

function isEpisodeRuntime(rec: RawRecommendation | Recommendation): boolean {
  const value = `${rec.format} ${rec.runtime}`.toLowerCase();
  return /\b(series|episode|per episode|season)\b/.test(value);
}

function runtimeViolation(input: RecommendRequest, rec: RawRecommendation | Recommendation): string | null {
  const time = input.time?.toLowerCase();
  if (!time || time === "no preference") return null;

  const minutes = parseRuntimeMinutes(rec.runtime);
  if (time.includes("one episode")) {
    return isEpisodeRuntime(rec) ? null : "time: requested one episode";
  }
  if (!minutes) return null;
  if (time.includes("90") && !isEpisodeRuntime(rec) && minutes > 110) return `time: ${minutes} min exceeds 90 min mood`;
  if (time.includes("under 2") && !isEpisodeRuntime(rec) && minutes > 120) return `time: ${minutes} min exceeds under 2 hours`;
  return null;
}

function avoidanceViolations(input: RecommendRequest, rec: RawRecommendation | Recommendation): string[] {
  if (explicitlyWantsIntensity(input)) return [];
  const avoids = activeAvoids(input);
  const text = contentText(rec);
  const titleKey = normalize(rec.title);
  const reasons: string[] = [];

  const isKnownHorror = knownHorrorOrGoreTitles.has(titleKey);
  if (avoids.has("gore") && (isKnownHorror || goreTerms.test(text))) reasons.push("avoidance: gore");
  if (avoids.has("horror") && (isKnownHorror || horrorTerms.test(text) || goreTerms.test(text))) reasons.push("avoidance: horror");
  if (avoids.has("violence") && (isKnownHorror || violenceTerms.test(text) || goreTerms.test(text))) reasons.push("avoidance: violence");
  if (avoids.has("heavy drama") && heavyDramaTerms.test(text)) reasons.push("avoidance: heavy drama");
  if (avoids.has("sad ending") && sadEndingTerms.test(text)) reasons.push("avoidance: sad ending");
  if (avoids.has("slow") && slowTerms.test(text)) reasons.push("avoidance: slow");

  return [...new Set(reasons)];
}

function memoryViolation(input: RecommendRequest, rec: RawRecommendation | Recommendation): string | null {
  const title = normalize(rec.title);
  const seen = (input.seenTitles ?? []).some((item) => normalize(item) === title);
  if (seen) return "memory: already seen";
  const recent = (input.recentTitles ?? []).some((item) => normalize(item) === title);
  if (recent) return "memory: recently recommended";
  return null;
}

function confidenceViolation(rec: RawRecommendation | Recommendation): string | null {
  return typeof rec.confidence === "number" && rec.confidence < 60 ? `confidence: ${rec.confidence} below minimum` : null;
}

function positiveFitViolations(input: RecommendRequest, rec: RawRecommendation | Recommendation): string[] {
  const text = requestText(input);
  const recText = contentText(rec);
  const reasons: string[] = [];
  const wantsWeird = /\b(weird|strange|unusual|offbeat|quirky|absurd|surreal|experimental|cult|unhinged)\b/i.test(text);
  const wantsFunny = /\b(funny|comedy|laugh|witty|playful|banter)\b/i.test(text) || (input.wants ?? []).some((want) => /funny/i.test(want));

  if ((wantsWeird || ((input.craziness ?? 0) >= 3 && !explicitlyWantsIntensity(input))) && !weirdTerms.test(recText)) {
    reasons.push("fit: missing weird/unhinged signal");
  }
  if (wantsFunny && !funnyTerms.test(recText)) {
    reasons.push("fit: missing funny/comedy signal");
  }
  return reasons;
}

export function validateRecommendation<T extends RawRecommendation | Recommendation>(
  input: RecommendRequest,
  rec: T,
): TrustRejection | null {
  const reasons = [
    memoryViolation(input, rec),
    confidenceViolation(rec),
    runtimeViolation(input, rec),
    ...avoidanceViolations(input, rec),
    ...positiveFitViolations(input, rec),
  ].filter((reason): reason is string => Boolean(reason));

  return reasons.length ? { title: rec.title, reasons } : null;
}

export function applyTrustFilter<T extends RawRecommendation | Recommendation>(
  input: RecommendRequest,
  batch: T[],
): TrustResult<T> {
  const accepted: T[] = [];
  const rejected: TrustRejection[] = [];
  const seen = new Set<string>();

  for (const rec of batch) {
    const titleKey = normalize(rec.title);
    if (seen.has(titleKey)) {
      rejected.push({ title: rec.title, reasons: ["batch: duplicate title"] });
      continue;
    }
    seen.add(titleKey);
    const rejection = validateRecommendation(input, rec);
    if (rejection) rejected.push(rejection);
    else accepted.push(rec);
  }

  return { accepted, rejected };
}

export function rejectionPrompt(rejections: TrustRejection[]): string {
  if (!rejections.length) return "";
  return `\n\nBackend trust filter rejected these candidates. These are hard-boundary failures, not taste suggestions. Do not repeat them, do not recommend adjacent titles with the same issue, and fix the listed issues:\n${rejections
    .slice(0, 8)
    .map((item) => `- ${item.title}: ${item.reasons.join("; ")}`)
    .join("\n")}\nReturn three different valid candidates that preserve the emotional job while staying inside the boundaries.`;
}

export function safeFallback(input: RecommendRequest): RawRecommendation {
  const text = requestText(input);
  const wantsHindi = /\bhindi\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /hindi/i.test(language));
  const wantsWeirdSafe = /\b(weird|strange|unusual|offbeat|quirky|absurd|surreal|funny|comedy)\b/i.test(text) || (input.craziness ?? 0) >= 2;
  const isExcluded = (title: string) => {
    const key = normalize(title);
    return [...(input.recentTitles ?? []), ...(input.seenTitles ?? [])].some((item) => normalize(item) === key);
  };
  const format = "Film" as const;
  const base = {
    format,
    whereToWatch: {
      status: "unverified" as const,
      primary: "Availability not verified",
      note: "F.U.N used a safer close match because the stricter request could not be satisfied confidently.",
    },
    hiddenLayer: {
      headline: "Safer close match",
      insight: "When hard boundaries conflict with taste risk, F.U.N protects the boundaries first.",
      classyJab: "A perfect pick should not break trust.",
    },
  };

  if (wantsHindi) {
    const hindiFallbacks: RawRecommendation[] = [
      {
        title: "Do Dooni Chaar",
        year: "2010",
        runtime: "111 min",
        vibe: "warm, humane, low-regret",
        confidence: 72,
        oneLine: "Watch Do Dooni Chaar for an easy Hindi comfort pick that protects your avoidances.",
        whyItFits: [
          "It keeps the evening human and accessible without leaning on gore, horror, or heavy violence.",
          "The emotional weight stays everyday and low-regret rather than punishing.",
          "It is a safer close match when the stricter mood could not be satisfied cleanly.",
        ],
        hiddenTitles: [
          { title: "Piku", year: "2015" },
          { title: "Qarib Qarib Singlle", year: "2017" },
          { title: "Karwaan", year: "2018" },
        ],
        alternatives: ["Piku (2015)", "Qarib Qarib Singlle (2017)", "Karwaan (2018)"],
        ...base,
      },
      {
        title: "Qarib Qarib Singlle",
        year: "2017",
        runtime: "125 min",
        vibe: "gentle, funny, adult",
        confidence: 70,
        oneLine: "Watch Qarib Qarib Singlle when you want Hindi comfort with grown-up warmth and low punishment.",
        whyItFits: [
          "It keeps the mood conversational and humane rather than heavy or cruel.",
          "The comedy comes from two specific people, not broad noise.",
          "It is a safer close match when the first Hindi fallback was already shown.",
        ],
        hiddenTitles: [
          { title: "Piku", year: "2015" },
          { title: "Karwaan", year: "2018" },
          { title: "Do Dooni Chaar", year: "2010" },
        ],
        alternatives: ["Piku (2015)", "Karwaan (2018)", "Do Dooni Chaar (2010)"],
        ...base,
      },
    ];
    return hindiFallbacks.find((candidate) => !isExcluded(candidate.title)) ?? hindiFallbacks[0];
  }

  if (wantsWeirdSafe) {
    const weirdFallbacks: RawRecommendation[] = [
      {
        title: "Hundreds of Beavers",
        year: "2022",
        runtime: "108 min",
        vibe: "absurd, slapstick, wildly inventive",
        confidence: 76,
        oneLine: "Watch Hundreds of Beavers when you want something truly odd without breaking your avoidances.",
        whyItFits: [
          "It gives adventurous Taste Risk a strange, memorable shape without leaning on gore or horror.",
          "The comedy is physical and group-reactive, so it works when the mood wants energy rather than homework.",
          "It is a safer close match when stricter candidates crossed your boundaries.",
        ],
        hiddenTitles: [
          { title: "Marcel the Shell with Shoes On", year: "2021" },
          { title: "Brigsby Bear", year: "2017" },
          { title: "Brian and Charles", year: "2022" },
        ],
        alternatives: ["Marcel the Shell with Shoes On (2021)", "Brigsby Bear (2017)", "Brian and Charles (2022)"],
        ...base,
      },
      {
        title: "Brigsby Bear",
        year: "2017",
        runtime: "97 min",
        vibe: "offbeat, sweet, creative",
        confidence: 77,
        oneLine: "Watch Brigsby Bear for offbeat sweetness when you want weirdness with a human center.",
        whyItFits: [
          "It channels strangeness through imagination rather than shock.",
          "It keeps the experience emotionally safe without becoming bland.",
          "The runtime and tone make it easier to say yes tonight.",
        ],
        hiddenTitles: [
          { title: "Marcel the Shell with Shoes On", year: "2021" },
          { title: "Brian and Charles", year: "2022" },
          { title: "Dave Made a Maze", year: "2017" },
        ],
        alternatives: ["Marcel the Shell with Shoes On (2021)", "Brian and Charles (2022)", "Dave Made a Maze (2017)"],
        ...base,
      },
      {
        title: "Brian and Charles",
        year: "2022",
        runtime: "90 min",
        vibe: "eccentric, gentle, homemade",
        confidence: 74,
        oneLine: "Watch Brian and Charles when you want oddball charm without cruelty or shock.",
        whyItFits: [
          "It gives the night something strange and specific while staying soft around the edges.",
          "The humor is handmade and low-violence, so the avoidances stay protected.",
          "It works as a safe alternate when the first weird pick was already shown.",
        ],
        hiddenTitles: [
          { title: "Marcel the Shell with Shoes On", year: "2021" },
          { title: "Brigsby Bear", year: "2017" },
          { title: "Dave Made a Maze", year: "2017" },
        ],
        alternatives: ["Marcel the Shell with Shoes On (2021)", "Brigsby Bear (2017)", "Dave Made a Maze (2017)"],
        ...base,
      },
    ];
    return weirdFallbacks.find((candidate) => !isExcluded(candidate.title)) ?? weirdFallbacks[0];
  }

  const gentleFallbacks: RawRecommendation[] = [
    {
      title: "The Fundamentals of Caring",
      year: "2016",
      runtime: "97 min",
      vibe: "warm, humane, low-regret",
      confidence: 76,
      oneLine: "Watch The Fundamentals of Caring when you want something gentle, human, and easy to say yes to.",
      whyItFits: [
        "It avoids gore, horror, and heavy violence while still feeling like a real film, not filler.",
        "The runtime respects a short evening and keeps the effort budget low.",
        "It is a safer close match when the stricter mood could not be satisfied cleanly.",
      ],
      hiddenTitles: [
        { title: "The Half of It", year: "2020" },
        { title: "Paddleton", year: "2019" },
        { title: "Hunt for the Wilderpeople", year: "2016" },
      ],
      alternatives: ["The Half of It (2020)", "Paddleton (2019)", "Hunt for the Wilderpeople (2016)"],
      ...base,
    },
    {
      title: "Hunt for the Wilderpeople",
      year: "2016",
      runtime: "101 min",
      vibe: "warm, odd, adventurous",
      confidence: 75,
      oneLine: "Watch Hunt for the Wilderpeople when you want something humane, funny, and not emotionally punishing.",
      whyItFits: [
        "It has enough story movement to avoid feeling like homework.",
        "The warmth comes with bite and personality, not generic softness.",
        "It stays inside a low-regret comfort lane when stricter options fail.",
      ],
      hiddenTitles: [
        { title: "The Peanut Butter Falcon", year: "2019" },
        { title: "The Way Way Back", year: "2013" },
        { title: "Paddleton", year: "2019" },
      ],
      alternatives: ["The Peanut Butter Falcon (2019)", "The Way Way Back (2013)", "Paddleton (2019)"],
      ...base,
    },
    {
      title: "The Peanut Butter Falcon",
      year: "2019",
      runtime: "97 min",
      vibe: "kind, road-movie, easygoing",
      confidence: 74,
      oneLine: "Watch The Peanut Butter Falcon for a gentle road movie that is easy to enter and satisfying to leave.",
      whyItFits: [
        "It gives emotional payoff without turning the night heavy.",
        "The shape is familiar enough for low energy but specific enough to feel chosen.",
        "It avoids the darker lanes that would break the stated boundaries.",
      ],
      hiddenTitles: [
        { title: "Hunt for the Wilderpeople", year: "2016" },
        { title: "The Way Way Back", year: "2013" },
        { title: "Paddleton", year: "2019" },
      ],
      alternatives: ["Hunt for the Wilderpeople (2016)", "The Way Way Back (2013)", "Paddleton (2019)"],
      ...base,
    },
  ];

  return gentleFallbacks.find((candidate) => !isExcluded(candidate.title)) ?? gentleFallbacks[0];
}
