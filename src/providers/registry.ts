import type { AppConfig } from "../config/config.js";
import { FusionError } from "../errors.js";
import { AnthropicProvider } from "./anthropic.js";
import type {
  HealthStatus,
  ModelRef,
  Provider,
  ProviderModel,
  ProviderRegistry,
  ResolvedModel,
} from "./base.js";
import { GeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { createOpenRouterProvider } from "./openrouter.js";

const MODEL_ID_RE = /^[A-Za-z0-9._/:\-]{1,200}$/;

export interface RegistryOptions {
  providers: Map<string, Provider>;
  namedModels: Map<string, ModelRef>;
  allow: string[];
  deny: string[];
  /** API keys by provider id, for ephemeral base_url overrides. */
  secrets: Record<string, string | undefined>;
}

export class Registry implements ProviderRegistry {
  private readonly providers: Map<string, Provider>;
  private readonly namedModels: Map<string, ModelRef>;
  private readonly allow: Set<string>;
  private readonly deny: Set<string>;
  private readonly secrets: Record<string, string | undefined>;

  constructor(opts: RegistryOptions) {
    this.providers = opts.providers;
    this.namedModels = opts.namedModels;
    this.allow = new Set(opts.allow);
    this.deny = new Set(opts.deny);
    this.secrets = opts.secrets;
  }

  get(providerId: string): Provider | undefined {
    return this.providers.get(providerId);
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }

  resolve(ref: ModelRef): ResolvedModel {
    let providerId = ref.provider;
    let model = ref.model;
    let baseUrl = ref.base_url;

    // Expand a named model id from config into its concrete provider/model.
    const named = this.namedModels.get(providerId);
    if (named) {
      providerId = named.provider;
      model = named.model;
      baseUrl = baseUrl ?? named.base_url;
    }

    if (!MODEL_ID_RE.test(model)) {
      throw FusionError.validation(`invalid model id: ${JSON.stringify(model)}`, { model });
    }

    this.assertAllowed(providerId);

    if (baseUrl) {
      assertValidBaseUrl(baseUrl);
      return { provider: this.buildEphemeral(providerId, baseUrl), model };
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw FusionError.validation(
        `unknown or unconfigured provider '${providerId}'. Configure its API key/base URL, or pass a base_url.`,
        { provider: providerId },
      );
    }
    return { provider, model };
  }

  private assertAllowed(providerId: string): void {
    if (this.deny.has(providerId)) {
      throw FusionError.validation(`provider '${providerId}' is denied by config`, {
        provider: providerId,
      });
    }
    if (this.allow.size > 0 && !this.allow.has(providerId)) {
      throw FusionError.validation(`provider '${providerId}' is not in the allow-list`, {
        provider: providerId,
      });
    }
  }

  private buildEphemeral(providerId: string, baseUrl: string): Provider {
    if (providerId === "anthropic")
      return new AnthropicProvider(this.secrets.anthropic ?? "", baseUrl);
    if (providerId === "gemini") return new GeminiProvider(this.secrets.gemini ?? "", baseUrl);
    return new OpenAICompatibleProvider({
      id: providerId,
      name: providerId,
      type: isLocalUrl(baseUrl) ? "local" : "cloud",
      baseUrl,
      apiKey: this.secrets[providerId],
    });
  }

  async listModels(): Promise<ProviderModel[]> {
    // Fast + network-free: the models declared in config. Virtual fusion/* ids
    // are added by the /v1/models route. Live provider discovery is opt-in.
    const out: ProviderModel[] = [];
    for (const [id, ref] of this.namedModels) {
      out.push({ id, provider: ref.provider });
    }
    return out;
  }

  async health(): Promise<Record<string, HealthStatus>> {
    const entries = await Promise.all(
      [...this.providers.entries()].map(async ([id, p]) => {
        try {
          return [id, await p.healthCheck()] as const;
        } catch (err) {
          return [id, { ok: false, detail: (err as Error).message }] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}

function assertValidBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw FusionError.validation(`invalid base_url: ${JSON.stringify(url)}`, { base_url: url });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw FusionError.validation(`base_url must be http(s): ${JSON.stringify(url)}`, {
      base_url: url,
    });
  }
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

/** Build the production registry from an AppConfig. */
export function buildRegistry(cfg: AppConfig): Registry {
  const providers = new Map<string, Provider>();

  if (cfg.secrets.openai)
    providers.set("openai", createOpenAIProvider(cfg.secrets.openai, cfg.baseUrls.openai));
  if (cfg.secrets.openrouter)
    providers.set(
      "openrouter",
      createOpenRouterProvider(cfg.secrets.openrouter, cfg.baseUrls.openrouter),
    );
  if (cfg.secrets.anthropic)
    providers.set(
      "anthropic",
      new AnthropicProvider(cfg.secrets.anthropic, cfg.baseUrls.anthropic),
    );
  if (cfg.secrets.gemini)
    providers.set("gemini", new GeminiProvider(cfg.secrets.gemini, cfg.baseUrls.gemini));

  // Local OpenAI-compatible servers are always registered (no key required).
  providers.set(
    "ollama",
    new OpenAICompatibleProvider({
      id: "ollama",
      name: "Ollama",
      type: "local",
      baseUrl: cfg.baseUrls.ollama,
    }),
  );
  providers.set(
    "lmstudio",
    new OpenAICompatibleProvider({
      id: "lmstudio",
      name: "LM Studio",
      type: "local",
      baseUrl: cfg.baseUrls.lmstudio,
    }),
  );
  providers.set(
    "llamacpp",
    new OpenAICompatibleProvider({
      id: "llamacpp",
      name: "llama.cpp",
      type: "local",
      baseUrl: cfg.baseUrls.llamacpp,
    }),
  );

  const namedModels = new Map<string, ModelRef>();
  for (const m of cfg.models) {
    namedModels.set(m.id, { provider: m.provider, model: m.model, base_url: m.base_url });
  }

  return new Registry({
    providers,
    namedModels,
    allow: cfg.providers.allow,
    deny: cfg.providers.deny,
    secrets: cfg.secrets,
  });
}
