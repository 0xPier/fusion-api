import type { Context } from "hono";
import { toErrorResponse } from "../../errors.js";
import type { Logger } from "../../observability/logger.js";

/** Map any thrown value to the single error envelope + HTTP status. */
export function createErrorHandler(logger: Logger) {
  return (err: Error, c: Context): Response => {
    const { status, body } = toErrorResponse(err);
    const requestId = c.get("requestId") as string | undefined;
    // 5xx are unexpected; 4xx are client errors. Don't log secrets (redaction
    // happens in the logger, but error messages here never contain keys).
    const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log("request_error", { requestId, status, type: body.error.type, message: body.error.message });
    return c.json(body, status as 400);
  };
}
