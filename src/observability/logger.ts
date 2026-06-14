/**
 * Structured JSON logger with secret redaction (guardrail G2: never log keys).
 * Redaction is defense-in-depth: by key name (api_key, authorization, …) AND by
 * scrubbing credentials/keys embedded in URL strings and `?key=` query params.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const SECRET_KEY_RE = /(api[_-]?key|authorization|secret|token|password|x-goog-api-key)/i;
const URL_CRED_RE = /:\/\/[^/@\s]+:[^/@\s]+@/g;
const QUERY_KEY_RE = /([?&](?:key|api_key|access_token)=)[^&\s]+/gi;

export function redactString(s: string): string {
  return s.replace(URL_CRED_RE, "://[REDACTED]@").replace(QUERY_KEY_RE, "$1[REDACTED]");
}

/** Recursively redact secret-looking keys + scrub URL credentials in strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Sink for emitted lines; defaults to stdout. Tests inject a buffer. */
  sink?: (line: string) => void;
  bindings?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const minRank = LEVEL_RANK[level];
  const sink = opts.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const bindings = opts.bindings ?? {};

  function emit(lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[lvl] < minRank) return;
    const record = {
      level: lvl,
      msg,
      time: new Date().toISOString(),
      ...bindings,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    sink(JSON.stringify(record));
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) =>
      createLogger({ level, sink, bindings: { ...bindings, ...(redact(extra) as object) } }),
  };
}

/** A logger that drops everything — handy default for tests. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
