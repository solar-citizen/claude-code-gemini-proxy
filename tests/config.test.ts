import { describe, it, expect } from "bun:test";
import { parseConfig } from "../src/config";

describe("Config Parsing", () => {
  it("parses environment variables correctly with defaults", () => {
    const fakeEnv = {
      GEMINI_API_KEY: "test-gemini-key-1",
    };

    const config = parseConfig(fakeEnv);

    expect(config.geminiApiKey).toBe("test-gemini-key-1");
    expect(config.defaultGeminiModel).toBe("gemini-3.5-flash-lite");
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe(1);
    expect(config.enableAutoSubagentRouting).toBe(true);
    expect(config.haikuSubagentPatterns).toEqual([
      "read-only search agent",
      "subagent-driven-development",
      "implementation plan step",
      "explore agent",
    ]);
    expect(config.forceHaikuTools).toEqual(["Grep", "Glob", "Read"]);
  });

  it("parses custom environment variables correctly", () => {
    const fakeEnv = {
      GEMINI_API_KEY: "custom-key-2",
      DEFAULT_GEMINI_MODEL: "gemini-pro",
      PORT: "3000",
      LOG_LEVEL: "3",
      ENABLE_AUTO_SUBAGENT_ROUTING: "false",
      HAIKU_SUBAGENT_PATTERNS: "test-pattern-1, test-pattern-2",
      FORCE_HAIKU_TOOLS: "TestTool1, TestTool2",
    };

    const config = parseConfig(fakeEnv);

    expect(config.geminiApiKey).toBe("custom-key-2");
    expect(config.defaultGeminiModel).toBe("gemini-pro");
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe(3);
    expect(config.enableAutoSubagentRouting).toBe(false);
    expect(config.haikuSubagentPatterns).toEqual(["test-pattern-1", "test-pattern-2"]);
    expect(config.forceHaikuTools).toEqual(["TestTool1", "TestTool2"]);
  });

  it("parses ROTATION_MODE correctly with defaults and custom values", () => {
    const configDefault = parseConfig({ GEMINI_API_KEY: "test-key" });
    expect(configDefault.rotationMode).toBe("default");

    const configRotation = parseConfig({ GEMINI_API_KEY: "test-key", ROTATION_MODE: "rotation" });
    expect(configRotation.rotationMode).toBe("rotation");

    const configDefaultExplicit = parseConfig({ GEMINI_API_KEY: "test-key", ROTATION_MODE: "default" });
    expect(configDefaultExplicit.rotationMode).toBe("default");
  });
});
