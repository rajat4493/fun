#!/usr/bin/env node
// Unified pre-deploy QA gate. One test case per risk category so fixing one area
// cannot silently break another. Run before every deploy: npm run test:gate
//
// Categories: scare intent, cry intent, comfort, panic safety, grief safety,
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
const comfort = /\b(comfort|warm|cozy|feel.good|uplifting|sweet|gentle|heartwarming|charming|delightful|hopeful|funny|light|kind|soothing|humane|tender)\b/i;
const emotionalAmplification = /\b(grief|grieving|bereavement|mourning|heartbreak|heartbreaking|breakup|romantic longing|devastating|bleak|harrowing|melancholy|tragic loss)\b/i;

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
    id: "GATE-CRY",
    category: "cry intent",
    input: { mode: "self", selfText: "Watching with friends and want something that will make us cry", country: "Poland", languagePreferences: ["Any language"], platforms: [], platformFilter: "any" },
    check: (rec) => cry.test(textOf(rec)),
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
      return comfort.test(text) && !romance.test(labels) && !emotionallyAmplifying(rec);
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
];

async function runCase(test) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(test.input),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`${test.id}: API ${response.status}`);
  }

  const data = await response.json();
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
