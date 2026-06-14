import { describe, expect, it } from "vitest";
import {
  deterministicRepair,
  extractFirstJsonObject,
  normalizeSmartQuotes,
  removeTrailingCommas,
  stripCodeFences,
} from "../src/fusion/jsonRepair.js";

describe("jsonRepair transforms", () => {
  it("extracts the first balanced object, ignoring braces in strings", () => {
    expect(extractFirstJsonObject('noise {"a": 1} tail')).toBe('{"a": 1}');
    expect(extractFirstJsonObject('{"a": "has } brace", "b": {"c": 2}}')).toBe(
      '{"a": "has } brace", "b": {"c": 2}}',
    );
    expect(extractFirstJsonObject("no object here")).toBeNull();
  });

  it("removes trailing commas", () => {
    expect(removeTrailingCommas('{"a": 1,}')).toBe('{"a": 1}');
    expect(removeTrailingCommas("[1, 2, 3,]")).toBe("[1, 2, 3]");
  });

  it("normalizes smart quotes", () => {
    expect(normalizeSmartQuotes("“hi”")).toBe('"hi"');
  });

  it("strips code fences", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe("deterministicRepair", () => {
  it("repairs fenced JSON with a trailing comma", () => {
    const out = deterministicRepair('```json\n{"consensus": ["x"],}\n```') as {
      consensus: string[];
    };
    expect(out.consensus).toEqual(["x"]);
  });

  it("repairs JSON embedded in prose", () => {
    const out = deterministicRepair('Here is the analysis: {"score": 7} — hope that helps!') as {
      score: number;
    };
    expect(out.score).toBe(7);
  });

  it("returns null for unrepairable garbage", () => {
    expect(deterministicRepair("absolutely not json at all")).toBeNull();
  });
});
