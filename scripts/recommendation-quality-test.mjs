#!/usr/bin/env node
// One-shot quality test suite — 10 cases that stress recommendation accuracy and experience.
// Records actual response time per case.

const API_BASE = process.env.FUN_QA_BASE_URL || "http://127.0.0.1:3000";
const ENDPOINT = `${API_BASE.replace(/\/$/, "")}/api/recommend`;
const CASE_TIMEOUT_MS = Number(process.env.FUN_QA_CASE_TIMEOUT_MS || 60000);

const scary   = /\b(scary|scare|terrify|terrified|terrifying|horror|dread|nightmare|haunted|ghost|demonic|slasher|creepy|fear|frightening)\b/i;
const comedy  = /\b(comedy|funny|hilarious|humor|humour|laugh|comic|witty)\b/i;
const warm    = /\b(warm|cozy|cosy|comfort|gentle|sweet|light|feel-good|wholesome|charming|tender|uplifting|heartwarming|low-regret)\b/i;
const cry     = /\b(cry|tearjerker|sob|weep|devastating|heartbreaking|cathartic|moving|grief|poignant|emotional)\b/i;
const thriller= /\b(thriller|suspense|mystery|crime|tense|paranoid|investigation|whodunit|noir|detective|killer|murder|conspiracy)\b/i;
const weird   = /\b(weird|strange|unusual|offbeat|quirky|absurd|surreal|experimental|bizarre|unconventional|cult|formally)\b/i;
const horror  = /\b(horror|gore|gory|bloody|slasher|demonic|haunted|ghost|nightmare|torture|visceral|explicit violence)\b/i;
const drama   = /\b(drama|dramatic|character study|serious|emotional|prestige|social|intimate)\b/i;
const episode = /\b(episode|per episode)\b/i;

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
  const hm = text.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const m = text.match(/(\d+)\s*(?:min|mins|minutes|m)\b/);
  return m ? Number(m[1]) : null;
}

const tests = [
  // ─── 1. Craziness 2 + scare partner ─────────────────────────────────────────
  {
    id: "BOLD-SCARE-PARTNER",
    label: "Bold craziness + make partner scared",
    input: {
      mode: "self",
      selfText: "Make my girlfriend properly shit scared tonight, she has never seen real horror",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: ["Netflix"],
      platformFilter: "mine",
      craziness: 2,
    },
    check: (rec) => scary.test(textOf(rec)) && !warm.test(textOf(rec)) && !comedy.test(textOf(rec)),
    why: "Bold + explicit scare intent must return genuinely scary horror, not warm or funny content.",
  },

  // ─── 2. Stacked hard avoids + weird intent ───────────────────────────────────
  {
    id: "STACKED-AVOIDS-WEIRD",
    label: "Horror + gore + violence avoided, wants weird",
    input: {
      mode: "self",
      selfText: "I want something genuinely bizarre and unusual, no darkness, no violence, no disturbing content at all",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
      craziness: 2,
    },
    check: (rec) => weird.test(textOf(rec)) && !horror.test(textOf(rec)),
    why: "Weird intent with darkness avoidance must return absurdist/surreal without horror/gore/violence.",
  },

  // ─── 3. Reference + tone shift (lighter) ────────────────────────────────────
  {
    id: "REFERENCE-SUCCESSION-LIGHTER",
    label: "Like Succession but lighter and funnier",
    input: {
      mode: "self",
      selfText: "Something like Succession but much lighter and funnier, I want to enjoy it not be stressed",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => comedy.test(textOf(rec)) || warm.test(textOf(rec)),
    why: "Succession + lighter/funnier must shift tone toward comedy or warmth, not return dark power drama.",
  },

  // ─── 4. Strict runtime + thriller ────────────────────────────────────────────
  {
    id: "RUNTIME-80MIN-THRILLER",
    label: "Thriller under 80 minutes",
    input: {
      mode: "self",
      selfText: "Give me a sharp thriller, I only have 80 minutes before I need to sleep",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => {
      const mins = runtimeMinutes(rec);
      const withinRuntime = mins === null || mins <= 85; // 5 min buffer for edge rounding
      return withinRuntime && (thriller.test(textOf(rec)) || /\bfilm\b/i.test(rec.format));
    },
    why: "Thriller under 80 min must respect runtime constraint and deliver thriller content.",
  },

  // ─── 5. Elderly parents — family safe + good storytelling ────────────────────
  {
    id: "FAMILY-ELDERLY-PARENTS",
    label: "Good storytelling, elderly parents, nothing crude",
    input: {
      mode: "self",
      selfText: "Watching with my 70-year-old parents who love good storytelling but absolutely cannot handle violence, crude humor, or sexual content",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => !horror.test(textOf(rec)) && (drama.test(textOf(rec)) || warm.test(textOf(rec)) || comedy.test(textOf(rec))),
    why: "Elderly parents context must block horror/gore/violence and return drama, warmth, or gentle comedy.",
  },

  // ─── 6. Friends group + hard laughs ──────────────────────────────────────────
  {
    id: "FRIENDS-GROUP-LAUGH",
    label: "Friends coming over, want to laugh hard",
    input: {
      mode: "self",
      selfText: "Friends are coming over tonight and we all want to laugh really hard, nothing too heavy or serious",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: ["Netflix", "Prime Video"],
      platformFilter: "any",
      craziness: 1,
    },
    check: (rec) => comedy.test(textOf(rec)) && !horror.test(textOf(rec)),
    why: "Group comedy night must deliver clearly funny/comedy content without horror or heavy darkness.",
  },

  // ─── 7. Hidden gem drama ──────────────────────────────────────────────────────
  {
    id: "HIDDEN-GEM-DRAMA",
    label: "Underrated drama most people haven't seen",
    input: {
      mode: "self",
      selfText: "I want an underrated, overlooked drama that most people have never heard of — something I would feel proud discovering",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
      discoveryMode: "indie",
    },
    check: (rec) => drama.test(textOf(rec)) || rec.confidence <= 85,
    why: "Hidden gem drama must return a drama-leaning pick — not a mainstream blockbuster.",
  },

  // ─── 8. Feedback repair: wrong-vibe was comedy, now wants to cry ──────────────
  {
    id: "FEEDBACK-REPAIR-CRY",
    label: "After wrong-vibe comedy, now wants tearjerker",
    input: {
      mode: "self",
      selfText: "I want something that will genuinely make me cry",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
      feedbackContext: {
        lastReason: "wrong-vibe",
        wrongVibeTitles: ["Superbad"],
      },
    },
    check: (rec) => cry.test(textOf(rec)),
    why: "After wrong-vibe comedy, tearjerker request must return cathartic/emotional content.",
  },

  // ─── 9. One scary episode ────────────────────────────────────────────────────
  {
    id: "EPISODE-SCARY",
    label: "One episode that creeps me out",
    input: {
      mode: "self",
      selfText: "I want just one episode of something that will genuinely creep me out or scare me",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
    },
    check: (rec) => {
      const text = textOf(rec);
      const isEpisode = episode.test(text);
      const isScary = scary.test(text) || horror.test(text);
      return isEpisode && isScary;
    },
    why: "One scary episode must return episode format AND scary/creepy content — not a whole series.",
  },

  // ─── 10. Unhinged craziness + comfort (no intensity signal) ──────────────────
  {
    id: "UNHINGED-COMFORT",
    label: "Unhinged craziness level but wants something warm and comforting",
    input: {
      mode: "self",
      selfText: "I want something warm, cozy, and comforting tonight",
      country: "Poland",
      languagePreferences: ["Any language"],
      platforms: [],
      platformFilter: "any",
      craziness: 3,
    },
    check: (rec) => (warm.test(textOf(rec)) || comedy.test(textOf(rec))) && !horror.test(textOf(rec)),
    why: "Unhinged without intensity signal must go formally strange/unexpected — NOT gore. Warm request stays warm.",
  },
];

async function runCase(test) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(test.input),
      signal: controller.signal,
    });
    const responseMs = Date.now() - startMs;
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`API ${response.status}`);

    const rec = await response.json();
    const pass = test.check(rec);

    return {
      id: test.id,
      label: test.label,
      title: `${rec.title} (${rec.year})`,
      format: rec.format,
      runtime: rec.runtime,
      vibe: rec.vibe,
      parsedPrimary: rec.parsedIntent?.primary ?? "—",
      fallbackUsed: rec._trust?.fallbackUsed ?? false,
      responseMs,
      pass,
      why: test.why,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      id: test.id,
      label: test.label,
      title: "ERROR",
      responseMs: Date.now() - startMs,
      pass: false,
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

console.log(`\nF.U.N Recommendation Quality Test — ${tests.length} cases`);
console.log(`Endpoint: ${ENDPOINT}\n`);
console.log("─".repeat(80));

const results = [];
for (const test of tests) {
  process.stdout.write(`Running ${test.id}... `);
  const result = await runCase(test);
  results.push(result);

  const status = result.pass ? "✓ PASS" : "✗ FAIL";
  const timing = `${(result.responseMs / 1000).toFixed(1)}s`;
  console.log(`${status}  ${timing}  ${result.title}`);
  if (!result.pass) {
    console.log(`       ↳ ${result.why}`);
    console.log(`       ↳ vibe: ${result.vibe ?? "n/a"}  |  parsedIntent.primary: ${result.parsedPrimary ?? "n/a"}  |  fallback: ${result.fallbackUsed}`);
  } else {
    console.log(`       format: ${result.format ?? "—"}  |  runtime: ${result.runtime ?? "—"}  |  intent: ${result.parsedPrimary}`);
  }
}

console.log("\n" + "─".repeat(80));
const passed = results.filter((r) => r.pass).length;
const avgMs = Math.round(results.reduce((sum, r) => sum + r.responseMs, 0) / results.length);
const slowest = results.reduce((s, r) => r.responseMs > s.responseMs ? r : s);
const fastest = results.reduce((s, r) => r.responseMs < s.responseMs ? r : s);

console.log(`\nResult: ${passed}/${tests.length} passed`);
console.log(`Timing: avg ${(avgMs/1000).toFixed(1)}s  |  fastest ${(fastest.responseMs/1000).toFixed(1)}s (${fastest.id})  |  slowest ${(slowest.responseMs/1000).toFixed(1)}s (${slowest.id})`);

if (passed < tests.length) {
  console.log("\nFailed cases:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.id}: ${r.title}`));
  process.exit(1);
} else {
  console.log("\nAll quality checks passed.");
}
