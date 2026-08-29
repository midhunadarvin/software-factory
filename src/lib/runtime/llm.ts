import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText, type LanguageModel } from "ai";
import { llmApiKey, llmBaseUrl, llmConfigured, llmModel } from "../env";

export function getModel(): LanguageModel | null {
  const key = llmApiKey();
  if (!key) return null;
  const openai = createOpenAI({ apiKey: key, baseURL: llmBaseUrl() });
  return openai(llmModel());
}

export { generateObject, generateText, llmConfigured };
