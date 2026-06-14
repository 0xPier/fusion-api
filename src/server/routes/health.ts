import type { Context } from "hono";
import { VIRTUAL_FUSION_MODELS } from "../../fusion/types.js";
import type { RouteDeps } from "../types.js";

/** GET /health — server status + per-provider availability. */
export function createHealthHandler(deps: RouteDeps) {
  return async (c: Context): Promise<Response> => {
    const providers = await deps.registry.health();
    const available = Object.values(providers).filter((h) => h.ok).length;
    return c.json({
      status: "ok",
      uptime_s: Math.floor(process.uptime()),
      providers,
      providers_available: available,
      providers_total: Object.keys(providers).length,
      fusion_models: VIRTUAL_FUSION_MODELS,
      default_preset: deps.config.fusion.defaultPreset,
    });
  };
}
