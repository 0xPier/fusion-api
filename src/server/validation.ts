import type { Context } from "hono";
import type { z } from "zod";
import { FusionError } from "../errors.js";

/** Parse the JSON body, mapping a parse failure to a clean 400. */
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw FusionError.validation("request body must be valid JSON");
  }
}

/** Validate against a Zod schema (returns the schema's OUTPUT type, with
 * defaults/transforms applied), mapping issues to a 400 envelope. */
export function validateBody<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw FusionError.validation("invalid request", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
