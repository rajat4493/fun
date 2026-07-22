#!/usr/bin/env node

const API_BASE = process.env.FUN_QA_BASE_URL || "http://127.0.0.1:3000";
const ENDPOINT = `${API_BASE.replace(/\/$/, "")}/api/recommend`;
const CASE_TIMEOUT_MS = Number(process.env.FUN_QA_CASE_TIMEOUT_MS || 45000);

const scary = /\b(scary|scare|terrify|terrified|terrifying|horror|dread|nightmare|haunted|ghost|possession|demonic|slasher|jumpscare|jump scare|creepy|fear)\b/i;
const comedy = /\b(comedy|funny|hilarious|witty|humor|humour|laugh|comic)\b/i;
const thriller = /\b(thriller|suspense|mystery|crime|tense|paranoid|investigation|whodunit|noir)\b/i;
const romance = /\b(romance|romantic|love story|chemistry|relationship|date)\b/i;
const cry = /\b(cry|tearjerker|tear jerker|sob|weep|devastating|heartbreaking|cathartic|moving|grief|loss|poignant)\b/i;
const horror = /\b(horror|gore|gory|bloody|slasher|demonic|haunted|ghost|nightmare|torture|visceral)\b/i;

function textOf(rec) {
  return [
    rec.title,
    rec.format,
    rec.runtime,
    rec.vibe,
    rec.oneLine,
    ...(rec.whyItFits ?? []),
    rec.hiddenLayer?.headline,
    rec.hiddenLayer?.insight,
  ].filter(Boolean).join(" ");
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
    id: "INT-SCARE-PARTNER",
    input: {
      mode: "self",
      selfText: "Suggest me a movie which can make my partner shit scared",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: ["Netflix"],
      platformFilter: "mine",
    },
    check: (rec) => scary.test(textOf(rec)) && !romance.test(textOf(rec)),
    why: "Scare request must return a genuinely scary/fear-inducing pick, not romance/surreal comfort.",
  },
  {
    id: "INT-CRY-FRIENDS",
    input: {
      mode: "self",
      selfText: "Watching with friends and want something that will make us cry",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => cry.test(textOf(rec)),
    why: "Cry request must return catharsis/tearjerker emotional material.",
  },
  {
    id: "LANG-HINDI-COMEDY",
    input: {
      mode: "self",
      selfText: "I want a Hindi comedy",
      country: "India",
      languagePreferences: ["Hindi"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => comedy.test(textOf(rec)) && !/the lunchbox/i.test(rec.title),
    why: "Hindi comedy must not become Indian romantic drama/prestige fallback.",
  },
  {
    id: "LANG-KOREAN-THRILLER",
    input: {
      mode: "self",
      selfText: "Give me a Korean thriller",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => thriller.test(textOf(rec)) && !/double life of veronique/i.test(rec.title),
    why: "Korean thriller must stay thriller; wrong-language arthouse is a failure.",
  },
  {
    id: "FORMAT-ONE-EPISODE",
    input: {
      mode: "self",
      selfText: "One episode only, funny and easy",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: ["Netflix"],
      platformFilter: "mine",
    },
    check: (rec) => /\b(episode|per episode)\b/i.test(`${rec.format} ${rec.runtime}`),
    why: "One episode request must return episode/per-episode format.",
  },
  {
    id: "TIME-DRAMA-UNDER-90",
    input: {
      mode: "self",
      selfText: "Drama under 90 minutes",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => (runtimeMinutes(rec) ?? 999) <= 90 && /\bfilm\b/i.test(rec.format) && !/\bcomedy\b/i.test(textOf(rec)),
    why: "Under-90 drama must stay inside runtime and not become TV comedy.",
  },
  {
    id: "AVOID-WEIRD-NO-HORROR",
    input: {
      mode: "self",
      selfText: "I want something weird but no horror or gore",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => !horror.test(textOf(rec)),
    why: "No-horror/no-gore weird request must remain strange without darkness boundary violations.",
  },
  {
    id: "NEGATED-SCARE-LIGHT",
    input: {
      mode: "self",
      selfText: "My girlfriend hates horror and gets really scared, want something light and fun for both of us",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => !scary.test(textOf(rec)) && !horror.test(textOf(rec)) && (comedy.test(textOf(rec)) || romance.test(textOf(rec)) || /\b(light|fun|warm|gentle|comfort|feel-good|sweet|playful|easy|low-regret|low regret)\b/i.test(textOf(rec))),
    why: "Text saying someone hates horror/gets scared must be treated as an avoidance/light request, not a scare request.",
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
  const rec = data;
  const pass = test.check(rec);
  return {
    id: test.id,
    title: `${rec.title} (${rec.year})`,
    pass,
    why: test.why,
  };
}

const results = [];
for (const test of tests) {
  try {
    results.push(await runCase(test));
  } catch (error) {
    results.push({
      id: test.id,
      title: "ERROR",
      pass: false,
      why: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.id} — ${result.title}`);
  if (!result.pass) console.log(`  ${result.why}`);
}

const failures = results.filter((result) => !result.pass);
if (failures.length > 0) {
  console.error(`\n${failures.length}/${results.length} recommendation regression checks failed against ${ENDPOINT}`);
  process.exit(1);
}

console.log(`\nAll ${results.length} recommendation regression checks passed against ${ENDPOINT}`);
