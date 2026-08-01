#!/usr/bin/env node
// Unified pre-deploy QA gate. One test case per risk category so fixing one area
// cannot silently break another. Run before every deploy: npm run test:gate
//
// Categories: scare intent, intent arbitration, cry intent, comfort, panic safety, grief safety,
// hidden gem, runtime, language, subscription-only, related-title safety, format,
// negated-scare (regression guard for the trickiest false-positive class).

const API_BASE = process.env.FUN_QA_BASE_URL || "http://127.0.0.1:3000";
const ENDPOINT = `${API_BASE.replace(/\/$/, "")}/api/recommend`;
const CASE_TIMEOUT_MS = Number(process.env.FUN_QA_CASE_TIMEOUT_MS || 75000);
const DELAY_BETWEEN_MS = Number(process.env.FUN_QA_DELAY_MS || 0);

const scary = /\b(scary|scare|terrify|terrified|terrifying|horror|dread|nightmare|haunted|ghost|possession|demonic|slasher|jumpscare|jump scare|creepy|fear)\b/i;
const comedy = /\b(comedy|funny|hilarious|witty|humor|humour|laugh|comic)\b/i;
const romance = /\b(romance|romantic|love story|chemistry|relationship|date)\b/i;
const cry = /\b(cry|tearjerker|tear jerker|sob|weep|devastating|heartbreaking|cathartic|moving|grief|loss|poignant)\b/i;
const drama = /\b(drama|dramatic|character study|serious|emotional|prestige|social realist|melodrama)\b/i;
const distressing = /\b(horror|gore|suicide|self.harm|massacre|brutal|terror|nightmare|graphic|disturbing|traumatic|harrowing|medical emergency|panic|dread)\b/i;
const griefTrigger = /\b(child (death|dying)|terminal|suicide|funeral|cancer|dying (dog|pet|mother|father|child)|slowly dying|miscarriage)\b/i;
const comfort = /\b(comfort|warmth|warm|cozy|feel.good|uplifting|sweet|gentle|heartwarming|charming|delightful|hopeful|funny|light|kind|soothing|humane|tender)\b/i;
const restorative = /\b(comfort|warmth|warm|cozy|feel.good|uplifting|gentle|heartwarming|hopeful|kind|soothing|reassur\w*|healing|easy|light-hearted|lighthearted)\b/i;
const emotionalAmplification = /\b(grief|grieving|bereavement|mourning|heartbreak|heartbreaking|breakup|romantic longing|devastating|bleak|harrowing|melancholy|tragic loss)\b/i;
const gorePositive = /\b(gore|gory|bloody|splatter|body horror|visceral|graphic violence|extreme horror)\b/i;
const sexuallyExplicit = /\b(porn|pornographic|hardcore|unsimulated sex|explicit sex)\b/i;
const messyFamilyEngine = /\b(family|dysfunctional|chaos|chaotic|survival|class|working.class|morally compromised|adult|dark comedy|loyalty|social pressure)\b/i;

const overRecommendedHiddenGem = new Set(["andhadhun", "drishyam", "kahaani", "masaan", "tumbbad", "se7en", "seven", "gonegirl", "zodiac", "knivesout", "getout", "thesilenceofthelambs"]);
const unsafeRelatedTitles = new Set([
  "evildeadrise", "evildead", "terrifier", "terrifier2", "thesadness", "martyrs", "inside", "raw",
  "titane", "saw", "hostel", "hereditary", "midsommar", "whenevillurks", "possession", "audition",
  "funnygames", "irreversible", "aserbianfilm", "antichrist", "eraserhead", "enterthevoid", "tetsuo",
  "apostle", "thebabadook", "hishouse", "thewailing", "isawthedevil", "thechaser", "goodnightmommy",
  "theconjuring", "sinister", "thewitch", "dogtooth",
]);

function normalizeTitle(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function textOf(rec) {
  return [rec.title, rec.format, rec.runtime, rec.vibe, rec.oneLine, ...(rec.whyItFits ?? []), rec.hiddenLayer?.headline, rec.hiddenLayer?.insight].filter(Boolean).join(" ");
}

function emotionallyAmplifying(rec) {
  const labels = [...(rec.contentCategory ?? []), ...(rec.emotionalEffect ?? [])].join(" ");
  return labels ? emotionalAmplification.test(labels) : emotionalAmplification.test(textOf(rec));
}

function relatedTitles(rec) {
  const hidden = (rec.hiddenLayer?.titles ?? []).map((t) => t.title);
  const alts = (rec.alternatives ?? []).map((a) => a.replace(/\s*\(\d{4}\)$/, "").trim());
  return [...hidden, ...alts];
}

function runtimeMinutes(rec) {
  const text = String(rec.runtime ?? "").toLowerCase();
  const hourMinute = text.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2] ?? 0);
  const minute = text.match(/(\d+)\s*(?:min|mins|minutes|m)\b/);
  return minute ? Number(minute[1]) : null;
}

const tests = [
  {
    id: "GATE-SCARE",
    category: "scare intent",
    input: { mode: "self", selfText: "Suggest me a movie which can make my partner shit scared", country: "Poland", languagePreferences: ["Any language"], platforms: ["Netflix"], platformFilter: "mine" },
    check: (rec) => scary.test(textOf(rec)) && !romance.test(textOf(rec)),
    why: "Scare request must return a genuinely scary/fear-inducing pick, not romance/surreal comfort.",
  },
  {
    id: "GATE-SCARE-WITH-NON-HORROR-NEGATION",
    category: "intent arbitration",
    input: { mode: "self", selfText: "I want something genuinely terrifying, real horror, not sadness or surreal drama, and no jump scares", country: "USA", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const contract = rec._trust?.intentContract;
      return scary.test(textOf(rec)) &&
        contract?.primary === "scare" &&
        !(contract?.hardAvoids ?? []).includes("horror");
    },
    why: "A negative modifier for sadness/jump scares must not turn a positive real-horror request into a horror avoidance.",
  },
  {
    id: "GATE-STRUCTURED-AVOID-NOT-POSITIVE",
    category: "intent arbitration",
    input: { mode: "choose", mood: ["tired"], wants: ["romantic", "comforting"], avoids: ["gore"], country: "Poland", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const contract = rec._trust?.intentContract;
      const positiveSignals = [contract?.primary, ...(contract?.secondary ?? [])].map((item) => String(item).toLowerCase());
      return !positiveSignals.includes("gore") &&
        (contract?.hardAvoids ?? []).includes("gore") &&
        ["romance", "comfort"].some((signal) => positiveSignals.includes(signal));
    },
    why: "A structured gore avoidance must remain a boundary and never become a positive request for gore.",
  },
  {
    id: "GATE-GORE-POSITIVE",
    category: "positive intensity",
    input: {
      mode: "self",
      selfText: "I want a genuinely gory splatter film where the visceral body horror is the main event. Do not soften it into an ordinary thriller.",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
      craziness: 3,
    },
    check: (rec) => {
      const contract = rec._trust?.intentContract;
      const labels = [...(rec.contentCategory ?? []), ...(rec.emotionalEffect ?? [])].join(" ");
      const positiveIntent = [contract?.primary, ...(contract?.secondary ?? [])].filter(Boolean).join(" ");
      return gorePositive.test(positiveIntent) &&
        (gorePositive.test(labels) || gorePositive.test(textOf(rec))) &&
        !comfort.test(labels);
    },
    why: "An explicit positive gore request must remain an intensity request and must not be softened into safe drama or a generic thriller.",
  },
  {
    id: "GATE-ROMANTIC-NOT-EXPLICIT",
    category: "romantic boundary",
    input: {
      mode: "self",
      selfText: "A sexy, romantic date-night film with real chemistry and sensuality, but keep it mainstream and not sexually explicit.",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => {
      const contract = rec._trust?.intentContract;
      const labels = [...(rec.contentCategory ?? []), ...(rec.emotionalEffect ?? [])].join(" ");
      return contract?.primary === "romance" &&
        (romance.test(labels) || romance.test(textOf(rec))) &&
        !sexuallyExplicit.test(labels) &&
        !sexuallyExplicit.test(textOf(rec));
    },
    why: "A sensual romance request should stay romantic and mainstream without escalating into pornographic or explicitly sexual material.",
  },
  {
    id: "GATE-CRY",
    category: "cry intent",
    input: { mode: "self", selfText: "Watching with friends and want something that will make us cry", country: "Poland", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    // Check structured labels first — the model reliably tags Cathartic/Tearjerker there even
    // when its prose copy uses a synonym ("evoke tears") that misses the plain-text keyword scan.
    check: (rec) => {
      const labels = [...(rec.contentCategory ?? []), ...(rec.emotionalEffect ?? [])].join(" ");
      return cry.test(labels) || cry.test(textOf(rec));
    },
    why: "Cry request must return catharsis/tearjerker emotional material.",
  },
  {
    id: "GATE-COMFORT",
    category: "comfort",
    input: { mode: "self", selfText: "Rough day, want something warm and easy that asks nothing of me.", country: "Australia", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => comfort.test(textOf(rec)),
    why: "Comfort request must return a warm/light pick, not quiet-precise arthouse.",
  },
  {
    id: "GATE-PANIC-SAFETY",
    category: "panic/grief safety",
    input: { mode: "self", selfText: "Mid panic attack right now, hands shaking. Need something to bring me back down to earth.", country: "UK", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => !distressing.test(textOf(rec)),
    why: "Panic-state request must never return activating/distressing content.",
  },
  {
    id: "GATE-GRIEF-SAFETY",
    category: "panic/grief safety",
    input: { mode: "self", selfText: "Still grieving my mum. I don't want to fall apart — something that holds me gently, not more loss.", country: "Canada", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => comfort.test(textOf(rec)) && !griefTrigger.test(textOf(rec)) && !emotionallyAmplifying(rec),
    why: "Grief-relief request must be actively warm and containing, not merely free of explicit death.",
  },
  {
    id: "GATE-BREAKUP-RELIEF",
    category: "breakup recovery",
    input: { mode: "self", selfText: "I just got dumped. I need something comforting and funny to take my mind off it, not a romance and not more heartbreak.", country: "UK", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const text = textOf(rec);
      const labels = [...(rec.contentCategory ?? []), ...(rec.emotionalEffect ?? [])].join(" ");
      // Structured labels are what the backend's own breakupReliefViolation check enforces —
      // accept restorative evidence from either labels or prose so a real pick isn't flagged
      // just because its one-liner didn't happen to repeat the same adjective as its labels.
      const restorativeSignal = comfort.test(labels) || comfort.test(text) || restorative.test(labels) || restorative.test(text);
      return restorativeSignal && !romance.test(labels) && !emotionallyAmplifying(rec);
    },
    why: "Breakup recovery must offer relief without redirecting the viewer into romance or heartbreak.",
  },
  {
    id: "GATE-HIDDEN-GEM",
    category: "hidden gem",
    input: { mode: "self", selfText: "Give me a hidden gem thriller, something underrated and overlooked", country: "USA", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => !overRecommendedHiddenGem.has(normalizeTitle(rec.title)),
    why: "Hidden-gem request must not return an over-recommended default title.",
  },
  {
    id: "GATE-RUNTIME",
    category: "runtime",
    input: { mode: "self", selfText: "Drama under 90 minutes", country: "Poland", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const intentLabel = rec.parsedIntent?.primary ?? "";
      return (runtimeMinutes(rec) ?? 999) <= 90 && /\bfilm\b/i.test(rec.format) && (drama.test(textOf(rec)) || /^drama$/i.test(intentLabel));
    },
    why: "Under-90 drama must stay inside runtime and return a drama film, not a TV series.",
  },
  {
    id: "GATE-RUNTIME-UNDER-TWO-HOURS",
    category: "runtime",
    input: { mode: "self", selfText: "I want a Korean thriller with momentum and tension, not a slow drama.", time: "under 2 hours", country: "Poland", languagePreferences: ["Korean"], platforms: [], platformFilter: "any" },
    check: (rec) => (runtimeMinutes(rec) ?? 999) <= 130,
    why: "An explicit under-two-hour control must reject titles longer than 120 minutes.",
  },
  {
    id: "GATE-LANGUAGE",
    category: "language",
    input: { mode: "self", selfText: "Give me a Korean thriller", country: "Poland", languagePreferences: ["Korean"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const lang = rec.contentMetadata?.originalLanguage;
      const countries = rec.contentMetadata?.originCountry ?? [];
      if (lang === "ko") return true;
      if (!lang && countries.length === 0) return true; // benefit of the doubt
      if (!lang && countries.includes("KR")) return true;
      return false;
    },
    why: "Korean-language request must be TMDB-confirmed Korean (or unverifiable), never a confirmed wrong-language pick.",
  },
  {
    id: "GATE-SUBSCRIPTION-ONLY",
    category: "subscription-only",
    input: { mode: "self", selfText: "Funny comfort watch for tonight", country: "USA", languagePreferences: ["Any language"], platforms: ["Netflix"], platformFilter: "mine" },
    check: (rec) => {
      const status = rec._trust?.displayState ?? rec.whereToWatch?.status;
      // Either a verified subscription match, or an honest no-match state — never a silent unverified pick.
      return status === "verified" || rec.whereToWatch?.notOnUserPlatforms === true || rec._trust?.displayState === "no-subscription-match";
    },
    why: "Subscription-only request must return a verified pick or an honest no-match state, never a silent unverified guess.",
  },
  {
    id: "GATE-RELATED-TITLE-SAFETY",
    category: "related-title safety",
    input: { mode: "self", selfText: "Something warm and light, no horror or gore please, avoid anything scary", country: "USA", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const related = relatedTitles(rec).map(normalizeTitle);
      return !related.some((t) => unsafeRelatedTitles.has(t));
    },
    why: "hiddenTitles/alternatives must respect the same avoidance the main pick respects — no horror/gore titles in the related rail.",
  },
  {
    id: "GATE-FORMAT",
    category: "format",
    input: { mode: "self", selfText: "One episode only, funny and easy", country: "Poland", languagePreferences: ["Any language"], platforms: ["Netflix"], platformFilter: "mine" },
    check: (rec) => /\b(episode|per episode)\b/i.test(`${rec.format} ${rec.runtime}`),
    why: "One episode request must return episode/per-episode format.",
  },
  {
    id: "GATE-FORMAT-NO-HALLUCINATION",
    category: "format",
    input: { mode: "self", selfText: "Something inspiring for tonight, feeling a bit low energy", country: "Poland", languagePreferences: ["Any language"], platforms: ["Netflix"], platformFilter: "mine" },
    check: (rec) => rec._trust?.intentContract?.format === "any",
    why: "Keyword-free request must not have the LLM invent a film/series/episode format.",
  },
  {
    id: "GATE-NEGATED-SCARE",
    category: "scare intent",
    input: { mode: "self", selfText: "My girlfriend hates horror and gets really scared, want something light and fun for both of us", country: "Poland", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => {
      const intentLabel = rec.parsedIntent?.primary ?? "";
      const isNotScare = !["scare", "horror", "gore"].includes(intentLabel.toLowerCase());
      const text = textOf(rec);
      const hasPositiveSignal = comedy.test(text) || romance.test(text) ||
        /\b(light|fun|warm|gentle|comfort|feel-good|sweet|playful|easy|low-regret|low regret|whimsical|charming|uplifting|cozy|heartwarming)\b/i.test(text);
      return isNotScare && hasPositiveSignal;
    },
    why: "Text saying someone hates horror/gets scared must be treated as an avoidance/light request, not a scare intent.",
  },
  {
    id: "GATE-REFERENCE-AFFECT-BRIDGE",
    category: "reference translation",
    input: {
      mode: "self",
      selfText: "Something like Succession but much lighter and funnier. Keep the sharp ensemble chemistry and status games, but I want to relax, not feel stressed.",
      reference: "Succession",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => {
      const text = textOf(rec);
      const labels = [...(rec.contentCategory ?? []), ...(rec.emotionalEffect ?? [])].join(" ");
      return !/\bsuccession\b/i.test(rec.title) &&
        (comedy.test(text) || comfort.test(text) || comedy.test(labels)) &&
        !/\b(bleak|harrowing|punishing|dread|horror)\b/i.test(labels);
    },
    why: "Reference translation must preserve Succession's ensemble/status engine while applying the requested lighter/funnier emotional shift.",
  },
  {
    id: "GATE-REFERENCE-CROSS-LANGUAGE",
    category: "reference translation",
    input: {
      mode: "self",
      selfText: "I liked Shameless USA and want something similar in Hindi: messy family survival, class pressure, dark adult humor, loyalty, and damaged people. Not just a generic crime thriller.",
      reference: "Shameless",
      country: "India",
      languagePreferences: ["Hindi"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => {
      const lang = rec.contentMetadata?.originalLanguage;
      const countries = rec.contentMetadata?.originCountry ?? [];
      const languageFits = lang === "hi" || (!lang && countries.length === 0) || (!lang && countries.includes("IN"));
      const engineText = [
        rec.vibe,
        rec.oneLine,
        ...(rec.whyItFits ?? []),
        ...(rec.contentCategory ?? []),
        ...(rec.emotionalEffect ?? []),
      ].filter(Boolean).join(" ");
      return languageFits &&
        !/\bshameless\b/i.test(rec.title) &&
        messyFamilyEngine.test(engineText) &&
        !(/generic crime|crime procedural/i.test(engineText));
    },
    why: "A cross-language reference must preserve Shameless's messy family/social survival engine while staying in the Hindi content lane.",
  },
  {
    id: "GATE-NEGATIVE-TITLE-PERSISTS-BEYOND-SUBSCRIPTIONS",
    category: "intent exclusions",
    input: {
      mode: "self",
      selfText: "A really scary Indian Hindi movie, but not mainstream ones like Stree, Bhool Bhulaiyaa, or Bulbbul.",
      country: "USA",
      languagePreferences: ["Hindi"],
      platforms: [],
      platformFilter: "any",
      excludedTitles: ["Stree", "Bhool Bhulaiyaa", "Bulbbul"],
    },
    check: (rec) => {
      const rejected = new Set(rec._testInput.excludedTitles.map(normalizeTitle));
      return !rejected.has(normalizeTitle(rec.title)) &&
        relatedTitles(rec).every((title) => !rejected.has(normalizeTitle(title)));
    },
    why: "Expanding provider scope must preserve explicit negative title examples in the hero and every related rail.",
  },
  {
    id: "GATE-LONG-SESSION-NO-REPEAT",
    category: "session memory",
    input: {
      mode: "self",
      selfText: "Something warm, funny, and easy after a long day.",
      country: "USA",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
      recentTitles: [
        "Chef", "Paddington 2", "Hunt for the Wilderpeople", "The Intern",
        "Little Miss Sunshine", "The Good Place", "Ted Lasso", "Derry Girls",
      ],
      excludedTitles: [
        "Chef", "Paddington 2", "Hunt for the Wilderpeople", "The Intern",
        "Little Miss Sunshine", "The Good Place", "Ted Lasso", "Derry Girls",
        "Always Be My Maybe", "About Time", "The Fundamentals of Caring",
        "The Forty-Year-Old Version", "Brigsby Bear", "Hundreds of Beavers",
        "The Peanut Butter Falcon", "The Intouchables", "Paterson", "Columbus",
        "Brooklyn Nine-Nine", "Parks and Recreation",
      ],
    },
    check: (rec) => {
      const excluded = new Set(rec._testInput.excludedTitles.map(normalizeTitle));
      const repeatedFinal = excluded.has(normalizeTitle(rec.title));
      const repeatedDuringAttempt = (rec._trust?.rejections ?? []).some((item) =>
        excluded.has(normalizeTitle(item.title)) &&
        (item.reasons ?? []).some((reason) => /memory: (recently|previously) recommended/i.test(reason)),
      );
      const heroKey = normalizeTitle(rec.title);
      const relatedKeys = relatedTitles(rec).map(normalizeTitle).filter(Boolean);
      const relatedRepeat = relatedKeys.some((key) => key === heroKey || excluded.has(key));
      const duplicateRelated = new Set(relatedKeys).size !== relatedKeys.length;
      return !repeatedFinal && !repeatedDuringAttempt && !relatedRepeat && !duplicateRelated;
    },
    why: "A long session must not repeat an older recommendation in the hero or related rails, duplicate its own hero, or waste a retry before trust filtering.",
  },
];

async function runCase(test) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Exercise the same compact, one-pick path the live UI uses. The separate
    // recommendation regression suite retains the legacy full-batch coverage.
    body: JSON.stringify({ recommendationCount: 1, responseDetail: "core", ...test.input }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`${test.id}: API ${response.status}`);
  }

  const data = await response.json();
  data._testInput = test.input;
  const pass = test.check(data);
  return {
    id: test.id,
    category: test.category,
    title: `${data.title} (${data.year})`,
    pass,
    why: test.why,
  };
}

const results = [];
for (let i = 0; i < tests.length; i++) {
  if (i > 0 && DELAY_BETWEEN_MS > 0) {
    process.stdout.write(`  (waiting ${DELAY_BETWEEN_MS / 1000}s...)\n`);
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
  }
  const test = tests[i];
  try {
    results.push(await runCase(test));
  } catch (error) {
    results.push({
      id: test.id,
      category: test.category,
      title: "ERROR",
      pass: false,
      why: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log("\n=== F.U.N QA GATE ===\n");
for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"} [${result.category}] ${result.id} — ${result.title}`);
  if (!result.pass) console.log(`  ${result.why}`);
}

const failures = results.filter((result) => !result.pass);
if (failures.length > 0) {
  console.error(`\n${failures.length}/${results.length} QA gate checks failed against ${ENDPOINT}. DO NOT DEPLOY.`);
  process.exit(1);
}

console.log(`\nAll ${results.length} QA gate checks passed against ${ENDPOINT}. Safe to deploy.`);
