import { RawRecommendation, RecommendRequest, Recommendation } from "@/lib/types";
import { hasNegatedConcept, requestText } from "@/lib/recommendation-utils";

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
  return hasNegatedConcept(requestText(input), pattern);
}

function wantsFamilySafe(input: RecommendRequest): boolean {
  const text = [requestText(input), input.viewingContext, input.contextHint].filter(Boolean).join(" ");
  return /\b(family safe|family-safe|family|with family|with parents|parents|kids|children|work safe|work-safe|at work|office)\b/i.test(text);
}

function activeHardAvoids(input: RecommendRequest): Set<string> {
  const avoids = new Set<string>();
  for (const avoid of input.avoids ?? []) {
    const value = avoid.toLowerCase().trim();
    if (/\bgore|gory|blood\b/.test(value)) avoids.add("gore");
    if (/\bhorror|scary\b/.test(value)) avoids.add("horror");
    if (/\bviolence|violent\b/.test(value)) avoids.add("violence");
  }
  if (requestHasNegated(input, /\bgore|gory|blood|bloody|splatter|body horror\b/i)) avoids.add("gore");
  if (requestHasNegated(input, /\bviolence|violent|brutal|action\b/i)) avoids.add("violence");
  if (requestHasNegated(input, /\bhorror|scary|ghost|haunted|supernatural\b/i)) avoids.add("horror");
  if (requestHasNegated(input, /\bsex|sexual|nudity|erotic|explicit|raunchy|awkward sexual content\b/i)) avoids.add("sex");
  if (wantsFamilySafe(input)) {
    avoids.add("sex");
    avoids.add("gore");
    avoids.add("horror");
    avoids.add("graphic violence");
  }
  return avoids;
}

export function activeHardAvoidanceKeys(input: RecommendRequest): string[] {
  return [...activeHardAvoids(input)];
}

function explicitlyWantsIntensity(input: RecommendRequest): boolean {
  const text = requestText(input);
  const avoids = activeHardAvoids(input);
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
  "aserbianfilm",
  "antichrist",
  "eraserhead",
  "enterthevoid",
  "tetsuo",
  "tetsuotheironman",
]);

const goreTerms = /\b(gore|gory|bloody|blood-soaked|blood soaked|splatter|body horror|visceral violence|graphic violence|mutilation|dismember|cannibal|extreme horror|brutal horror|torture)\b/i;
const horrorTerms = /\b(horror|scary|haunted|ghost|possession|demonic|supernatural terror|slasher|zombie|evil dead|nightmare|occult|creature feature)\b/i;
const violenceTerms = /\b(violent|violence|disturbing violence|brutal|brutality|blood|killer|serial killer|murder|revenge|war|combat|massacre|assassin|gangster|crime thriller|survival horror|torture)\b/i;
const graphicViolenceTerms = /\b(graphic violence|visceral violence|brutal killing|mutilation|dismember|massacre|torture|blood-soaked|blood soaked|extreme horror|brutal horror)\b/i;
const sexualTerms = /\b(explicit sex|sexual content|sex scene|sex scenes|nudity|nude|erotic|raunchy|pornographic|awkward sexual content)\b/i;
const weirdTerms = /\b(weird|strange|unusual|offbeat|quirky|absurd|surreal|experimental|cult|wildly inventive|formally strange|bizarre|odd|unhinged)\b/i;
const funnyTerms = /\b(funny|comedy|comic|humor|humour|humorous|witty|satire|satirical|slapstick|banter|absurd|laugh|playful|farce)\b/i;
const thrillerTerms = /\b(thriller|suspense|mystery|crime|noir|detective|investigation|paranoid|tense|whodunit|conspiracy|killer|murder|cat-and-mouse|cat and mouse)\b/i;
const romanceTerms = /\b(romance|romantic|love story|love|chemistry|relationship|date|courtship|tender|flirt|heartfelt)\b/i;
const fearTerms = /\b(scary|scare|scared|terrify|terrified|terrifying|frighten|frightened|frightening|horror|dread|nightmare|haunted|ghost|possession|demonic|supernatural terror|jump scare|jumpscare|creepy|panic|fear)\b/i;

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
  const request = requestText(input).toLowerCase();
  const time = input.time?.toLowerCase();
  const minutes = parseRuntimeMinutes(rec.runtime);
  if (time?.includes("one episode") || /\b(one|1)\s+episode\b|\ban episode\b/.test(request)) {
    return isEpisodeRuntime(rec) ? null : "time: requested one episode";
  }
  if (!minutes) return null;

  const freeTextLimit = request.match(/\b(?:under|less than|within|up to|max(?:imum)?|no more than)\s+(\d{1,3})\s*(?:min|mins|minutes)\b/);
  const plainMinuteNeed = request.match(/\b(\d{1,3})\s*(?:min|mins|minutes)\b/);
  const requestedLimit = freeTextLimit ? Number(freeTextLimit[1]) : plainMinuteNeed ? Number(plainMinuteNeed[1]) : null;
  if (requestedLimit && requestedLimit >= 10 && requestedLimit <= 240 && minutes > requestedLimit) {
    return `time: ${minutes} min exceeds ${requestedLimit} min request`;
  }
  if (/\b(?:under|less than|within|up to|max(?:imum)?|no more than)\s+(?:two|2)\s+hours?\b/.test(request) && minutes > 120) {
    return `time: ${minutes} min exceeds under 2 hours`;
  }

  if (!time || time === "no preference") return null;
  if (time.includes("90") && !isEpisodeRuntime(rec) && minutes > 110) return `time: ${minutes} min exceeds 90 min mood`;
  if (time.includes("under 2") && !isEpisodeRuntime(rec) && minutes > 120) return `time: ${minutes} min exceeds under 2 hours`;
  return null;
}

function avoidanceViolations(input: RecommendRequest, rec: RawRecommendation | Recommendation): string[] {
  const allowIntensity = explicitlyWantsIntensity(input);
  const avoids = activeHardAvoids(input);
  const text = contentText(rec);
  const titleKey = normalize(rec.title);
  const reasons: string[] = [];

  const isKnownHorror = knownHorrorOrGoreTitles.has(titleKey);
  if (!allowIntensity && avoids.has("gore") && (isKnownHorror || goreTerms.test(text))) reasons.push("avoidance: gore");
  if (!allowIntensity && avoids.has("horror") && (isKnownHorror || horrorTerms.test(text) || goreTerms.test(text))) reasons.push("avoidance: horror");
  if (!allowIntensity && avoids.has("violence") && (isKnownHorror || violenceTerms.test(text) || goreTerms.test(text))) reasons.push("avoidance: violence");
  if (!allowIntensity && avoids.has("graphic violence") && (isKnownHorror || graphicViolenceTerms.test(text) || goreTerms.test(text))) reasons.push("avoidance: graphic violence");
  if (avoids.has("sex") && sexualTerms.test(text)) reasons.push("avoidance: explicit sexual content");

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

const overRecommendedHiddenGemTitles = new Set([
  "andhadhun",
  "drishyam",
  "drishyam2",
  "kahaani",
  "masaan",
  "tumbbad",
  "se7en",
  "seven",
  "gonegirl",
  "zodiac",
  "knivesout",
  "getout",
  "thesilenceofthelambs",
]);

const softScareFalsePositiveTitles = new Set([
  "imthinkingofendingthings",
  "imthinkingofendingthings2020",
  "thelobster",
  "beingjohnmalkovich",
  "synecdochenewyork",
  "anomalisa",
]);

function explicitFormatViolation(input: RecommendRequest, rec: RawRecommendation | Recommendation): string | null {
  const request = requestText(input);
  const format = `${rec.format} ${rec.runtime}`.toLowerCase();
  const asksForFilm = /\b(movie|film|feature)\b/i.test(request);
  const asksForSeries = /\b(series|show|season|episode|episodes|binge)\b/i.test(request);

  if (asksForFilm && /\b(series|episode|season)\b/.test(format)) return "intent: requested a film/movie, got series/episode";
  if (asksForSeries && rec.format === "Film") return "intent: requested a series/show/episode, got film";
  return null;
}

function explicitGenreViolations(input: RecommendRequest, rec: RawRecommendation | Recommendation): string[] {
  const request = requestText(input);
  const text = contentText(rec);
  const reasons: string[] = [];

  if (/\b(thriller|suspense|mystery|crime thriller|tense and clever)\b/i.test(request) && !thrillerTerms.test(text)) {
    reasons.push("intent: requested thriller/suspense");
  }
  if (/\b(comedy|funny|laugh|hilarious|witty)\b/i.test(request) && !funnyTerms.test(text)) {
    reasons.push("intent: requested comedy/funny");
  }
  if (/\b(romance|romantic|love story|date night)\b/i.test(request) && !romanceTerms.test(text)) {
    reasons.push("intent: requested romance");
  }
  if (/\b(shit scared|scare|scared|scary|terrify|terrified|terrifying|frighten|frightened|frightening|creep out|creepy|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i.test(request) &&
    !requestHasNegated(input, /\b(scary|scare|scared|terrify|terrified|frighten|frightened|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i)) {
    if (softScareFalsePositiveTitles.has(normalize(rec.title)) || !fearTerms.test(text)) {
      reasons.push("intent: requested genuinely scary/fear-inducing");
    }
  }
  if (/\b(weird|strange|offbeat|surreal|absurd|bizarre)\b/i.test(request) && !weirdTerms.test(text)) {
    reasons.push("intent: requested weird/offbeat");
  }

  return reasons;
}

function hiddenGemViolation(input: RecommendRequest, rec: RawRecommendation | Recommendation): string | null {
  const request = requestText(input);
  if (!/\b(hidden\s+gem|underrated|overlooked|buried|less\s+obvious|probably haven't seen|probably have not seen)\b/i.test(request)) {
    return null;
  }

  return overRecommendedHiddenGemTitles.has(normalize(rec.title))
    ? "intent: hidden gem request got an over-recommended title"
    : null;
}

function positiveFitViolations(input: RecommendRequest, rec: RawRecommendation | Recommendation): string[] {
  return [
    explicitFormatViolation(input, rec),
    hiddenGemViolation(input, rec),
    ...explicitGenreViolations(input, rec),
  ].filter((reason): reason is string => Boolean(reason));
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

  const avoidanceViolations = rejections.flatMap((r) => r.reasons.filter((reason) => reason.startsWith("avoidance:")));
  const memoryViolations = rejections.flatMap((r) => r.reasons.filter((reason) => reason.startsWith("memory:")));
  const runtimeViolations = rejections.flatMap((r) => r.reasons.filter((reason) => reason.startsWith("time:")));
  const intentViolations = rejections.flatMap((r) => r.reasons.filter((reason) => reason.startsWith("intent:")));

  const avoidanceNote = avoidanceViolations.length
    ? `\n⛔ Avoidance violations found: ${[...new Set(avoidanceViolations)].join(", ")}. Do NOT recommend anything in these categories or adjacent genres — this is absolute regardless of Taste Risk or craziness level.`
    : "";
  const memoryNote = memoryViolations.length
    ? `\n⛔ Memory violations: titles already seen or recently recommended. Pick something the user has not encountered before.`
    : "";
  const runtimeNote = runtimeViolations.length
    ? `\n⛔ Runtime violations: ${[...new Set(runtimeViolations)].join(", ")}. Stay within the user's stated time preference.`
    : "";
  const intentNote = intentViolations.length
    ? `\n⛔ Intent violations: ${[...new Set(intentViolations)].join(", ")}. The replacement must satisfy the explicit genre/type/discovery request, not just the broad mood.`
    : "";

  return `\n\nBackend trust filter REJECTED the previous candidates. These are hard-boundary failures — not preference suggestions. Do not repeat any rejected title, do not pick thematically adjacent titles that would hit the same boundary:
${rejections.slice(0, 8).map((item) => `- "${item.title}" rejected: ${item.reasons.join("; ")}`).join("\n")}
${avoidanceNote}${memoryNote}${runtimeNote}${intentNote}
Return three completely different valid candidates that preserve the emotional job while staying strictly inside all boundaries.`;
}

export function safeFallback(input: RecommendRequest): RawRecommendation {
  const text = requestText(input);
  const wantsHindi = /\bhindi\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /hindi/i.test(language));
  const wantsThriller = /\b(thriller|suspense|mystery|crime thriller|tense and clever)\b/i.test(text);
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

  if (wantsHindi && wantsThriller) {
    const hindiThrillers: RawRecommendation[] = [
      {
        title: "Aamir",
        year: "2008",
        runtime: "99 min",
        vibe: "Hindi thriller, tense, compact",
        confidence: 76,
        oneLine: "Watch Aamir for a lean Hindi thriller built around pressure, movement, and moral panic.",
        whyItFits: [
          "It stays in the Hindi thriller lane instead of drifting into family drama.",
          "The runtime is compact enough for a focused night.",
          "It feels less over-recommended than the usual discovery-thriller defaults.",
        ],
        hiddenTitles: [
          { title: "Kaun", year: "1999" },
          { title: "A Death in the Gunj", year: "2017" },
          { title: "Ek Hasina Thi", year: "2004" },
        ],
        alternatives: ["Kaun (1999)", "A Death in the Gunj (2017)", "Ek Hasina Thi (2004)"],
        ...base,
      },
      {
        title: "Kaun",
        year: "1999",
        runtime: "90 min",
        vibe: "Hindi thriller, claustrophobic, tense",
        confidence: 74,
        oneLine: "Watch Kaun for a tight Hindi suspense chamber piece that keeps the mood sharp.",
        whyItFits: [
          "It is unmistakably a thriller, not a broad emotional serial.",
          "The contained setup keeps the watch focused and direct.",
          "Its cult reputation makes it feel like a real discovery pick.",
        ],
        hiddenTitles: [
          { title: "Aamir", year: "2008" },
          { title: "A Death in the Gunj", year: "2017" },
          { title: "404: Error Not Found", year: "2011" },
        ],
        alternatives: ["Aamir (2008)", "A Death in the Gunj (2017)", "404: Error Not Found (2011)"],
        ...base,
      },
      {
        title: "A Death in the Gunj",
        year: "2017",
        runtime: "110 min",
        vibe: "Indian thriller, uneasy, intimate",
        confidence: 72,
        oneLine: "Watch A Death in the Gunj for an Indian slow-burn thriller with quiet menace and real emotional control.",
        whyItFits: [
          "It is an Indian-market thriller with unease built into the social setting.",
          "The tension is character-led rather than generic crime noise.",
          "It is acclaimed without being the default Hindi-thriller answer.",
        ],
        hiddenTitles: [
          { title: "Aamir", year: "2008" },
          { title: "Kaun", year: "1999" },
          { title: "Ek Hasina Thi", year: "2004" },
        ],
        alternatives: ["Aamir (2008)", "Kaun (1999)", "Ek Hasina Thi (2004)"],
        ...base,
      },
    ];
    return hindiThrillers.find((rec) => !isExcluded(rec.title)) ?? hindiThrillers[0];
  }

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
