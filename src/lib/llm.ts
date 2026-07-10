import { RawRecommendation } from "@/lib/types";
import { extractJson, uniqueValues, withTimeout } from "@/lib/recommendation-utils";

const LLM_TIMEOUT_MS = 25000;

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
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    LLM_TIMEOUT_MS,
    `Generic LLM (${model})`,
  );

  if (!response.ok) throw new Error(`Generic LLM (${model}) failed with ${response.status}`);
  const data = (await response.json()) as ChatCompletionsResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseRecommendationJson(text);
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
        max_tokens: 4000,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    LLM_TIMEOUT_MS,
    "Anthropic",
  );

  if (!response.ok) throw new Error(`Anthropic failed with ${response.status}`);
  const data = (await response.json()) as AnthropicResponse;
  const text = data.content?.map((block) => block.text).join("\n") ?? "";
  return parseRecommendationJson(text);
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
          }),
        }),
        LLM_TIMEOUT_MS,
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
