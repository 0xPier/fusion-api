import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../src/observability/logger.js";

describe("logger secret redaction (G2)", () => {
  it("never emits secret values", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "info", sink: (l) => lines.push(l) });
    log.info("startup", {
      OPENAI_API_KEY: "sk-supersecret",
      authorization: "Bearer sk-xyz",
      base_url: "https://user:p4ss@host.example/v1",
      note: "this is fine",
    });
    const out = lines.join("\n");
    expect(out).not.toContain("sk-supersecret");
    expect(out).not.toContain("sk-xyz");
    expect(out).not.toContain("user:p4ss");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("this is fine");
  });

  it("scrubs nested objects and arrays", () => {
    const cleaned = JSON.stringify(
      redact({ providers: [{ api_key: "secret1" }], url: "https://a:b@h/v1" }),
    );
    expect(cleaned).not.toContain("secret1");
    expect(cleaned).not.toContain("a:b@");
  });
});
