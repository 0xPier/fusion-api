import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { PresetName } from "../fusion/types.js";
import type { LogLevel } from "../observability/logger.js";
import { ANTHROPIC_DEFAULT_BASE_URL } from "../providers/anthropic.js";
import { GEMINI_DEFAULT_BASE_URL } from "../providers/gemini.js";
import { OPENAI_DEFAULT_BASE_URL } from "../providers/openai.js";
import { OPENROUTER_DEFAULT_BASE_URL } from "../providers/openrouter.js";
import { type ConfigFile, ConfigFileSchema, type Env } from "./schema.js";

export const LOCAL_DEFAULT_BASE_URLS = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  llamacpp: "http://localhost:8080/v1",
} as const;

export interface ConfigModel {
  id: string;
  provider: string;
  model: string;
  base_url?: string;
}

export interface PresetOverride {
  analysis_models?: Array<
    string | { id?: string; provider: string; model: string; base_url?: string }
  >;
  judge?: { provider: string; model: string; base_url?: string };
  synthesizer?: { provider: string; model: string; base_url?: string };
}

export interface AppConfig {
  port: number;
  logLevel: LogLevel;
  providers: { allow: string[]; deny: string[] };
  models: ConfigModel[];
  presets: Record<string, PresetOverride>;
  fusion: {
    defaultPreset: PresetName;
    maxPanelModels: number;
    timeoutMs: number;
    maxUsdPerRequest: number | null;
  };
  secrets: {
    openai?: string;
    openrouter?: string;
    anthropic?: string;
    gemini?: string;
  };
  baseUrls: {
    ollama: string;
    lmstudio: string;
    llamacpp: string;
    openai: string;
    openrouter: string;
    anthropic: string;
    gemini: string;
  };
}

/** Read + validate a YAML/JSON config file. Returns null if path is unset/missing. */
export function loadConfigFile(path?: string): ConfigFile | null {
  if (!path || !existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const parsed = path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  return ConfigFileSchema.parse(parsed ?? {});
}

/** Merge env + file + defaults into a typed AppConfig. Precedence: env > file > default. */
export function buildAppConfig(env: Env, file: ConfigFile | null): AppConfig {
  return {
    port: env.PORT ?? file?.server?.port ?? 3000,
    logLevel: env.LOG_LEVEL ?? "info",
    providers: {
      allow: file?.providers?.allow ?? [],
      deny: file?.providers?.deny ?? [],
    },
    models: file?.models ?? [],
    presets: (file?.presets ?? {}) as Record<string, PresetOverride>,
    fusion: {
      defaultPreset: env.FUSION_DEFAULT_PRESET ?? file?.fusion?.default_preset ?? "quality",
      maxPanelModels: env.FUSION_MAX_PANEL_MODELS ?? file?.fusion?.max_panel_models ?? 8,
      timeoutMs: env.FUSION_TIMEOUT_MS ?? file?.fusion?.timeout_ms ?? 120_000,
      maxUsdPerRequest: env.FUSION_MAX_USD_PER_REQUEST ?? file?.fusion?.max_usd_per_request ?? null,
    },
    secrets: {
      openai: env.OPENAI_API_KEY,
      openrouter: env.OPENROUTER_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      gemini: env.GEMINI_API_KEY,
    },
    baseUrls: {
      ollama: env.OLLAMA_BASE_URL ?? LOCAL_DEFAULT_BASE_URLS.ollama,
      lmstudio: env.LMSTUDIO_BASE_URL ?? LOCAL_DEFAULT_BASE_URLS.lmstudio,
      llamacpp: env.LLAMACPP_BASE_URL ?? LOCAL_DEFAULT_BASE_URLS.llamacpp,
      openai: OPENAI_DEFAULT_BASE_URL,
      openrouter: OPENROUTER_DEFAULT_BASE_URL,
      anthropic: ANTHROPIC_DEFAULT_BASE_URL,
      gemini: GEMINI_DEFAULT_BASE_URL,
    },
  };
}

/** A redacted view safe to log or return from a debug endpoint (guardrail G2). */
export function safeConfigDump(cfg: AppConfig): Record<string, unknown> {
  return {
    port: cfg.port,
    logLevel: cfg.logLevel,
    providers: cfg.providers,
    models: cfg.models,
    presets: cfg.presets,
    fusion: cfg.fusion,
    secrets: {
      openai: cfg.secrets.openai ? "[set]" : "[unset]",
      openrouter: cfg.secrets.openrouter ? "[set]" : "[unset]",
      anthropic: cfg.secrets.anthropic ? "[set]" : "[unset]",
      gemini: cfg.secrets.gemini ? "[set]" : "[unset]",
    },
    baseUrls: cfg.baseUrls,
  };
}
