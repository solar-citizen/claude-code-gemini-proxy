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

    const config = await import(`../src/config?t=${Date.now()}_1`);

    expect(config.GEMINI_API_KEY).toBe("test-gemini-key-1");
    expect(config.DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(config.PORT).toBe(8787);
    expect(config.LOG_LEVEL).toBe(1);
  });

  it("parses custom environment variables correctly", async () => {
    delete process.env.GEMINI_API_KEYS;
    process.env.GEMINI_API_KEY = "custom-key-2";
    process.env.DEFAULT_GEMINI_MODEL = "gemini-pro";
    process.env.PORT = "3000";
    process.env.LOG_LEVEL = "3";

    const config = await import(`../src/config?t=${Date.now()}_2`);

    expect(config.GEMINI_API_KEY).toBe("custom-key-2");
    expect(config.DEFAULT_GEMINI_MODEL).toBe("gemini-pro");
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe(3);
  });

  it("parses ROTATION_MODE correctly with defaults and custom values", async () => {
    delete process.env.ROTATION_MODE;
    delete process.env.ENABLE_ROTATION;
    process.env.GEMINI_API_KEY = "test-key";

    const configDefault = await import(`../src/config?t=${Date.now()}_3`);
    expect(configDefault.ROTATION_MODE).toBe("default");

    process.env.ROTATION_MODE = "rotation";
    const configRotation = await import(`../src/config?t=${Date.now()}_4`);
    expect(configRotation.ROTATION_MODE).toBe("rotation");

    process.env.ROTATION_MODE = "default";
    const configDefaultExplicit = await import(`../src/config?t=${Date.now()}_5`);
    expect(configDefaultExplicit.ROTATION_MODE).toBe("default");

    delete process.env.ROTATION_MODE;
    process.env.ENABLE_ROTATION = "true";
    const configEnableTrue = await import(`../src/config?t=${Date.now()}_6`);
    expect(configEnableTrue.ROTATION_MODE).toBe("rotation");

    process.env.ENABLE_ROTATION = "false";
    const configEnableFalse = await import(`../src/config?t=${Date.now()}_7`);
    expect(configEnableFalse.ROTATION_MODE).toBe("default");
  });
});
