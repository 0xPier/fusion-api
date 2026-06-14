import type { Context } from "hono";
import { VIRTUAL_FUSION_MODELS } from "../../fusion/types.js";
import type { RouteDeps } from "../types.js";

/** GET /v1/models — configured models + the 5 virtual fusion/* ids. */
export function createModelsHandler(deps: RouteDeps) {
  return async (c: Context): Promise<Response> => {
    const created = Math.floor(deps.clock() / 1000);
    const configured = await deps.registry.listModels();

    const virtual = VIRTUAL_FUSION_MODELS.map((id) => ({
      id,
      object: "model",
      created,
      owned_by: "fusion",
      type: "fusion",
    }));
    const named = configured.map((m) => ({
      id: m.id,
      object: "model",
      created,
      owned_by: m.provider,
      type: "model",
    }));
    const providers = deps.registry.list().map((p) => ({
      id: p.id,
      object: "model",
      created,
      owned_by: p.id,
      type: p.type,
    }));

    return c.json({ object: "list", data: [...virtual, ...named, ...providers] });
  };
}
