import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** OpenAI cloud provider — a thin config preset over the shared adapter. */
export function createOpenAIProvider(
  apiKey: string,
  baseUrl = OPENAI_DEFAULT_BASE_URL,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "openai",
    name: "OpenAI",
    type: "cloud",
    baseUrl,
    apiKey,
  });
}
