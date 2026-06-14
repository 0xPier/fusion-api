/**
 * One error envelope for the whole server (guardrail: clients switch on a
 * stable `type`/`code`). The envelope is OpenAI-shaped (`{ error: { ... } }`)
 * with extra `code`/`details` fields, so stock OpenAI SDKs still parse it.
 */

export type ErrorType =
  | "invalid_request_error"
  | "stream_not_supported"
  | "cost_cap_exceeded"
  | "all_models_failed"
  | "provider_error"
  | "not_found"
  | "internal_error";

export interface ErrorEnvelope {
  error: {
    message: string;
    type: ErrorType;
    code: string;
    details?: Record<string, unknown>;
  };
}

const DEFAULT_STATUS: Record<ErrorType, number> = {
  invalid_request_error: 400,
  stream_not_supported: 400,
  cost_cap_exceeded: 402,
  all_models_failed: 502,
  provider_error: 502,
  not_found: 404,
  internal_error: 500,
};

export class FusionError extends Error {
  readonly type: ErrorType;
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    type: ErrorType,
    message: string,
    opts: { code?: string; status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "FusionError";
    this.type = type;
    this.code = opts.code ?? type;
    this.status = opts.status ?? DEFAULT_STATUS[type];
    this.details = opts.details;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  // ── Factories for the common cases (used across routes + pipeline) ──

  static validation(message: string, details?: Record<string, unknown>): FusionError {
    return new FusionError("invalid_request_error", message, { code: "invalid_request", details });
  }

  static notFound(message: string, details?: Record<string, unknown>): FusionError {
    return new FusionError("not_found", message, { code: "not_found", details });
  }

  static streamNotSupported(message: string): FusionError {
    return new FusionError("stream_not_supported", message, { code: "stream_not_supported" });
  }

  static costCap(
    message: string,
    details: { estimated_usd: number; cap_usd: number; spent_usd: number; stage: string },
  ): FusionError {
    return new FusionError("cost_cap_exceeded", message, { code: "fusion_cost_cap", details });
  }

  static allModelsFailed(message: string, details?: Record<string, unknown>): FusionError {
    return new FusionError("all_models_failed", message, { code: "all_models_failed", details });
  }

  static provider(message: string, details?: Record<string, unknown>): FusionError {
    return new FusionError("provider_error", message, { code: "provider_error", details });
  }
}

/** Coerce any thrown value into an envelope + status for the error middleware. */
export function toErrorResponse(err: unknown): { status: number; body: ErrorEnvelope } {
  if (err instanceof FusionError) {
    return { status: err.status, body: err.toEnvelope() };
  }
  const message = err instanceof Error ? err.message : String(err);
  const fe = new FusionError("internal_error", message, { code: "internal_error" });
  return { status: fe.status, body: fe.toEnvelope() };
}
