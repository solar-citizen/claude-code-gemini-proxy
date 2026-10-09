import { expect, test, describe } from "bun:test";
import { extractEffort, mapEffortToThinkingConfig, calculateMaxOutputTokens } from "../../src/gemini/effort";

describe("Effort Translation Module", () => {
  describe("extractEffort", () => {
    test("extracts from top level body", () => {
      const body = {
        messages: [],
        output_config: { effort: "high" }
      };
      expect(extractEffort(body)).toBe("high");
    });

    test("extracts from synthetic system messages (reverse order priority)", () => {
      const body = {
        messages: [
          { role: "user" as const, content: "hi", output_config: { effort: "low" } },
          { role: "system" as const, content: [], output_config: { effort: "medium" } },
          { role: "user" as const, content: "do work" }
        ]
      };
      expect(extractEffort(body)).toBe("medium");
    });
  });

  describe("mapEffortToThinkingConfig", () => {
    test("maps high effort to 8192", () => {
      const config = mapEffortToThinkingConfig("high");
      expect(config).toEqual({ thinkingBudget: 8192 });
    });

    test("returns undefined for unknown or undefined effort", () => {
      expect(mapEffortToThinkingConfig(undefined)).toBeUndefined();
      expect(mapEffortToThinkingConfig("unknown")).toBeUndefined();
    });
  });

  describe("calculateMaxOutputTokens", () => {
    test("sums thinking budget and max tokens with default fallback", () => {
      expect(calculateMaxOutputTokens(undefined, 8192)).toBe(8192 + 4096);
      expect(calculateMaxOutputTokens(2000, 2048)).toBe(2000 + 2048);
    });
  });
});
