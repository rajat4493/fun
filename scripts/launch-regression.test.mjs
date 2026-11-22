import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { summarizeLatency } from "./latency-report.mjs";

const root = resolve(import.meta.dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (value, status = 200) => Response.json(value, { status });

// Execute the actual TypeScript modules with isolated environment, storage and network mocks.
// Any unexpected fetch fails the test. No API keys, .env files or production services are used.
function harness({ env = {}, fetch, storage, local, warnings = [], mocks = {} } = {}) {
  const after = [];
  const context = vm.createContext({
    process: { env }, console: { log() {}, warn(...args) { warnings.push(args); }, error() {} },
    Response, Request, URL, AbortSignal, AbortController, TextEncoder, TextDecoder, ReadableStream,
    setTimeout, clearTimeout, sessionStorage: storage, localStorage: local, window: local ? {} : undefined,
    fetch: fetch ?? (() => { throw new Error("Unexpected network call in offline test"); }),
  });
  const cache = new Map();
  function load(filename) {
    const full = resolve(root, filename);
    if (cache.has(full)) return cache.get(full).exports;
    if (full.endsWith(".json")) return JSON.parse(readFileSync(full, "utf8"));
    const module = { exports: {} };
    cache.set(full, module);
    const code = ts.transpileModule(readFileSync(full, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const require = (name) => {
      if (name in mocks) return mocks[name];
      if (name === "next/server") return { NextResponse: Response, after: (fn) => after.push(fn) };
      const target = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(full), name);
      return load(/\.(json|ts)$/.test(target) ? target : `${target}.ts`);
    };
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context, { filename: full })(require, module, module.exports);
    return module.exports;
  }
  return { load, after, env };
}

const raw = {
  title: "Example Movie", year: "2020", format: "Film", runtime: "90 min", confidence: 80,
  vibe: "warm", oneLine: "An example.", whyItFits: ["Warm comedy"], alternatives: [],
  hiddenLayer: { headline: "", insight: "", classyJab: "" },
  whereToWatch: { status: "unverified", primary: "", note: "" },
};
const redisEnv = { KV_REST_API_URL: "https://redis.invalid", KV_REST_API_TOKEN: "fixture" };

test("subscription selection skips an unverified animation before slicing, without regenerating or rechecking ratings", async () => {
  for (const mode of ["self", "choose"]) for (const firstValid of [false, true]) for (const returning of [false, true]) {
    let modelCalls = 0;
    let intentCalls = 0;
    const contract = { primary: "comfort", format: "film", hardAvoids: ["horror"], source: "llm" };
    const ratingTitles = [];
    const titles = ["First Family Pick", "Second Family Pick", "Third Family Pick"];
    const h = harness({ env: { OPENAI_API_KEY: "fixture", TMDB_API_KEY: "fixture", OMDB_API_KEY: "fixture" },
      mocks: { "@/lib/llm": {
        interpretIntentWithOpenAI: async () => { intentCalls++; return contract; },
        recommendWithOpenAI: async () => { modelCalls++; return titles.map(title => ({ ...raw, title, contentCategory: ["family", "animation", "comedy"], emotionalEffect: ["comfort", "warm"] })); },
      } },
      fetch: async url => {
        const u = new URL(url);
        if (u.hostname === "www.omdbapi.com") {
          const title = u.searchParams.get("t"); ratingTitles.push(title);
          return json({ Response: "True", Title: title, Year: "2020", Rated: "PG" });
        }
        if (u.pathname.includes("/search/")) {
          const title = u.searchParams.get("query");
          return json({ results: [{ id: titles.indexOf(title) + 1, title, release_date: "2020-01-01", poster_path: "/fixture.jpg", original_language: "en", genre_ids: !firstValid && title === titles[0] ? [35,10751] : [16,35,10751] }] });
        }
        if (u.pathname.endsWith("/watch/providers")) return json({ results: { IN: { flatrate: [{ provider_id: 8, provider_name: "Netflix" }] } } });
        throw new Error("Unexpected network call");
      },
    });
    const fields = mode === "self" ? { selfText: "An animated family-friendly movie for children. Nothing scary." } : { wants: ["animated movie", "family-friendly"], avoids: ["horror"] };
    const response = await h.load("src/app/api/recommend/route.ts").POST(new Request("http://test.invalid", { method: "POST", body: JSON.stringify({ ...fields, mode, country: "India", platforms: ["Netflix"], platformFilter: "mine", recommendationCount: 1, responseDetail: "core", ...(returning ? { precomputedIntentContract: contract, seenTitles: ["Previously Seen Family Movie"] } : {}) }) }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.title, titles[firstValid ? 0 : 1]);
    assert.equal(result.contentMetadata.familyRatingVerified, true);
    assert.equal(modelCalls, 1, "reuse the existing candidate pool before a new model call");
    assert.equal(intentCalls, returning ? 0 : 1, "same-request reroll reuses resolved intent; new ask still classifies");
    assert.deepEqual(ratingTitles, [result.title], "skip ratings on non-animation and reuse accepted rating at final gate");
    if (!firstValid) assert.ok(result._trust.rejections.some(x => x.title === titles[0] && x.reasons.includes("animation not verified")));
  }
});

test("all-cinema family requests verify backup candidates before slicing in pills and describe modes", async () => {
  for (const mode of ["self", "choose"]) {
    let modelCalls = 0;
    const contract = { primary: "comfort", secondary: ["family", "animated"], hardAvoids: ["horror"], format: "film", language: "any", situation: ["family"], intensity: "gentle", emotionalGoal: "Family fun", confidence: .9, ambiguity: "", negativeReferences: [], discoveryPreference: "standard", source: "llm" };
    const titles = ["Unrated Animation", "Verified Animation", "Another Animation"];
    const h = harness({ env: { OPENAI_API_KEY: "fixture", TMDB_API_KEY: "fixture", OMDB_API_KEY: "fixture" },
      mocks: { "@/lib/llm": {
        interpretIntentWithOpenAI: async () => contract,
        recommendWithOpenAI: async () => { modelCalls++; return titles.map(title => ({ ...raw, title, contentCategory: ["family", "animation", "comedy"], emotionalEffect: ["comfort", "warm"] })); },
      } },
      fetch: async url => {
        const u = new URL(url);
        if (u.hostname === "www.omdbapi.com") {
          const title = u.searchParams.get("t");
          return json({ Response: "True", Title: title, Year: "2020", Rated: title === titles[0] ? "R" : "PG" });
        }
        if (u.pathname.includes("/search/")) {
          const title = u.searchParams.get("query");
          return json({ results: [{ id: titles.indexOf(title) + 1, title, release_date: "2020-01-01", poster_path: "/fixture.jpg", original_language: "en", genre_ids: [16,35,10751] }] });
        }
        if (u.pathname.endsWith("/watch/providers")) return json({ results: { IN: { flatrate: [{ provider_id: 8, provider_name: "Netflix" }] } } });
        throw new Error("Unexpected network call");
      },
    });
    const fields = mode === "self" ? { selfText: "A warm animated family movie for children." } : { wants: ["animated movie", "family-friendly"], avoids: ["horror"] };
    const response = await h.load("src/app/api/recommend/route.ts").POST(new Request("http://test.invalid", { method: "POST", body: JSON.stringify({ ...fields, mode, country: "India", platformFilter: "any", recommendationCount: 1, responseDetail: "core" }) }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.title, titles[1]);
    assert.equal(result.contentMetadata.familyRatingVerified, true);
    assert.equal(result._batch.length, 1, "foreground response remains one visible pick");
    assert.ok(modelCalls >= 1 && modelCalls <= 2, "backup qualification adds no third model call; the existing intent/trust retry remains bounded");
  }
});

test("candidate selection preserves ranked order and fills only rejected slots for background batches", async () => {
  const select = harness().load("src/lib/qualified-candidates.ts").selectQualifiedCandidates;
  const checked = [];
  const result = await select([1,2,3,4,5], 2, async value => { checked.push(value); return value === 1 ? null : value; });
  assert.deepEqual(clone(result), [2,3]);
  assert.deepEqual(checked, [1,2,3]);
});

// Executes the actual page effect with mocked React setters and browser events. This
// covers wiring/state transitions, but does not claim Safari rendering validation.
function mountRecommendationEffect(lifecycle) {
  const source = readFileSync(resolve(root, "src/app/recommendation/page.tsx"), "utf8");
  const marker = "  useEffect(() => {";
  const start = source.indexOf(marker);
  const end = source.indexOf("  }, []);", start);
  assert.ok(start >= 0 && end > start);
  const state = {};
  const listeners = new Map();
  let tick;
  const context = { ...lifecycle, Date,
    LOADING_KEY: "fun:loading", LOADING_STARTED_KEY: "fun:loading-started-at",
    LOADING_STAGE_KEY: "fun:loading-stage", ERROR_KEY: "fun:recommendation-error",
    LOADING_TIMEOUT_MS: 85000, DEFAULT_LOADING_STAGE: "understanding", recommendationReadyEvent: "ready",
    loadSession: lifecycle.loadActiveRecommendation,
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = undefined; },
    window: { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
  };
  for (const name of ["FetchLoading", "Ready", "FetchError", "NoSession", "LoadingStage", "Session", "BatchIndex"]) context[`set${name}`] = value => { state[name] = value; };
  const cleanup = vm.runInNewContext(`(function(){${source.slice(start + marker.length, end)}})`, context)();
  return { state, event(name = "ready") { listeners.get(name)?.(); }, tick() { tick?.(); }, cleanup };
}

test("page clears empty/error states when a result arrives, including focus during loading", () => {
  const lifecycle = harness({ local: fakeStorage({ "fun:session-id": "anon-qa" }), storage: fakeStorage() }).load("src/lib/recommendation-lifecycle.ts");
  const page = mountRecommendationEffect(lifecycle);
  assert.equal(page.state.NoSession, true);
  lifecycle.beginRecommendationRequest("A");
  lifecycle.recommendationTabStorage.setItem("fun:loading", "true");
  lifecycle.recommendationTabStorage.setItem("fun:loading-started-at", String(Date.now()));
  page.event("focus");
  assert.equal(page.state.FetchLoading, true);
  assert.equal(page.state.NoSession, false);
  const valid = { runId: "A", request: { sessionId: "anon-qa" }, recommendation: raw, batch: [raw], generatedAt: new Date().toISOString() };
  lifecycle.recommendationTabStorage.setItem("fun:last-recommendation", JSON.stringify(valid));
  lifecycle.recommendationTabStorage.removeItem("fun:loading");
  page.tick(); // completion event missed
  assert.equal(page.state.Session.recommendation.title, raw.title);
  assert.equal(page.state.FetchLoading, false);
  assert.equal(page.state.NoSession, false);
  lifecycle.beginRecommendationRequest("B");
  lifecycle.recommendationTabStorage.setItem("fun:recommendation-error", "No verified match");
  page.event();
  assert.equal(page.state.FetchError, "No verified match");
  assert.equal(page.state.Session, null);
  page.cleanup();
  const reload = mountRecommendationEffect(lifecycle);
  assert.equal(reload.state.FetchError, "No verified match");
  assert.equal(lifecycle.recommendationTabStorage.getItem("fun:recommendation-error"), "No verified match");
  lifecycle.beginRecommendationRequest("C");
  lifecycle.recommendationTabStorage.setItem("fun:last-recommendation", JSON.stringify({ ...valid, runId: "C" }));
  reload.event();
  assert.equal(reload.state.FetchError, null);
  assert.equal(reload.state.NoSession, false);
  assert.equal(reload.state.Session.runId, "C");
  reload.cleanup();
});

test("page times out abandoned loading without resurrecting a previous result", () => {
  const lifecycle = harness({ local: fakeStorage(), storage: fakeStorage() }).load("src/lib/recommendation-lifecycle.ts");
  lifecycle.beginRecommendationRequest("old");
  lifecycle.recommendationTabStorage.setItem("fun:loading", "true");
  lifecycle.recommendationTabStorage.setItem("fun:loading-started-at", String(Date.now() - 90000));
  const page = mountRecommendationEffect(lifecycle);
  assert.match(page.state.FetchError, /too long/);
  assert.equal(page.state.FetchLoading, false);
  assert.equal(page.state.NoSession, false);
  assert.equal(lifecycle.ownsRecommendationRequest("old"), false);
  page.cleanup();
});

test("preview no-match categories are logged without storage or sensitive event fields", async () => {
  for (const environment of ["preview", "production"]) {
    const warnings = [];
    const h = harness({ env: { VERCEL_ENV: environment }, warnings });
    await h.load("src/lib/recommendation-diagnostics-store.ts").writeRecommendationDiagnostics({ outcome: "no-match", sessionId: "PRIVATE_ID", title: "PRIVATE_TITLE", runId: "PRIVATE_RUN", timings: { totalMs: 8000 }, rejectionReasons: { "family rating not verified": 2, "PRIVATE_REASON": 1 } });
    const diagnosticLogs = warnings.filter(x => x[0] === "[FUN preview no-match]");
    assert.equal(diagnosticLogs.length, environment === "preview" ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE_/);
    if (diagnosticLogs.length) assert.equal(diagnosticLogs[0][1].rejectionReasons["family rating not verified"], 2);
  }
});

test("no-match diagnostics are deferred, bounded-category and recorded once for JSON and stream failures", async () => {
  for (const mode of ["self", "choose"]) for (const stream of [false, true]) {
    const writes = [];
    const h = harness({ env: redisEnv, fetch: async (url, options) => {
      assert.equal(url, "https://redis.invalid/pipeline");
      writes.push(JSON.parse(options.body));
      return json([{ result: 1 }, { result: "OK" }]);
    } });
    const fields = mode === "self" ? { selfText: "An animated family-friendly movie for children. Nothing scary. PRIVATE_SENTINEL" } : { wants: ["animated movie", "family-friendly"], avoids: ["horror"] };
    const response = await h.load("src/app/api/recommend/route.ts").POST(new Request("http://test.invalid", { method: "POST", body: JSON.stringify({ ...fields, mode, country: "India", platformFilter: "any", stream, recommendationCount: 1, runId: "qa-failed" }) }));
    const body = await response.text();
    assert.equal(response.status, stream ? 200 : 422);
    assert.match(body, /requirements/);
    assert.equal(writes.length, 0, "storage must not block the response");
    assert.equal(h.after.length, 1);
    await h.after[0]();
    assert.equal(writes.length, 1);
    const event = JSON.parse(writes[0][0][2]);
    assert.equal(event.outcome, "no-match");
    assert.equal(event.runId, "qa-failed");
    assert.ok(event.rejectionReasons["family rating not verified"] > 0);
    assert.equal(event.title, "");
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE_SENTINEL/);
  }
});

test("family copy changes only unsupported guarantees, preserving recommendation identity and evidence", () => {
  const temper = harness().load("src/lib/family-suitability-copy.ts").temperFamilySuitability;
  const rec = { ...raw, oneLine: "A charming animated adventure.", whyItFits: ["Without any scary elements.", "Perfect for all ages.", "Beautiful animation."], contentMetadata: { familyRating: "PG", familyRatingVerified: true } };
  const result = temper(rec);
  assert.equal(result.title, rec.title);
  assert.equal(result.oneLine, rec.oneLine);
  assert.equal(result.contentMetadata, rec.contentMetadata);
  assert.equal(result.whereToWatch, rec.whereToWatch);
  assert.equal(result.whyItFits.length, 2);
  assert.match(result.whyItFits[0], /Age suitability varies/);
  assert.equal(result.whyItFits[1], "Beautiful animation.");
  assert.deepEqual(clone(temper(raw)), raw);
});

test("diagnostics never echo arbitrary rejection text and latency separates no-match outcomes", () => {
  const summarize = harness().load("src/lib/recommendation-diagnostics-store.ts").summarizeRejectionReasons;
  assert.deepEqual(clone(summarize([{ reasons: ["PRIVATE_SENTINEL", "family rating not verified"] }])), { "other trust rejection": 1, "family rating not verified": 1 });
  const summary = summarizeLatency([{ timings: { totalMs: 10 } }, { outcome: "no-match", timings: { totalMs: 20 } }]);
  assert.equal(summary.groups.successful.total.samples, 1);
  assert.equal(summary.groups.noMatch.total.samples, 1);
});

test("family verification refuses outages, malformed data, wrong titles/years and adult ratings", async () => {
  const failures = [
    async () => { throw new Error("timeout"); },
    async () => json({}, 503),
    async () => new Response("not json"),
    async () => json({ Response: "True", Title: "Wrong Movie", Year: raw.year, Rated: "PG" }),
    async () => json({ Response: "True", Title: raw.title, Year: "1999", Rated: "PG" }),
    async () => json({ Response: "True", Title: raw.title, Year: raw.year, Rated: "R" }),
  ];
  for (const fetch of failures) {
    const h = harness({ env: { OMDB_API_KEY: "fixture" }, fetch });
    const rec = await h.load("src/lib/metadata.ts").verifyFamilyRating(raw);
    assert.equal(rec.contentMetadata.familyRatingVerified, false);
    assert.equal(rec.contentMetadata.familyRating, undefined);
  }
});

test("explicit constraints reject normalized seen titles and conflicting saved languages in both modes", () => {
  const gate = harness().load("src/lib/explicit-constraints.ts");
  for (const fields of [
    { mode: "choose", wants: ["comedy"], avoids: ["Hindi"] },
    { mode: "self", selfText: "A comedy, but not in Hindi" },
  ]) {
    const input = { ...fields, languagePreferences: ["Hindi", "English"], seenTitles: ["EXAMPLE—MOVIE!"] };
    const rejected = gate.explicitConstraintRejections(input, { ...raw, contentMetadata: { originalLanguage: "hi", genreIds: [35] } });
    assert.ok(rejected.includes("excluded title"));
    assert.ok(rejected.includes("excluded language"));
    assert.deepEqual(clone(gate.explicitConstraintRejections({ ...input, seenTitles: [] }, { ...raw, contentMetadata: { originalLanguage: "en", genreIds: [35] } })), []);
  }
});

test("reload retains a valid pick but an identity change invalidates it", () => {
  const local = fakeStorage({ "fun:session-id": "anon-qa" });
  const storage = fakeStorage();
  const first = harness({ local, storage }).load("src/lib/recommendation-lifecycle.ts");
  first.beginRecommendationRequest("reload");
  first.recommendationTabStorage.setItem("fun:last-recommendation", JSON.stringify({ runId: "reload", request: { sessionId: "anon-qa" }, recommendation: raw, batch: [raw], generatedAt: new Date().toISOString() }));
  const reloaded = harness({ local, storage }).load("src/lib/recommendation-lifecycle.ts");
  assert.equal(reloaded.loadActiveRecommendation().recommendation.title, raw.title);
  local.setItem("fun:session-id", "anon-new");
  assert.equal(reloaded.loadActiveRecommendation(), null);
  assert.equal(reloaded.ownsRecommendationRequest("reload", "anon-qa"), false);
});

test("catalogue result and safety metadata stay identical while an unused provider lookup is removed", async () => {
  const entry = JSON.parse(readFileSync(resolve(root, "src/data/availability.json"), "utf8"))[0];
  async function run(disabled) {
    const calls = [];
    const h = harness({ env: { TMDB_API_KEY: "fixture", FUN_DISABLE_METADATA_REUSE: disabled ? "1" : "0" }, fetch: async (url) => {
      calls.push(url);
      if (url.includes("/search/")) return json({ results: [{ id: 1, title: entry.title, poster_path: "/poster.jpg", original_language: "en", genre_ids: [35] }] });
      if (url.includes("/watch/providers")) return json({ results: {} });
      throw new Error("Unexpected lookup");
    } });
    const result = await h.load("src/lib/metadata.ts").enrichRecommendation({ ...raw, title: entry.title, year: entry.year }, entry.countries[0], ["Netflix"]);
    return { result: clone(result), calls };
  }
  const baseline = await run(true);
  const optimized = await run(false);
  assert.deepEqual(optimized.result, baseline.result);
  assert.equal(baseline.calls.length, 2);
  assert.equal(optimized.calls.length, 1);
  assert.deepEqual(optimized.result.contentMetadata.genreIds, [35]);
});

test("simultaneous metadata lookups share work and failures do not poison subsequent lookups", async () => {
  let calls = 0;
  let fail = false;
  const h = harness({ env: { TMDB_API_KEY: "fixture" }, fetch: async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (fail) return json({ error: "unavailable" }, 503);
    return json({ results: [{ id: 1, title: raw.title, poster_path: "/poster.jpg" }] });
  } });
  const metadata = h.load("src/lib/metadata.ts");
  const titles = [{ title: raw.title, year: raw.year }];
  const [a, b] = await Promise.all([metadata.enrichRelatedPosters(titles), metadata.enrichRelatedPosters(titles)]);
  assert.equal(calls, 1);
  assert.deepEqual(clone(a), clone(b));
  fail = true;
  const failed = await metadata.enrichRelatedPosters(titles);
  assert.equal(failed[0].posterUrl, undefined);
  fail = false;
  const recovered = await metadata.enrichRelatedPosters(titles);
  assert.match(recovered[0].posterUrl, /poster.jpg$/);
});

test("non-catalogue availability remains regional and OMDb remains a working fallback", async () => {
  const h = harness({ env: { TMDB_API_KEY: "fixture", OMDB_API_KEY: "fixture" }, fetch: async (url) => {
    if (url.includes("/search/")) return json({ results: [{ id: 9, title: raw.title, poster_path: null, original_language: "ko", genre_ids: [53] }] });
    if (url.includes("/watch/providers")) return json({ results: { GB: { flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: null }] } } });
    if (url.includes("omdbapi")) return json({ Response: "True", Title: raw.title, Poster: "https://m.media-amazon.com/fixture.jpg" });
    throw new Error("Unexpected lookup");
  } });
  const metadata = h.load("src/lib/metadata.ts");
  const gb = await metadata.enrichRecommendation(raw, "United Kingdom", ["Netflix"]);
  const ie = await metadata.enrichRecommendation(raw, "Ireland", ["Netflix"]);
  assert.equal(gb.whereToWatch.status, "verified");
  assert.equal(gb.whereToWatch.notOnUserPlatforms, false);
  assert.equal(ie.whereToWatch.status, "unverified");
  assert.equal(gb.contentMetadata.originalLanguage, "ko");
  assert.match(gb.omdbPosterUrl, /fixture.jpg$/);
});

test("provider outages and invalid JSON retain unverified fallback behavior", async () => {
  for (const fetch of [async () => { throw new Error("offline"); }, async () => new Response("not json")]) {
    const h = harness({ env: { TMDB_API_KEY: "fixture", OMDB_API_KEY: "fixture" }, fetch });
    const result = await h.load("src/lib/metadata.ts").enrichRecommendation(raw, "Ireland", []);
    assert.equal(result.whereToWatch.status, "unverified");
    assert.equal(result.contentMetadata.catalogConfirmed, false);
    assert.equal(result.title, raw.title);
  }
});

test("learning events preserve run links and prompt opt-in without trimming or expiry", async () => {
  for (const enabled of ["true", "false"]) {
    const commands = [];
    const h = harness({ env: { ...redisEnv, FUN_COLLECT_PROMPTS: enabled }, fetch: async (_url, options) => {
      const batch = JSON.parse(options.body); commands.push(...batch); return json(batch.map(() => ({ result: 1 })));
    } });
    const payload = { sessionId: "anon-fixture", runId: "run-fixture", type: "ask", reason: "perfect", title: raw.title, year: raw.year,
      request: { mode: "self", selfText: "fixture prompt", country: "United Kingdom" }, recommendation: raw, batch: [raw] };
    for (const route of ["events", "feedback", "recommendation-runs"]) {
      await h.load(`src/app/api/${route}/route.ts`).POST(new Request("http://test.invalid", { method: "POST", body: JSON.stringify(payload) }));
    }
    await Promise.all(h.after.map((fn) => fn()));
    for (const key of ["fun:events", "fun:feedback", "fun:recommendation-runs"]) {
      assert.equal(commands.filter((c) => c[1] === key && c[0] === "LPUSH").length, 1);
      assert.equal(commands.some((c) => c[1] === key && ["LTRIM", "EXPIRE", "DEL"].includes(c[0])), false);
    }
    const run = JSON.parse(commands.find((c) => c[1] === "fun:recommendation-runs")[2]);
    assert.equal(run.runId, payload.runId);
    assert.equal(run.request.selfText, enabled === "true" ? "fixture prompt" : undefined);
    assert.equal(run.recommendation.title, raw.title);
  }
});

test("profile deletion reports Redis command failures and only removes profile keys", async () => {
  let fail = true;
  let commands;
  const h = harness({ env: redisEnv, fetch: async (_url, options) => {
    commands = JSON.parse(options.body);
    return json(fail ? [{ error: "ERR" }] : [{ result: 3 }]);
  } });
  const route = h.load("src/app/api/profile-memory/route.ts");
  const request = () => new Request("http://test.invalid", { method: "DELETE", body: JSON.stringify({ sessionId: "anon-fixture" }) });
  assert.equal((await route.DELETE(request())).status, 503);
  fail = false;
  assert.equal((await route.DELETE(request())).status, 200);
  assert.deepEqual(commands, [["DEL", "fun:profile:anon-fixture:recommendations", "fun:profile:anon-fixture:titles", "fun:profile:anon-fixture:feedback"]]);
});

test("health accepts deployed legacy KV names; 429 and malformed requests call no providers", async () => {
  const h = harness({ env: { NODE_ENV: "production", OPENAI_API_KEY: "fixture", TMDB_API_KEY: "fixture", ...redisEnv },
    fetch: async (url) => { assert.match(url, /redis.invalid/); return json([{ result: null }, { result: 51 }, { result: 0 }]); } });
  assert.equal((await h.load("src/app/api/health/route.ts").GET()).status, 200);
  const route = h.load("src/app/api/recommend/route.ts");
  const blocked = await route.POST(new Request("http://test.invalid", { method: "POST", headers: { "x-forwarded-for": "192.0.2.1" }, body: "{}" }));
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("Retry-After"));
  h.env.NODE_ENV = "development";
  assert.equal((await route.POST(new Request("http://test.invalid", { method: "POST", body: "{" }))).status, 400);
});

test("draft recovery handles unavailable or corrupt browser storage", () => {
  const values = new Map();
  const h = harness({ storage: { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) } });
  const draft = h.load("src/lib/recommendation-draft.ts");
  const input = { inputMode: "describe", selectedMoods: [], selectedAvoids: ["horror"], selectedWants: [], time: "90", energy: "Low", risk: 0, platformFilter: "mine", indieMode: false, selfText: "Keep my request", reference: "" };
  draft.saveRecommendationDraft(input);
  assert.deepEqual(clone(draft.loadRecommendationDraft()), input);
  draft.clearRecommendationDraft();
  assert.equal(draft.loadRecommendationDraft(), null);
  values.set(draft.recommendationDraftKey, "{");
  assert.equal(draft.loadRecommendationDraft(), null);
  const unavailable = harness().load("src/lib/recommendation-draft.ts");
  assert.doesNotThrow(() => unavailable.saveRecommendationDraft(input));
  assert.equal(unavailable.loadRecommendationDraft(), null);
});

test("streamed requests still produce the existing fallback when no providers are configured", async () => {
  const h = harness({ env: { NODE_ENV: "production" } });
  const route = h.load("src/app/api/recommend/route.ts");
  const response = await route.POST(new Request("http://test.invalid", { method: "POST", body: JSON.stringify({
    mode: "self", selfText: "Something light and funny", country: "United Kingdom", platforms: [],
    platformFilter: "any", recommendationCount: 1, responseDetail: "core", stream: true,
  }) }));
  assert.equal(response.status, 200);
  const messages = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const result = messages.find((m) => m.type === "result")?.payload;
  assert.ok(result?.title);
  assert.equal(result._trust.fallbackUsed, true);
  assert.equal(h.after.length, 1, "stream diagnostics are scheduled through the response lifecycle");
  await h.after[0]();
});

test("Redis outage preserves the current rate limiter failure policy", async () => {
  const h = harness({ env: { NODE_ENV: "production", ...redisEnv }, fetch: async () => { throw new Error("offline"); } });
  assert.equal((await h.load("src/lib/rate-limit.ts").checkRateLimit("192.0.2.1")).limited, false);
});

test("latency report excludes missing metrics and distinguishes first pick from background work", () => {
  const summary = summarizeLatency([
    { recommendationCount: 1, timings: { totalMs: 1000 }, retryCount: 0 },
    { request: { recommendationCount: 2 }, diagnostics: { timings: { totalMs: 9000, intentMs: 0 }, retryCount: 1 } },
    { timings: {} }, "invalid",
  ]);
  assert.equal(summary.timedRecords, 2);
  assert.equal(summary.groups.singlePick.total.p50Ms, 1000);
  assert.equal(summary.groups.backgroundTwoPicks.total.p95Ms, 9000);
  assert.equal(summary.groups.all.intent.samples, 1);
});

test("learning writes detect HTTP, command, malformed and network failures without leaking payloads or retrying", async () => {
  for (const reply of [() => json({}, 503), () => json([{ error: "secret-provider-detail" }]),
    () => json([]), () => json([{}]), () => new Response("invalid"), () => { throw new Error("secret-network-detail"); }]) {
    const warnings = []; let calls = 0;
    const h = harness({ env: redisEnv, warnings, fetch: async () => { calls++; return reply(); } });
    await assert.rejects(h.load("src/lib/learning-storage.ts").writeLearningRecord("fun:events", { payload: "secret-prompt" }), /Learning storage write failed/);
    assert.equal(calls, 1);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(warnings), /secret/);
  }
});

test("learning provenance is server-owned and distinguishes local, preview and production", async () => {
  for (const environment of ["local", "preview", "production"]) {
    let stored;
    const h = harness({ env: { ...redisEnv, VERCEL_ENV: environment === "local" ? undefined : environment }, fetch: async (_url, options) => {
      stored = JSON.parse(JSON.parse(options.body)[0][2]); return json([{ result: 1 }]);
    } });
    await h.load("src/lib/learning-storage.ts").writeLearningRecord("fun:events", { environment: "forged", payload: { choice: "yes" } });
    assert.equal(stored.environment, environment);
    assert.deepEqual(stored.payload, { choice: "yes" });
  }
});

test("learning endpoints respond before a rejected background write and diagnostics remain fail-open", async () => {
  const warnings = [];
  const h = harness({ env: redisEnv, warnings, fetch: async () => json([{ error: "ERR" }]) });
  const response = await h.load("src/app/api/events/route.ts").POST(new Request("http://test.invalid", {
    method: "POST", body: JSON.stringify({ type: "ask", sessionId: "qa-fixture" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(warnings.length, 0);
  await h.after[0]();
  assert.ok(warnings.length > 0);
  await assert.doesNotReject(h.load("src/lib/recommendation-diagnostics-store.ts").writeRecommendationDiagnostics({ runId: "qa" }));
});

test("production latency excludes preview, local and unlabelled historical records", () => {
  const summary = summarizeLatency([
    { environment: "production", timings: { totalMs: 1000 } },
    { environment: "preview", timings: { totalMs: 20 } },
    { environment: "local", timings: { totalMs: 10 } },
    { timings: { totalMs: 1 } },
  ], "production");
  assert.equal(summary.recordsRead, 4);
  assert.equal(summary.timedRecords, 1);
  assert.equal(summary.groups.all.total.p50Ms, 1000);
});

test("pills, describe and combined exclusions win over contradictory positive intent, including timeout fallback", () => {
  const h = harness();
  const { localIntentContract, normalizeIntentContract } = h.load("src/lib/intent-contract.ts");
  for (const input of [
    { mode: "choose", wants: ["comedy"], avoids: ["horror"] },
    { mode: "self", selfText: "A warm uplifting comedy, nothing frightening" },
    { mode: "self", selfText: "Scare me", wants: ["comedy"], avoids: ["horror"] },
  ]) {
    const local = localIntentContract(input);
    assert.ok(local.hardAvoids.includes("horror"));
    assert.notEqual(local.primary, "scare");
    const model = normalizeIntentContract({ primary: "scare", secondary: ["scare"], hardAvoids: [] }, input);
    assert.notEqual(model.primary, "scare");
    assert.ok(model.hardAvoids.includes("horror"));
    assert.equal(model.secondary.includes("scare"), false);
  }
  for (const input of [{ mode: "choose", wants: ["scary"] }, { mode: "self", selfText: "Scare me with a real horror, no jump scares" }]) {
    assert.equal(localIntentContract(input).primary, "scare");
  }
});

test("language exclusions work in pills, text and mixed controls without breaking positive preferences", () => {
  const h = harness();
  const languages = h.load("src/lib/language-lane.ts");
  const gate = h.load("src/lib/explicit-constraints.ts");
  const hindi = { ...raw, contentMetadata: { originalLanguage: "hi", genreIds: [35] } };
  for (const input of [
    { mode: "choose", wants: ["comedy"], avoids: ["Hindi"] },
    { mode: "self", selfText: "A comedy, but not in Hindi" },
    { mode: "self", selfText: "Not in Hindi or Spanish", languagePreferences: ["Hindi"] },
  ]) {
    assert.equal(languages.detectRequestedLanguageKey(input), null);
    assert.ok(gate.explicitConstraintRejections(input, hindi).includes("excluded language"));
  }
  assert.deepEqual(clone(languages.detectAvoidedLanguageKeys({ selfText: "Not in Hindi or Spanish" })), ["hindi", "spanish"]);
  assert.equal(languages.detectRequestedLanguageKey({ wants: ["Hindi comedy"] }), "hindi");
  assert.equal(languages.detectRequestedLanguageKey({ selfText: "A Hindi comedy" }), "hindi");
  assert.equal(languages.detectRequestedLanguageKey({ selfText: "Not only Hindi comedy" }), "hindi");
});

test("animation and family rating are separate gates for pills, text and combined controls", async () => {
  const h = harness({ env: { OMDB_API_KEY: "fixture" }, fetch: async () => json({ Response: "True", Title: raw.title, Year: raw.year, Rated: "PG" }) });
  const gate = h.load("src/lib/explicit-constraints.ts");
  const metadata = h.load("src/lib/metadata.ts");
  const animated = { ...raw, contentMetadata: { genreIds: [16, 10751] } };
  for (const input of [
    { mode: "choose", wants: ["animated", "family-friendly"] },
    { mode: "self", selfText: "An animated family-friendly movie for children" },
    { mode: "self", selfText: "For children", wants: ["animated"] },
  ]) {
    assert.ok(gate.explicitConstraintRejections(input, animated).includes("family rating not verified"));
    const verified = await metadata.verifyFamilyRating(animated);
    assert.deepEqual(clone(gate.explicitConstraintRejections(input, verified)), []);
    assert.ok(gate.explicitConstraintRejections(input, { ...verified, contentMetadata: { ...verified.contentMetadata, genreIds: [18] } }).includes("animation not verified"));
  }
  const adult = harness({ env: { OMDB_API_KEY: "fixture" }, fetch: async () => json({ Response: "True", Title: raw.title, Rated: "R" }) });
  assert.equal((await adult.load("src/lib/metadata.ts").verifyFamilyRating(animated)).contentMetadata.familyRatingVerified, false);
});

test("no fallback can reintroduce an explicitly excluded language or unverified animation, for all request counts and stream modes", async () => {
  for (const input of [
    { mode: "self", selfText: "A comedy, not in Hindi" },
    { mode: "choose", wants: ["comedy"], avoids: ["Hindi"] },
    { mode: "self", selfText: "An animated movie" },
    { mode: "choose", wants: ["animated movie"] },
  ]) {
    for (const count of [1, 2, 3]) {
      const h = harness({ env: { TMDB_API_KEY: "fixture" }, fetch: async url => {
        const u = new URL(url);
        if (u.pathname.includes("/search/")) return json({ results: [{ id: 1, title: u.searchParams.get("query"), name: u.searchParams.get("query"), poster_path: "/fixture.jpg", original_language: "hi", genre_ids: [18] }] });
        return json({ results: {} });
      } });
      const route = h.load("src/app/api/recommend/route.ts");
      const body = { ...input, country: "India", platformFilter: "any", recommendationCount: count, responseDetail: "core", stream: count === 1 };
      const response = await route.POST(new Request("http://test.invalid", { method: "POST", body: JSON.stringify(body) }));
      if (body.stream) {
        const messages = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
        assert.equal(messages.some(m => m.type === "result"), false);
        assert.match(messages.find(m => m.type === "error").error, /requirements/);
      } else {
        assert.equal(response.status, 422);
        assert.equal((await response.json()).code, "no-matching-recommendation");
      }
    }
  }
});

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("late fills cannot contaminate a newer request, resurrect cleared memory or duplicate the latest batch", () => {
  const local = fakeStorage({ "fun:session-id": "anon-qa" });
  const h = harness({ local, storage: fakeStorage() });
  const lifecycle = h.load("src/lib/recommendation-lifecycle.ts");
  const make = runId => ({ runId, request: { sessionId: "anon-qa", country: "United Kingdom" }, recommendation: raw, batch: [raw], generatedAt: new Date().toISOString() });
  const first = make("A");
  lifecycle.beginRecommendationRequest("A");
  lifecycle.recommendationTabStorage.setItem("fun:last-recommendation", JSON.stringify(first));
  assert.ok(lifecycle.loadActiveRecommendation());
  const latest = { ...first, batch: [raw, { ...raw, title: "Second" }] };
  const merged = lifecycle.mergeBackgroundRecommendations(first, latest, [{ ...raw, title: "Second" }, { ...raw, title: "Third" }]);
  assert.equal(merged.batch.length, 3);
  lifecycle.beginRecommendationRequest("B");
  assert.equal(lifecycle.loadActiveRecommendation(), null);
  assert.equal(lifecycle.mergeBackgroundRecommendations(first, make("B"), [{ ...raw, title: "Old fill" }]), null);
  assert.equal(lifecycle.ownsRecommendationRequest("A", "anon-qa"), false);
  local.removeItem("fun:session-id");
  assert.equal(lifecycle.ownsRecommendationRequest("B", "anon-qa"), false);
  lifecycle.clearActiveRecommendation();
  assert.equal(lifecycle.mergeBackgroundRecommendations(first, first, []), null);
});

test("tabs are isolated and malformed, expired, failed or profile-mismatched results are not restored", () => {
  const local = fakeStorage({ "fun:session-id": "anon-qa" });
  const tabA = harness({ local, storage: fakeStorage() }).load("src/lib/recommendation-lifecycle.ts");
  const tabB = harness({ local, storage: fakeStorage() }).load("src/lib/recommendation-lifecycle.ts");
  tabA.beginRecommendationRequest("A"); tabB.beginRecommendationRequest("B");
  assert.equal(tabA.ownsRecommendationRequest("A", "anon-qa"), true);
  assert.equal(tabB.ownsRecommendationRequest("A", "anon-qa"), false);
  const valid = { runId: "A", request: { sessionId: "anon-qa", country: "United Kingdom", platforms: ["Netflix"] }, recommendation: raw, batch: [raw], generatedAt: new Date().toISOString() };
  const save = value => tabA.recommendationTabStorage.setItem("fun:last-recommendation", JSON.stringify(value));
  save(valid); assert.ok(tabA.loadActiveRecommendation());
  save({ ...valid, generatedAt: "2020-01-01" }); assert.equal(tabA.loadActiveRecommendation(), null);
  save({ ...valid, batch: {} }); assert.equal(tabA.loadActiveRecommendation(), null);
  save(valid); tabA.recommendationTabStorage.setItem("fun:recommendation-error", "New request failed"); assert.equal(tabA.loadActiveRecommendation(), null);
  tabA.recommendationTabStorage.removeItem("fun:recommendation-error");
  local.setItem("fun:onboarding", JSON.stringify({ country: "India", platforms: ["Netflix"] }));
  assert.equal(tabA.loadActiveRecommendation(), null);
});

test("English and multiple selected languages are respected, while a denied saved language does not return through the contract or fallback", () => {
  const h = harness();
  const gate = h.load("src/lib/explicit-constraints.ts");
  const input = { mode: "choose", wants: ["comedy"], languagePreferences: ["Hindi", "English"] };
  for (const lang of ["hi", "en"]) assert.deepEqual(clone(gate.explicitConstraintRejections(input, { ...raw, contentMetadata: { originalLanguage: lang } })), []);
  assert.ok(gate.explicitConstraintRejections({ mode: "self", selfText: "An English movie" }, { ...raw, contentMetadata: { originalLanguage: "hi" } }).includes("requested language mismatch"));
  for (const input of [{ mode: "choose", wants: ["comedy"], avoids: ["Hindi"] }, { mode: "self", selfText: "A comedy, not in Hindi", languagePreferences: ["Hindi"] }]) {
    const contracts = h.load("src/lib/intent-contract.ts");
    assert.equal(contracts.localIntentContract(input).language, "any");
    assert.equal(contracts.normalizeIntentContract({ language: "Hindi", primary: "comedy" }, input).language, "any");
    const fallback = h.load("src/lib/fallbacks.ts").localFallback(input);
    assert.equal(fallback.some(rec => rec.title === "Hera Pheri"), false);
    assert.doesNotMatch(h.load("src/lib/prompt.ts").buildRecommendationPrompt(input), /HARD LANGUAGE LOCK — HINDI/);
  }
});

test("corrupt optional memory lists do not crash exclusion assembly or erase valid entries", () => {
  const local = fakeStorage({
    "fun:seen-titles": JSON.stringify(["Valid title", null, 12]),
    "fun:recent-recommendation-titles": "{}",
    "fun:recommendation-history": JSON.stringify([null, { title: 7 }]),
    "fun:recommendation-feedback": "null",
  });
  const memory = harness({ local }).load("src/lib/recommendation-session.ts");
  assert.deepEqual(clone(memory.loadExactRecommendationExclusions()), ["Valid title"]);
});

test("full background batches stay bounded and preserve a user-advanced hero", () => {
  const local = fakeStorage({ "fun:session-id": "anon-qa", "fun:seen-titles": JSON.stringify(["New but seen elsewhere"]) });
  const lifecycle = harness({ local, storage: fakeStorage() }).load("src/lib/recommendation-lifecycle.ts");
  lifecycle.beginRecommendationRequest("A");
  const second = { ...raw, title: "Second" };
  const current = { runId: "A", request: { sessionId: "anon-qa" }, recommendation: raw, batch: [raw], generatedAt: new Date().toISOString() };
  const latest = { ...current, recommendation: second, batch: [raw, second], batchIndex: 1 };
  const merged = lifecycle.mergeBackgroundRecommendations(current, latest, [{ ...raw, title: "New but seen elsewhere" }, { ...raw, title: "Third" }, { ...raw, title: "Fourth" }]);
  assert.equal(merged.batch.length, 3);
  assert.equal(merged.recommendation.title, "Second");
  assert.equal(merged.batchIndex, 1);
  assert.equal(merged.batch[2].title, "Third");
});

test("full or disabled device memory does not discard a generated result", () => {
  const local = { getItem() { return null; }, setItem() { throw new Error("Quota exceeded"); }, removeItem() {} };
  const memory = harness({ local }).load("src/lib/recommendation-session.ts");
  assert.doesNotThrow(() => memory.rememberRecommendationTitles([raw.title]));
  assert.doesNotThrow(() => memory.rememberRecommendationHistory([raw], { mode: "self" }, "qa"));
  assert.deepEqual(clone(memory.addSeenTitle(raw.title)), [raw.title]);
  const lifecycle = harness({ local, storage: local }).load("src/lib/recommendation-lifecycle.ts");
  lifecycle.beginRecommendationRequest("qa-full");
  assert.equal(lifecycle.ownsRecommendationRequest("qa-full", "unknown"), true);
  lifecycle.clearActiveRecommendation();
  assert.equal(lifecycle.ownsRecommendationRequest("qa-full", "unknown"), false);
});
