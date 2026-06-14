import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

/** Attach/propagate an x-request-id for log correlation. */
export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header("x-request-id") ?? randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};
