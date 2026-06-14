import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter cloud provider. OpenRouter is OpenAI-compatible, so this is the
 * shared adapter plus the optional attribution headers OpenRouter recommends.
 */
export function createOpenRouterProvider(
  apiKey: string,
  baseUrl = OPENROUTER_DEFAULT_BASE_URL,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "openrouter",
    name: "OpenRouter",
    type: "cloud",
    baseUrl,
    apiKey,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/fusion-api",
      "X-Title": "Fusion API",
    },
  });
}
