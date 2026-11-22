// Model bake-off: runs the real /api/recommend route (local source, live providers) against one
// OpenAI model and reports latency, no-match rate, explicit-constraint violations, retries and token
// cost. Uses paid APIs; never writes shared storage (no Redis credentials, in-memory learning sink).
//
//   node --env-file=.env.local scripts/model-bakeoff.mjs --live --model gpt-6-luna [--rounds 2]
//   node --env-file=.env.local scripts/model-bakeoff.mjs --live --model claude-haiku-5-5   (Claude only;
//     OpenAI is withheld so every call goes through the Anthropic path)
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const argv = process.argv;
if (!argv.includes("--live")) throw new Error("Explicit --live required: uses paid model and metadata APIs.");
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const model = arg("--model", process.env.OPENAI_MODEL);
const rounds = Number(arg("--rounds", "1"));
const outFile = arg("--out", null);
const only = arg("--only", null)?.split(",");

// USD per 1M tokens: [input, cached input, output] from developers.openai.com/api/docs/pricing (2026-11-22).
const PRICES = {
  "gpt-4o-mini": [0.15, 0.075, 0.6],
  "gpt-6-luna": [0.1, 0.01, 0.5],
  "gpt-5.4-nano": [0.2, 0.02, 1.25],
  "gpt-5.4-mini": [0.75, 0.075, 4.5],
  // platform.claude.com/docs/en/about-claude/pricing (2026-11-22), prompts under 100K tokens.
  "claude-haiku-5-5": [0.1, 0.01, 0.5],
  "claude-sonnet-5-5": [2, 0.1, 10],
};

const root = process.cwd();
const isClaude = model.startsWith("claude-");
const env = isClaude
  ? { NODE_ENV: "production", FUN_ENABLE_ANTHROPIC: "1", ANTHROPIC_MODEL: model }
  : { NODE_ENV: "production", OPENAI_MODEL: model, OPENAI_FALLBACK_MODEL: model };
for (const key of [isClaude ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY", "TMDB_API_KEY", "TMDB_READ_ACCESS_TOKEN", "OMDB_API_KEY", "OPENAI_REASONING_EFFORT"]) {
  if (process.env[key]) env[key] = process.env[key];
}
if (isClaude && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env.local");

const sources = new Map();
function harness(network) {
  const after = [];
  const context = vm.createContext({
    process: { env }, console: argv.includes("--debug") ? console : { log() {}, warn() {}, error() {}, info() {} },
    Response, Request, URL, AbortSignal, AbortController, TextEncoder, TextDecoder, ReadableStream,
    setTimeout, clearTimeout, fetch: network,
  });
  const modules = new Map();
  function load(path) {
    const full = resolve(root, path);
    if (modules.has(full)) return modules.get(full).exports;
    if (!sources.has(full)) sources.set(full, fs.readFileSync(full, "utf8"));
    const source = sources.get(full);
    if (full.endsWith(".json")) return JSON.parse(source);
    const module = { exports: {} };
    modules.set(full, module);
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const req = (name) => {
      if (name === "next/server") return { NextResponse: Response, after: (fn) => after.push(fn) };
      if (name === "@/lib/learning-storage") return { writeLearningRecord: async () => {} };
      const target = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(full), name);
      return load(/\.(json|ts)$/.test(target) ? target : target + ".ts");
    };
    vm.runInContext("(function(require,module,exports){" + code + "\n})", context, { filename: full })(req, module, module.exports);
    return module.exports;
  }
  return { load, after };
}

const UK = { country: "United Kingdom" };
const IN = { country: "India" };
const ukSubs = { ...UK, platformFilter: "mine", platforms: ["Netflix", "Prime Video"] };
const inSubs = { ...IN, platformFilter: "mine", platforms: ["Netflix", "Prime Video", "JioHotstar"] };
const cases = [
  // Constraint cases from scripts/quality-live-local.mjs
  ["no-fear", { mode: "self", selfText: "A warm uplifting comedy, nothing frightening", ...UK }],
  ["pills-no-horror", { mode: "choose", mood: ["tired"], wants: ["comedy"], avoids: ["horror"], ...UK }],
  ["not-hindi", { mode: "self", selfText: "A funny movie, but not in Hindi", ...IN }],
  ["pills-not-hindi", { mode: "choose", wants: ["comedy"], avoids: ["Hindi"], ...IN }],
  ["family-animation", { mode: "self", selfText: "An animated family-friendly movie for children. Nothing scary.", country: "Ireland" }],
  ["pills-family", { mode: "choose", wants: ["animated movie", "family-friendly"], avoids: ["horror"], country: "Ireland" }],
  ["positive-horror", { mode: "self", selfText: "Scare me with a genuinely terrifying horror movie", ...UK }],
  ["positive-hindi", { mode: "choose", wants: ["comedy"], languagePreferences: ["Hindi"], ...IN }],
  ["seen-exclusion", { mode: "self", selfText: "A warm comedy movie, nothing frightening", seenTitles: ["The Intouchables", "The Grand Budapest Hotel"], country: "Ireland" }],
  // Real request shapes from the August diagnostics, mapped to launch countries
  ["real-warm-week", { mode: "self", selfText: "I want something warm, easy, and a little funny after a long week. Nothing heavy.", ...ukSubs }],
  ["real-inspiring", { mode: "self", selfText: "I want something inspiring on Netflix tonight.", ...UK, platformFilter: "mine", platforms: ["Netflix"] }],
  ["real-shameless-hindi", { mode: "self", selfText: "I liked Shameless USA and want something similar in Hindi: messy family survival, class pressure, dark adult humor, loyalty, and damaged people. Not just a generic crime thriller.", ...IN }],
  ["real-scary-no-gore", { mode: "self", selfText: "I want something genuinely scary tonight, but no gore and no body horror.", ...ukSubs }],
  ["real-one-episode", { mode: "self", selfText: "One episode only. Funny, weird, easy to watch.", ...UK }],
  ["real-korean-thriller", { mode: "self", selfText: "A tense Korean crime thriller that moves quickly and stays grounded. No supernatural horror.", ...UK }],
  ["real-hidden-hindi", { mode: "self", selfText: "A hidden Hindi thriller with strong momentum. Don't recommend Kahaani, Tumbbad, Stree, or Drishyam.", ...inSubs, languagePreferences: ["Hindi"] }],
  ["real-dumped", { mode: "self", selfText: "I just got dumped. Make me laugh and feel better. No romance and nothing about heartbreak.", ...UK }],
  ["real-gripping", { mode: "self", selfText: "I want a genuinely gripping thriller tonight, but nothing slow or emotionally exhausting.", ...inSubs }],
  ["real-french", { mode: "self", selfText: "A thoughtful French film under two hours, emotionally rich but not devastating.", ...ukSubs }],
  ["real-exhausted", { mode: "self", selfText: "I'm exhausted after a long week. Give me something warm, witty, and easy, but not childish.", ...UK }],
  ["real-pills-romantic", { mode: "choose", mood: ["tired"], wants: ["romantic", "comforting"], avoids: ["gore"], ...inSubs }],
];

function cost(usage) {
  const price = PRICES[model];
  if (!price) return null;
  const cached = usage.cached;
  return ((usage.input - cached) * price[0] + cached * price[1] + usage.output * price[2]) / 1e6;
}

const results = [];
for (let round = 1; round <= rounds; round += 1) {
  for (const [id, fields] of cases) {
    if (only && !only.includes(id)) continue;
    const usage = { calls: 0, failedCalls: 0, input: 0, cached: 0, output: 0, reasoning: 0, models: new Set() };
    const network = async (url, options = {}) => {
      const host = new URL(url).hostname;
      const llmHost = host === "api.openai.com" || host === "api.anthropic.com";
      if (!["api.openai.com", "api.anthropic.com", "api.themoviedb.org", "www.omdbapi.com"].includes(host)) throw new Error("External host not allowed");
      if (llmHost && ++usage.calls > 8) throw new Error("Provider budget exceeded");
      const response = await fetch(url, options);
      if (llmHost) {
        try {
          const body = await response.clone().json();
          if (!response.ok) usage.failedCalls += 1;
          if (body.model) usage.models.add(body.model);
          // Anthropic reports cache reads separately from input_tokens; OpenAI counts them inside it.
          const cacheRead = body.usage?.cache_read_input_tokens ?? 0;
          usage.input += (body.usage?.input_tokens ?? 0) + cacheRead;
          usage.cached += body.usage?.input_tokens_details?.cached_tokens ?? cacheRead;
          usage.output += body.usage?.output_tokens ?? 0;
          usage.reasoning += body.usage?.output_tokens_details?.reasoning_tokens ?? 0;
        } catch { usage.failedCalls += 1; }
      }
      return response;
    };
    const h = harness(network);
    const input = { platforms: [], platformFilter: "any", recommendationCount: 1, responseDetail: "core", runId: `bakeoff-${model}-${id}-${round}`, ...fields };
    const started = Date.now();
    let status = 0, rec = {}, violations = [], crash;
    try {
      const response = await h.load("src/app/api/recommend/route.ts").POST(new Request("http://bakeoff.invalid", { method: "POST", body: JSON.stringify(input) }));
      status = response.status;
      rec = await response.json();
      for (const callback of h.after) await callback();
      if (status === 200) violations = Array.from(h.load("src/lib/explicit-constraints.ts").explicitConstraintRejections(input, rec));
    } catch (error) { crash = String(error).slice(0, 200); }
    const diag = rec._trust?.diagnostics ?? {};
    const row = {
      id, round, status, elapsedMs: Date.now() - started, title: rec.title, error: rec.error ?? crash,
      violations: violations.length, displayState: rec._trust?.displayState, source: diag.source, degraded: diag.degraded,
      degradeReason: diag.degradeReason, retryCount: diag.retryCount, timings: diag.timings,
      openaiCalls: usage.calls, failedCalls: usage.failedCalls, inputTokens: usage.input, cachedTokens: usage.cached,
      outputTokens: usage.output, reasoningTokens: usage.reasoning, modelsSeen: [...usage.models], costUsd: cost(usage),
    };
    results.push(row);
    console.error(`[${model}] r${round} ${id}: ${status} ${row.elapsedMs}ms ${row.title ?? row.error ?? ""} ${row.violations ? "VIOLATION" : ""}`);
  }
}

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
};
const ok = results.filter((r) => r.status === 200);
const summary = {
  model, reasoningEffort: isClaude ? "n/a (Claude, temperature)" : env.OPENAI_REASONING_EFFORT ?? (/^(gpt-6|o\d)/.test(model) ? "none" : "n/a (temperature)"),
  runs: results.length,
  matches: ok.length,
  noMatch: results.filter((r) => r.status === 422).length,
  errors: results.filter((r) => r.status !== 200 && r.status !== 422).length,
  constraintViolations: results.reduce((n, r) => n + r.violations, 0),
  degraded: results.filter((r) => r.degraded).length,
  retried: results.filter((r) => (r.retryCount ?? 0) > 0).length,
  failedOpenAICalls: results.reduce((n, r) => n + r.failedCalls, 0),
  p50Ms: pct(results.map((r) => r.elapsedMs), 0.5),
  p90Ms: pct(results.map((r) => r.elapsedMs), 0.9),
  maxMs: Math.max(...results.map((r) => r.elapsedMs)),
  avgOpenAICalls: +(results.reduce((n, r) => n + r.openaiCalls, 0) / results.length).toFixed(2),
  avgOutputTokens: Math.round(results.reduce((n, r) => n + r.outputTokens, 0) / results.length),
  avgCostPer1000AsksUsd: PRICES[model] ? +((results.reduce((n, r) => n + (r.costUsd ?? 0), 0) / results.length) * 1000).toFixed(3) : null,
};
console.log(JSON.stringify(summary));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 1));
