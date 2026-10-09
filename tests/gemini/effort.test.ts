import { expect, test, describe } from "bun:test";
import { extractEffort, mapEffortToThinkingConfig, calculateMaxOutputTokens, formatResponseModel } from "../../src/gemini/effort";

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

  describe("formatResponseModel", () => {
    test("appends effort to model name when effort is provided", () => {
      expect(formatResponseModel("gemini-3.5-flash-lite[1m]", "high")).toBe("gemini-3.5-flash-lite[1m] (effort: high)");
      expect(formatResponseModel("gemini-2.5-pro", "medium")).toBe("gemini-2.5-pro (effort: medium)");
    });

    test("returns original model unchanged when effort is undefined or empty", () => {
      expect(formatResponseModel("gemini-3.5-flash-lite[1m]", undefined)).toBe("gemini-3.5-flash-lite[1m]");
      expect(formatResponseModel("gemini-2.5-pro", "")).toBe("gemini-2.5-pro");
    });
  });
});
