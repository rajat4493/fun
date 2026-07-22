import { RawRecommendation } from "@/lib/types";
import { extractJson, uniqueValues, withTimeout } from "@/lib/recommendation-utils";

const ANTHROPIC_TIMEOUT_MS = 25000;
const FALLBACK_LLM_TIMEOUT_MS = 15000;
const LLM_MAX_OUTPUT_TOKENS = 3000;
const INTENT_TIMEOUT_MS = 6000;
const INTENT_MAX_OUTPUT_TOKENS = 700;

type AnthropicTextBlock = {
  type: "text";
  text: string;
};

type AnthropicResponse = {
  content?: AnthropicTextBlock[];
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

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
  if (Array.isArray(parsed)) return parsed as RawRecommendation[];
  if (parsed && typeof parsed === "object") {
    const wrapped = Object.values(parsed).find(Array.isArray);
    if (wrapped) return wrapped as RawRecommendation[];
  }
  return [parsed as RawRecommendation];
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

// Generic OpenAI-compatible provider — reads LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
// Set these to use Groq, Mistral, Together AI, Ollama, Fireworks, Perplexity, Gemini, etc.
export async function recommendWithGenericLLM(prompt: string, temperature = 0.85): Promise<RawRecommendation[]> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error("Missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    FALLBACK_LLM_TIMEOUT_MS,
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
    fetch(url, {
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
    }),
    INTENT_TIMEOUT_MS,
    `Generic intent LLM (${model})`,
  );

  if (!response.ok) throw new Error(`Generic intent LLM (${model}) failed with ${response.status}`);
  const data = (await response.json()) as ChatCompletionsResponse;
  return parseJsonObject(data.choices?.[0]?.message?.content ?? "");
}

export async function recommendWithAnthropic(prompt: string, temperature = 0.85): Promise<RawRecommendation[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const response = await withTimeout(
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    ANTHROPIC_TIMEOUT_MS,
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
    fetch("https://api.anthropic.com/v1/messages", {
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

export async function recommendWithOpenAI(prompt: string, temperature = 0.85): Promise<RawRecommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  let lastError: unknown;
  for (const model of uniqueValues([process.env.OPENAI_MODEL, "gpt-4o-mini"])) {
    try {
      const response = await withTimeout(
        fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: prompt,
            temperature,
            max_output_tokens: LLM_MAX_OUTPUT_TOKENS,
          }),
        }),
        FALLBACK_LLM_TIMEOUT_MS,
        `OpenAI ${model}`,
      );

      if (!response.ok) throw new Error(`OpenAI ${model} failed with ${response.status}`);
      const data = (await response.json()) as OpenAIResponse;
      return parseRecommendationJson(openAIText(data));
    } catch (error) {
      lastError = error;
      console.warn(`OpenAI ${model} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  throw lastError ?? new Error("OpenAI recommendation failed.");
}

export async function interpretIntentWithOpenAI(prompt: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  let lastError: unknown;
  for (const model of uniqueValues([process.env.OPENAI_MODEL, "gpt-4o-mini"])) {
    try {
      const response = await withTimeout(
        fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: prompt,
            temperature: 0.1,
            max_output_tokens: INTENT_MAX_OUTPUT_TOKENS,
          }),
        }),
        INTENT_TIMEOUT_MS,
        `OpenAI intent ${model}`,
      );

      if (!response.ok) throw new Error(`OpenAI intent ${model} failed with ${response.status}`);
      const data = (await response.json()) as OpenAIResponse;
      return parseJsonObject(openAIText(data));
    } catch (error) {
      lastError = error;
      console.warn(`OpenAI intent ${model} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  throw lastError ?? new Error("OpenAI intent interpretation failed.");
}
