import { config as loadDotenv } from "dotenv";
import { type Env, EnvSchema } from "./schema.js";

/** Parse an env-like object (pure; tests pass a custom source). */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source);
}

/** Load `.env` (side-effect) then parse process.env. Used by the real bootstrap. */
export function loadEnv(): Env {
  loadDotenv();
  return parseEnv(process.env);
}

/** Which secrets are present, WITHOUT exposing their values (for /health, logs). */
export function secretPresence(env: Env): Record<string, boolean> {
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
  };
}
