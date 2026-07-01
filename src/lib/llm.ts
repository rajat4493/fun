import { RawRecommendation } from "@/lib/types";
import { extractJson, uniqueValues, withTimeout } from "@/lib/recommendation-utils";

const LLM_TIMEOUT_MS = 18000;

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

function parseRecommendationJson(text: string): RawRecommendation[] {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  if (Array.isArray(parsed)) return parsed as RawRecommendation[];
  if (parsed && typeof parsed === "object") {
    const wrapped = Object.values(parsed).find(Array.isArray);
    if (wrapped) return wrapped as RawRecommendation[];
  }
  return [parsed as RawRecommendation];
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
