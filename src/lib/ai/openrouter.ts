import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  headers: {
    "HTTP-Referer": "https://tayf.app",
    "X-Title": "Tayf - Türkiye Haber Analizi",
  },
});

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

export function getModel() {
  const modelId = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return openrouter(modelId);
}

export async function chatCompletion(
  prompt: string,
  options?: {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    system?: string;
  }
): Promise<string> {
  const model = options?.model
    ? openrouter(options.model)
    : getModel();

  const { text } = await generateText({
    model,
    prompt,
    system: options?.system,
    temperature: options?.temperature ?? 0.3,
    maxOutputTokens: options?.maxOutputTokens ?? 4096,
  });

  return text;
}
