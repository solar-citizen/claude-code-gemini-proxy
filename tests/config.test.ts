import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("Config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("parses environment variables correctly with defaults", async () => {
    delete process.env.GEMINI_API_KEYS;
    process.env.GEMINI_API_KEY = "test-gemini-key-1";
    delete process.env.DEFAULT_GEMINI_MODEL;
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;

    const { config } = await import(`../src/config?t=${Date.now()}_1`);

    expect(config.geminiApiKey).toBe("test-gemini-key-1");
    expect(config.defaultGeminiModel).toBe("gemini-3.5-flash-lite");
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe(1);
  });

  it("parses custom environment variables correctly", async () => {
    delete process.env.GEMINI_API_KEYS;
    process.env.GEMINI_API_KEY = "custom-key-2";
    process.env.DEFAULT_GEMINI_MODEL = "gemini-pro";
    process.env.PORT = "3000";
    process.env.LOG_LEVEL = "3";

    const { config } = await import(`../src/config?t=${Date.now()}_2`);

    expect(config.geminiApiKey).toBe("custom-key-2");
    expect(config.defaultGeminiModel).toBe("gemini-pro");
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe(3);
  });

  it("parses ROTATION_MODE correctly with defaults and custom values", async () => {
    delete process.env.ROTATION_MODE;
    process.env.GEMINI_API_KEY = "test-key";

    const { config: configDefault } = await import(`../src/config?t=${Date.now()}_3`);
    expect(configDefault.rotationMode).toBe("default");

    process.env.ROTATION_MODE = "rotation";
    const { config: configRotation } = await import(`../src/config?t=${Date.now()}_4`);
    expect(configRotation.rotationMode).toBe("rotation");

    process.env.ROTATION_MODE = "default";
    const { config: configDefaultExplicit } = await import(`../src/config?t=${Date.now()}_5`);
    expect(configDefaultExplicit.rotationMode).toBe("default");

    delete process.env.ROTATION_MODE;
    const { config: configDefaultExplicit2 } = await import(`../src/config?t=${Date.now()}_6`);
    expect(configDefaultExplicit2.rotationMode).toBe("default");
  });
});
