import { serve } from "@hono/node-server";
import { buildAppConfig, loadConfigFile, safeConfigDump } from "./config/config.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./observability/logger.js";
import { buildRegistry } from "./providers/registry.js";
import { createApp } from "./server/app.js";

function main(): void {
  const env = loadEnv();
  const file = loadConfigFile(env.CONFIG_PATH);
  const config = buildAppConfig(env, file);
  const logger = createLogger({ level: config.logLevel });

  const registry = buildRegistry(config);
  const app = createApp({ registry, config, logger });

  // Redacted startup dump (guardrail G2: no secret values).
  logger.info("fusion-api starting", { config: safeConfigDump(config) });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("fusion-api listening", {
      port: info.port,
      endpoints: [
        "GET  /health",
        "GET  /v1/models",
        "POST /v1/chat/completions",
        "POST /v1/fusion/completions",
        "GET  /v1/fusion/presets",
        "POST /v1/fusion/estimate-cost",
      ],
    });
  });
}

main();
