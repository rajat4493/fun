import { RawRecommendation } from "@/lib/types";
import { extractJson, uniqueValues, withTimeout } from "@/lib/recommendation-utils";

const ANTHROPIC_TIMEOUT_MS = 25000;
// Measured real-world 3-pick generation time is 15-23s (p95), right at or over the old 15000ms
// ceiling — meaning a request that would have succeeded at 18s was being cut off and forced into
// a full retry (another 15-25s), turning a ~18s wait into a 30-44s one. Raised to give the first
// attempt a fair chance to actually finish instead of paying for two calls when one would do.
const FALLBACK_LLM_TIMEOUT_MS = 25000;
const LLM_MAX_OUTPUT_TOKENS = 3000;
const INTENT_TIMEOUT_MS = 3500;
const INTENT_MAX_OUTPUT_TOKENS = 700;

// Providers allocate/reserve generation budget roughly proportional to max_tokens, so a 1-pick
// request paying the same 3000-token ceiling as a 3-pick request wastes allocation it never uses.
// Scaled by count, capped at the original constant so the already-proven 3-pick path (count=3)
// gets exactly LLM_MAX_OUTPUT_TOKENS, unchanged from before this existed.
const LLM_TOKENS_PER_PICK = 1000;
const LLM_CORE_TOKENS_PER_PICK = 800;
const LLM_TOKENS_BASE_OVERHEAD = 200;
function outputTokenBudget(count: number, includeDiscovery = true): number {
  const perPick = includeDiscovery ? LLM_TOKENS_PER_PICK : LLM_CORE_TOKENS_PER_PICK;
  return Math.min(LLM_MAX_OUTPUT_TOKENS, LLM_TOKENS_BASE_OVERHEAD + perPick * count);
}

type AnthropicTextBlock = {
  type: "text";
  text: string;
};

type AnthropicResponse = {
  content?: AnthropicTextBlock[];
};

type OpenAIResponse = {
  id?: string;
  status?: "completed" | "failed" | "incomplete" | "in_progress" | "queued";
  error?: {
    code?: string;
    message?: string;
  } | null;
  incomplete_details?: {
    reason?: string;
  } | null;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type LlmCallTelemetry = {
  provider: "openai";
  purpose: "intent" | "recommendation";
  model: string;
  ok: boolean;
  durationMs: number;
  requestId?: string;
  responseId?: string;
  status?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  temperature: number;
  maxOutputTokens: number;
  promptCacheKey: string;
  requestedCount?: number;
  includeDiscovery?: boolean;
  promptChars: number;
  prompt?: string;
  responseText?: string;
  error?: string;
};

export type LlmTelemetryOptions = {
  captureContent?: boolean;
  onCall?: (telemetry: LlmCallTelemetry) => void;
};

function emitOpenAITelemetry(
  options: LlmTelemetryOptions | undefined,
  value: Omit<LlmCallTelemetry, "provider">,
): void {
  options?.onCall?.({ provider: "openai", ...value });
}

function logOpenAICacheUsage(label: string, data: OpenAIResponse): void {
  if (process.env.FUN_DEBUG_TRACES !== "1" || !data.usage) return;
  console.log(
    `[FUN OpenAI usage] ${label} input=${data.usage.input_tokens ?? 0} ` +
    `cached=${data.usage.input_tokens_details?.cached_tokens ?? 0} ` +
    `output=${data.usage.output_tokens ?? 0} total=${data.usage.total_tokens ?? 0}`,
  );
}

function openAIResponseError(data: OpenAIResponse, requestId?: string | null): Error | null {
  if (!data.status || data.status === "completed") return null;
  const detail = data.error?.message ?? data.incomplete_details?.reason ?? "No completion reason supplied";
  const identifiers = [
    data.id ? `response=${data.id}` : "",
    requestId ? `request=${requestId}` : "",
  ].filter(Boolean).join(", ");
  return new Error(`OpenAI response ${data.status}: ${detail}${identifiers ? ` (${identifiers})` : ""}`);
}

async function openAIHttpError(response: Response, model: string): Promise<Error> {
  const requestId = response.headers.get("x-request-id");
  let detail = "";
  try {
    const body = await response.json() as { error?: { message?: string; code?: string } };
    detail = body.error?.message ?? body.error?.code ?? "";
  } catch {
    // Status and request id still identify the failure when the body is not JSON.
  }
  return new Error(
    `OpenAI ${model} failed with ${response.status}${detail ? `: ${detail}` : ""}${requestId ? ` (request=${requestId})` : ""}`,
  );
}

// Standard OpenAI-compatible chat completions response.
// Supported by Groq, Mistral, Together AI, Ollama, LM Studio, Fireworks, Perplexity,
// Google Gemini (via compat layer), and any other OpenAI-compatible provider.
type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function parseRecommendationJson(text: string): RawRecommendation[] {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  if (Array.isArray(parsed)) return hydrateRecommendationDefaults(parsed as RawRecommendation[]);
  if (parsed && typeof parsed === "object") {
    const wrapped = Object.values(parsed).find(Array.isArray);
    if (wrapped) return hydrateRecommendationDefaults(wrapped as RawRecommendation[]);
  }
  return hydrateRecommendationDefaults([parsed as RawRecommendation]);
}

function hydrateRecommendationDefaults(batch: RawRecommendation[]): RawRecommendation[] {
  return batch.map((recommendation) => ({
    ...recommendation,
    // Some otherwise valid model responses express confidence as a 0-1 probability even
    // though F.U.N's public contract uses 0-100. Normalize at the provider boundary so trust,
    // ranking, retries, and UI all evaluate the same value.
    confidence: typeof recommendation.confidence === "number" && recommendation.confidence > 0 && recommendation.confidence <= 1
      ? recommendation.confidence * 100
      : recommendation.confidence,
    hiddenLayer: recommendation.hiddenLayer ?? {
      headline: "",
      insight: "",
      classyJab: "",
    },
    hiddenTitles: recommendation.hiddenTitles ?? [],
    alternatives: recommendation.alternatives ?? [],
  }));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

// Generic OpenAI-compatible provider — reads LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
// Set these to use Groq, Mistral, Together AI, Ollama, Fireworks, Perplexity, Gemini, etc.
export async function recommendWithGenericLLM(
  prompt: string,
  temperature = 0.85,
  count = 3,
  includeDiscovery = true,
  timeoutMs = FALLBACK_LLM_TIMEOUT_MS,
): Promise<RawRecommendation[]> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error("Missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await withTimeout(
    (signal) => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: outputTokenBudget(count, includeDiscovery),
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    }),
    timeoutMs,
    `Generic LLM (${model})`,
  );

  if (!response.ok) throw new Error(`Generic LLM (${model}) failed with ${response.status}`);
  const data = (await response.json()) as ChatCompletionsResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseRecommendationJson(text);
}

export async function interpretIntentWithGenericLLM(prompt: string): Promise<Record<string, unknown>> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error("Missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await withTimeout(
    (signal) => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: INTENT_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    }),
    INTENT_TIMEOUT_MS,
    `Generic intent LLM (${model})`,
  );

  if (!response.ok) throw new Error(`Generic intent LLM (${model}) failed with ${response.status}`);
  const data = (await response.json()) as ChatCompletionsResponse;
  return parseJsonObject(data.choices?.[0]?.message?.content ?? "");
}

export async function recommendWithAnthropic(
  prompt: string,
  temperature = 0.85,
  count = 3,
  includeDiscovery = true,
  timeoutMs = ANTHROPIC_TIMEOUT_MS,
): Promise<RawRecommendation[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const response = await withTimeout(
    (signal) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: outputTokenBudget(count, includeDiscovery),
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    }),
    timeoutMs,
    "Anthropic",
  );

  if (!response.ok) throw new Error(`Anthropic failed with ${response.status}`);
  const data = (await response.json()) as AnthropicResponse;
  const text = data.content?.map((block) => block.text).join("\n") ?? "";
  return parseRecommendationJson(text);
}

export async function interpretIntentWithAnthropic(prompt: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const response = await withTimeout(
    (signal) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: INTENT_MAX_OUTPUT_TOKENS,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    }),
    INTENT_TIMEOUT_MS,
    "Anthropic intent",
  );

  if (!response.ok) throw new Error(`Anthropic intent failed with ${response.status}`);
  const data = (await response.json()) as AnthropicResponse;
  const text = data.content?.map((block) => block.text).join("\n") ?? "";
  return parseJsonObject(text);
}

function openAIText(data: OpenAIResponse): string {
  if (data.output_text) return data.output_text;
  return data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("\n") ?? "";
}

// OpenAI Structured Outputs (strict mode) — the model provider uses constrained decoding so the
// response is guaranteed to match this shape exactly; malformed/truncated JSON becomes structurally
// impossible rather than something we catch after the fact. This targets a real, observed failure
// mode ("Expected double-quoted property name in JSON at position 1373") — though it only fixes
// *structural* validity, not *semantic* correctness (a schema-valid response can still declare the
// wrong format/genre), so the trust layer's content checks remain necessary and unchanged.
// Strict mode requires every property listed in "required" (no true-optional fields — arrays that
// are conceptually optional are just allowed to be empty) and "additionalProperties": false on
// every object, including nested ones.
const PARSED_INTENT_SCHEMA = {
  type: "object",
  properties: {
    primary: { type: "string", enum: ["scare", "cry", "comedy", "thriller", "romance", "weird", "comfort", "gore", "drama", "discovery", "unknown"] },
    secondary: { type: "array", items: { type: "string" } },
    hardAvoids: { type: "array", items: { type: "string" } },
    softAvoids: { type: "array", items: { type: "string" } },
    format: { type: "string", enum: ["film", "series", "episode", "any"] },
    language: { type: "string" },
    situation: { type: "array", items: { type: "string" } },
    intensity: { type: "string", enum: ["safe", "curious", "bold", "unhinged"] },
    ambiguity: { type: "string" },
  },
  required: ["primary", "secondary", "hardAvoids", "softAvoids", "format", "language", "situation", "intensity", "ambiguity"],
  additionalProperties: false,
};

const RECOMMENDATION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    parsedIntent: PARSED_INTENT_SCHEMA,
    title: { type: "string" },
    year: { type: "string" },
    format: { type: "string", enum: ["Film", "Series", "Episode", "Documentary", "Unknown"] },
    runtime: { type: "string" },
    vibe: { type: "string" },
    contentCategory: { type: "array", items: { type: "string" } },
    emotionalEffect: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    oneLine: { type: "string" },
    whyItFits: { type: "array", items: { type: "string" } },
    whereToWatch: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["unverified"] },
        primary: { type: "string" },
        note: { type: "string" },
      },
      required: ["status", "primary", "note"],
      additionalProperties: false,
    },
    hiddenLayer: {
      type: "object",
      properties: {
        headline: { type: "string" },
        insight: { type: "string" },
        classyJab: { type: "string" },
      },
      required: ["headline", "insight", "classyJab"],
      additionalProperties: false,
    },
    hiddenTitles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: "string" },
        },
        required: ["title", "year"],
        additionalProperties: false,
      },
    },
    alternatives: { type: "array", items: { type: "string" } },
  },
  required: ["parsedIntent", "title", "year", "format", "runtime", "vibe", "contentCategory", "emotionalEffect", "confidence", "oneLine", "whyItFits", "whereToWatch", "hiddenLayer", "hiddenTitles", "alternatives"],
  additionalProperties: false,
};

const CORE_RECOMMENDATION_KEYS = [
  "parsedIntent",
  "title",
  "year",
  "format",
  "runtime",
  "vibe",
  "contentCategory",
  "emotionalEffect",
  "confidence",
  "oneLine",
  "whyItFits",
  "whereToWatch",
] as const;

const CORE_RECOMMENDATION_ITEM_SCHEMA = {
  ...RECOMMENDATION_ITEM_SCHEMA,
  properties: Object.fromEntries(
    CORE_RECOMMENDATION_KEYS.map((key) => [key, RECOMMENDATION_ITEM_SCHEMA.properties[key]]),
  ),
  required: [...CORE_RECOMMENDATION_KEYS],
};

function recommendationBatchSchema(count: number, includeDiscovery = true) {
  return {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: includeDiscovery ? RECOMMENDATION_ITEM_SCHEMA : CORE_RECOMMENDATION_ITEM_SCHEMA,
      },
    },
    required: ["recommendations"],
    additionalProperties: false,
  };
}

export async function recommendWithOpenAI(
  prompt: string,
  temperature = 0.85,
  count = 3,
  includeDiscovery = true,
  timeoutMs = FALLBACK_LLM_TIMEOUT_MS,
  telemetry?: LlmTelemetryOptions,
): Promise<RawRecommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  let lastError: unknown;
  const started = Date.now();
  const models = uniqueValues([process.env.OPENAI_MODEL, "gpt-4o-mini"]);
  for (const model of models) {
    const remainingMs = timeoutMs - (Date.now() - started);
    if (remainingMs < 1000) break;
    const attemptStarted = Date.now();
    const maxOutputTokens = outputTokenBudget(count, includeDiscovery);
    const promptCacheKey = includeDiscovery ? "fun-recommend-full-v1" : "fun-recommend-core-v1";
    try {
      const response = await withTimeout(
        (signal) => fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: prompt,
            prompt_cache_key: promptCacheKey,
            temperature,
            max_output_tokens: maxOutputTokens,
            text: {
              format: {
                type: "json_schema",
                name: "fun_recommendations",
                schema: recommendationBatchSchema(count, includeDiscovery),
                strict: true,
              },
            },
          }),
          signal,
        }),
        remainingMs,
        `OpenAI ${model}`,
      );

      if (!response.ok) throw await openAIHttpError(response, model);
      const data = (await response.json()) as OpenAIResponse;
      logOpenAICacheUsage(`recommend:${model}`, data);
      const responseError = openAIResponseError(data, response.headers.get("x-request-id"));
      if (responseError) throw responseError;
      const text = openAIText(data);
      if (!text) {
        throw new Error(
          `OpenAI ${model} completed without output text${data.id ? ` (response=${data.id})` : ""}`,
        );
      }
      const parsed = parseRecommendationJson(text);
      emitOpenAITelemetry(telemetry, {
        purpose: "recommendation",
        model,
        ok: true,
        durationMs: Date.now() - attemptStarted,
        requestId: response.headers.get("x-request-id") ?? undefined,
        responseId: data.id,
        status: data.status,
        inputTokens: data.usage?.input_tokens,
        cachedInputTokens: data.usage?.input_tokens_details?.cached_tokens,
        outputTokens: data.usage?.output_tokens,
        totalTokens: data.usage?.total_tokens,
        temperature,
        maxOutputTokens,
        promptCacheKey,
        requestedCount: count,
        includeDiscovery,
        promptChars: prompt.length,
        prompt: telemetry?.captureContent ? prompt : undefined,
        responseText: telemetry?.captureContent ? text : undefined,
      });
      return parsed;
    } catch (error) {
      lastError = error;
      emitOpenAITelemetry(telemetry, {
        purpose: "recommendation",
        model,
        ok: false,
        durationMs: Date.now() - attemptStarted,
        temperature,
        maxOutputTokens,
        promptCacheKey,
        requestedCount: count,
        includeDiscovery,
        promptChars: prompt.length,
        prompt: telemetry?.captureContent ? prompt : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn(`OpenAI ${model} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  throw lastError ?? new Error("OpenAI recommendation failed.");
}

export async function interpretIntentWithOpenAI(
  prompt: string,
  telemetry?: LlmTelemetryOptions,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  let lastError: unknown;
  const started = Date.now();
  for (const model of uniqueValues([process.env.OPENAI_MODEL, "gpt-4o-mini"])) {
    const remainingMs = INTENT_TIMEOUT_MS - (Date.now() - started);
    if (remainingMs < 500) break;
    const attemptStarted = Date.now();
    const promptCacheKey = "fun-intent-v1";
    try {
      const response = await withTimeout(
        (signal) => fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: prompt,
            prompt_cache_key: promptCacheKey,
            temperature: 0.1,
            max_output_tokens: INTENT_MAX_OUTPUT_TOKENS,
          }),
          signal,
        }),
        remainingMs,
        `OpenAI intent ${model}`,
      );

      if (!response.ok) throw await openAIHttpError(response, `intent ${model}`);
      const data = (await response.json()) as OpenAIResponse;
      logOpenAICacheUsage(`intent:${model}`, data);
      const responseError = openAIResponseError(data, response.headers.get("x-request-id"));
      if (responseError) throw responseError;
      const text = openAIText(data);
      if (!text) {
        throw new Error(
          `OpenAI intent ${model} completed without output text${data.id ? ` (response=${data.id})` : ""}`,
        );
      }
      const parsed = parseJsonObject(text);
      emitOpenAITelemetry(telemetry, {
        purpose: "intent",
        model,
        ok: true,
        durationMs: Date.now() - attemptStarted,
        requestId: response.headers.get("x-request-id") ?? undefined,
        responseId: data.id,
        status: data.status,
        inputTokens: data.usage?.input_tokens,
        cachedInputTokens: data.usage?.input_tokens_details?.cached_tokens,
        outputTokens: data.usage?.output_tokens,
        totalTokens: data.usage?.total_tokens,
        temperature: 0.1,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        promptCacheKey,
        promptChars: prompt.length,
        prompt: telemetry?.captureContent ? prompt : undefined,
        responseText: telemetry?.captureContent ? text : undefined,
      });
      return parsed;
    } catch (error) {
      lastError = error;
      emitOpenAITelemetry(telemetry, {
        purpose: "intent",
        model,
        ok: false,
        durationMs: Date.now() - attemptStarted,
        temperature: 0.1,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        promptCacheKey,
        promptChars: prompt.length,
        prompt: telemetry?.captureContent ? prompt : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn(`OpenAI intent ${model} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  throw lastError ?? new Error("OpenAI intent interpretation failed.");
}
