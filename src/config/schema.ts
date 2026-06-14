import { z } from "zod";

// ── Request schemas (OpenAI-compatible + fusion extension) ──

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z
    .union([z.string(), z.null()])
    .transform((c) => c ?? "")
    // v1 supports string content only; reject array/multimodal content clearly.
    .pipe(z.string()),
  name: z.string().optional(),
});

export const ModelEndpointSpecSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  base_url: z.string().url().optional(),
});

export const PanelModelSpecSchema = z.object({
  id: z.string().min(1).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  base_url: z.string().url().optional(),
});

export const FusionOptionsSchema = z.object({
  mode: z.enum(["auto", "forced", "off"]).default("auto"),
  preset: z.enum(["quality", "budget", "local-heavy", "cloud-heavy", "custom"]).optional(),
  analysis_models: z.array(PanelModelSpecSchema).min(1).max(8).optional(),
  judge: ModelEndpointSpecSchema.optional(),
  synthesizer: ModelEndpointSpecSchema.optional(),
  max_panel_models: z.number().int().min(1).max(8).optional(),
  timeout_ms: z.number().int().positive().optional(),
  web: z.object({ enabled: z.boolean() }).optional(),
  cost: z
    .object({
      track: z.boolean().default(true),
      max_usd_per_request: z.number().positive().nullable().default(null),
    })
    .optional(),
});

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().positive().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    stream: z.boolean().optional(),
    fusion: FusionOptionsSchema.optional(),
  })
  .passthrough();

export type ChatCompletionRequestInput = z.infer<typeof ChatCompletionRequestSchema>;

export const EstimateCostRequestSchema = z
  .object({
    model: z.string().min(1).default("fusion/quality"),
    messages: z.array(ChatMessageSchema).min(1),
    fusion: FusionOptionsSchema.optional(),
  })
  .passthrough();

// ── Config-file schema (YAML/JSON) ──

const ConfigModelSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  base_url: z.string().url().optional(),
});

const PresetOverrideSchema = z.object({
  analysis_models: z.array(z.union([z.string(), PanelModelSpecSchema])).optional(),
  judge: ModelEndpointSpecSchema.optional(),
  synthesizer: ModelEndpointSpecSchema.optional(),
});

export const ConfigFileSchema = z.object({
  server: z.object({ port: z.number().int().positive().optional() }).optional(),
  providers: z
    .object({
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .optional(),
  models: z.array(ConfigModelSchema).default([]),
  presets: z.record(z.string(), PresetOverrideSchema).optional(),
  fusion: z
    .object({
      default_preset: z
        .enum(["quality", "budget", "local-heavy", "cloud-heavy", "custom"])
        .optional(),
      max_panel_models: z.number().int().min(1).max(8).optional(),
      timeout_ms: z.number().int().positive().optional(),
      max_usd_per_request: z.number().positive().nullable().optional(),
    })
    .optional(),
});

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// ── Env schema ──

const optionalString = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() !== "" ? s.trim() : undefined));

export const EnvSchema = z.object({
  OPENAI_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  OLLAMA_BASE_URL: optionalString,
  LMSTUDIO_BASE_URL: optionalString,
  LLAMACPP_BASE_URL: optionalString,
  FUSION_DEFAULT_PRESET: z
    .enum(["quality", "budget", "local-heavy", "cloud-heavy", "custom"])
    .optional(),
  FUSION_MAX_PANEL_MODELS: z.coerce.number().int().min(1).max(8).optional(),
  FUSION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  FUSION_MAX_USD_PER_REQUEST: z.coerce.number().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  CONFIG_PATH: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export type Env = z.infer<typeof EnvSchema>;
