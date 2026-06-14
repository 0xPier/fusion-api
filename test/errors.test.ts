import { describe, expect, it } from "vitest";
import { FusionError, toErrorResponse } from "../src/errors.js";

describe("FusionError", () => {
  it("maps types to default statuses", () => {
    expect(FusionError.validation("bad").status).toBe(400);
    expect(
      FusionError.costCap("over", {
        estimated_usd: 1,
        cap_usd: 0.5,
        spent_usd: 0,
        stage: "preflight",
      }).status,
    ).toBe(402);
    expect(FusionError.allModelsFailed("none").status).toBe(502);
    expect(FusionError.notFound("nope").status).toBe(404);
  });

  it("produces an OpenAI-shaped envelope", () => {
    const env = FusionError.validation("bad model", { model: "x" }).toEnvelope();
    expect(env.error.type).toBe("invalid_request_error");
    expect(env.error.code).toBe("invalid_request");
    expect(env.error.details).toEqual({ model: "x" });
  });

  it("coerces unknown throwables into an internal_error envelope", () => {
    const { status, body } = toErrorResponse(new Error("boom"));
    expect(status).toBe(500);
    expect(body.error.type).toBe("internal_error");
    expect(body.error.message).toBe("boom");
  });
});
