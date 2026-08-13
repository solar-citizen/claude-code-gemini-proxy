import { createTierDetector, stripModelSuffix } from "../../src/gemini/tier";

const detectTier = createTierDetector({
  opus: ["gemini-3.6-flash"],
  sonnet: ["gemini-3.5-flash", "gemini-3-flash"],
  haiku: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
});

describe("stripModelSuffix", () => {
  it("strips [1m] suffix", () => {
    expect(stripModelSuffix("gemini-3.5-flash-lite[1m]")).toBe("gemini-3.5-flash-lite");
  });

  it("strips [8k] suffix", () => {
    expect(stripModelSuffix("model[8k]")).toBe("model");
  });

  it("leaves bare model names unchanged", () => {
    expect(stripModelSuffix("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
  });

  it("handles empty string", () => {
    expect(stripModelSuffix("")).toBe("");
  });
});

describe("detectTier (via createTierDetector)", () => {
  it("detects opus models", () => {
    expect(detectTier("gemini-3.6-flash")).toBe("opus");
  });

  it("detects sonnet models", () => {
    expect(detectTier("gemini-3.5-flash")).toBe("sonnet");
    expect(detectTier("gemini-3-flash")).toBe("sonnet");
  });

  it("detects haiku models", () => {
    expect(detectTier("gemini-3.5-flash-lite")).toBe("haiku");
    expect(detectTier("gemini-3.1-flash-lite")).toBe("haiku");
  });

  it("detects models with [1m] suffix", () => {
    expect(detectTier("gemini-3.6-flash[1m]")).toBe("opus");
    expect(detectTier("gemini-3.5-flash[1m]")).toBe("sonnet");
    expect(detectTier("gemini-3.5-flash-lite[1m]")).toBe("haiku");
  });

  it("defaults to sonnet for unknown models", () => {
    expect(detectTier("unknown-model")).toBe("sonnet");
  });

  it("defaults to sonnet for undefined/empty", () => {
    expect(detectTier(undefined)).toBe("sonnet");
    expect(detectTier("")).toBe("sonnet");
  });

  it("handles models with whitespace", () => {
    expect(detectTier("  gemini-3.6-flash  ")).toBe("opus"); // stripped by stripModelSuffix
    expect(detectTier("gemini-3.6-flash ")).toBe("opus"); // trailing space
  });
});

describe("tier isolation", () => {
  it("a haiku model is never classified as opus or sonnet", () => {
    expect(detectTier("gemini-3.5-flash-lite")).toBe("haiku");
    expect(detectTier("gemini-3.1-flash-lite")).toBe("haiku");
  });

  it("a sonnet model is never classified as opus or haiku", () => {
    expect(detectTier("gemini-3.5-flash")).toBe("sonnet");
    expect(detectTier("gemini-3-flash")).toBe("sonnet");
  });

  it("an opus model is never classified as sonnet or haiku", () => {
    expect(detectTier("gemini-3.6-flash")).toBe("opus");
  });
});
