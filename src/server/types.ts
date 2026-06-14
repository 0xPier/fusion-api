import type { Clock } from "../clock.js";
import type { AppConfig } from "../config/config.js";
import type { FusionRouter } from "../fusion/router.js";
import type { Logger } from "../observability/logger.js";
import type { ProviderRegistry } from "../providers/base.js";

export type AppEnv = { Variables: { requestId: string } };

export interface RouteDeps {
  registry: ProviderRegistry;
  config: AppConfig;
  logger: Logger;
  router: FusionRouter;
  clock: Clock;
}
