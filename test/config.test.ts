import { describe, expect, it } from "vitest";
import { buildAppConfig, safeConfigDump } from "../src/config/config.js";
import { parseEnv, secretPresence } from "../src/config/env.js";
import type { ConfigFile } from "../src/config/schema.js";

describe("env parsing", () => {
  it("coerces numbers and validates enums", () => {
    const env = parseEnv({
      OPENAI_API_KEY: "sk-1",
      FUSION_DEFAULT_PRESET: "budget",
      FUSION_MAX_PANEL_MODELS: "5",
      FUSION_TIMEOUT_MS: "60000",
      PORT: "8080",
    });
    expect(env.OPENAI_API_KEY).toBe("sk-1");
    expect(env.FUSION_DEFAULT_PRESET).toBe("budget");
    expect(env.FUSION_MAX_PANEL_MODELS).toBe(5);
    expect(env.PORT).toBe(8080);
  });

  it("rejects an invalid preset", () => {
    expect(() => parseEnv({ FUSION_DEFAULT_PRESET: "ultra" })).toThrow();
  });

  it("treats blank strings as undefined", () => {
    const env = parseEnv({ OPENAI_API_KEY: "   " });
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("reports secret presence without values", () => {
    const env = parseEnv({ OPENAI_API_KEY: "sk-1", ANTHROPIC_API_KEY: "ak-1" });
    expect(secretPresence(env)).toEqual({
      openai: true,
      openrouter: false,
      anthropic: true,
      gemini: false,
    });
  });
});

describe("buildAppConfig precedence (env > file > default)", () => {
  it("uses defaults when nothing is set", () => {
    const cfg = buildAppConfig(parseEnv({}), null);
    expect(cfg.port).toBe(3000);
    expect(cfg.fusion.defaultPreset).toBe("quality");
    expect(cfg.fusion.maxPanelModels).toBe(8);
    expect(cfg.fusion.maxUsdPerRequest).toBeNull();
    expect(cfg.baseUrls.ollama).toBe("http://localhost:11434/v1");
  });

  it("file overrides defaults, env overrides file", () => {
    const file: ConfigFile = {
      server: { port: 4000 },
      models: [{ id: "m1", provider: "ollama", model: "qwen3" }],
      fusion: {
        default_preset: "budget",
        max_panel_models: 3,
        timeout_ms: 9000,
        max_usd_per_request: 0.5,
      },
    };
    const envOnlyFile = buildAppConfig(parseEnv({}), file);
    expect(envOnlyFile.port).toBe(4000);
    expect(envOnlyFile.fusion.defaultPreset).toBe("budget");
    expect(envOnlyFile.models).toHaveLength(1);

    const envWins = buildAppConfig(
      parseEnv({ PORT: "5000", FUSION_DEFAULT_PRESET: "quality" }),
      file,
    );
    expect(envWins.port).toBe(5000);
    expect(envWins.fusion.defaultPreset).toBe("quality");
    expect(envWins.fusion.maxPanelModels).toBe(3); // still from file
  });
});

describe("safeConfigDump", () => {
  it("never exposes secret values", () => {
    const cfg = buildAppConfig(
      parseEnv({ OPENAI_API_KEY: "sk-supersecret", GEMINI_API_KEY: "gk-secret" }),
      null,
    );
    const dump = JSON.stringify(safeConfigDump(cfg));
    expect(dump).not.toContain("sk-supersecret");
    expect(dump).not.toContain("gk-secret");
    expect(dump).toContain("[set]");
    expect(dump).toContain("[unset]");
  });
});
