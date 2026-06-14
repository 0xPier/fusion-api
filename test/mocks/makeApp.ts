import type { Hono } from "hono";
import type { Clock } from "../../src/clock.js";
import { type AppConfig, buildAppConfig } from "../../src/config/config.js";
import { parseEnv } from "../../src/config/env.js";
import { silentLogger } from "../../src/observability/logger.js";
import type { ProviderRegistry } from "../../src/providers/base.js";
import { createApp } from "../../src/server/app.js";
import type { AppEnv } from "../../src/server/types.js";

const FIXED_CLOCK: Clock = () => 1_700_000_000_000;

export function testConfig(fusion?: Partial<AppConfig["fusion"]>): AppConfig {
  const cfg = buildAppConfig(parseEnv({}), null);
  if (fusion) cfg.fusion = { ...cfg.fusion, ...fusion };
  return cfg;
}

export function makeApp(
  registry: ProviderRegistry,
  config: AppConfig = testConfig(),
  clock: Clock = FIXED_CLOCK,
): Hono<AppEnv> {
  return createApp({ registry, config, logger: silentLogger, clock });
}

/** POST a JSON body to an app route and parse the JSON response. */
export async function postJson(
  app: Hono<AppEnv>,
  path: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
