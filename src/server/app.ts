import { Hono } from "hono";
import { type Clock, systemClock } from "../clock.js";
import type { AppConfig } from "../config/config.js";
import { FusionRouter } from "../fusion/router.js";
import { type Logger, createLogger } from "../observability/logger.js";
import type { ProviderRegistry } from "../providers/base.js";
import { createErrorHandler } from "./middleware/errorHandler.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { createChatHandler } from "./routes/chat.js";
import {
  createEstimateCostHandler,
  createFusionCompletionsHandler,
  createPresetsHandler,
} from "./routes/fusion.js";
import { createHealthHandler } from "./routes/health.js";
import { createModelsHandler } from "./routes/models.js";
import type { AppEnv, RouteDeps } from "./types.js";

export interface AppDeps {
  registry: ProviderRegistry;
  config: AppConfig;
  logger?: Logger;
  clock?: Clock;
}

/**
 * Build the Hono app over INJECTED dependencies (closure DI — not c.env).
 * Tests call this with a mock registry; nothing here touches the network.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const logger = deps.logger ?? createLogger({ level: deps.config.logLevel });
  const clock = deps.clock ?? systemClock;
  const router = new FusionRouter({ registry: deps.registry, config: deps.config, logger, clock });

  const routeDeps: RouteDeps = {
    registry: deps.registry,
    config: deps.config,
    logger,
    router,
    clock,
  };

  const app = new Hono<AppEnv>();
  app.use("*", requestIdMiddleware);
  app.onError(createErrorHandler(logger));

  app.get("/health", createHealthHandler(routeDeps));
  app.get("/v1/models", createModelsHandler(routeDeps));
  app.post("/v1/chat/completions", createChatHandler(routeDeps));
  app.post("/v1/fusion/completions", createFusionCompletionsHandler(routeDeps));
  app.get("/v1/fusion/presets", createPresetsHandler(routeDeps));
  app.post("/v1/fusion/estimate-cost", createEstimateCostHandler(routeDeps));

  app.notFound((c) =>
    c.json(
      {
        error: {
          message: `not found: ${c.req.method} ${c.req.path}`,
          type: "not_found",
          code: "not_found",
        },
      },
      404,
    ),
  );

  return app;
}
