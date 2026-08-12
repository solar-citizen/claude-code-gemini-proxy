import {
  GeminiRotationManager,
  CooldownTracker,
  AllCombinationsExhaustedError,
  GeminiUpstreamError,
  buildCombinations,
  keyFingerprint,
  isRetryableStatus,
} from "../../src/gemini/rotation";
import type { Tier, Combination, RotationConfig } from "../../src/gemini/rotation";

// ── Helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<RotationConfig>): RotationConfig {
  return {
    keys: ["KEY1", "KEY2", "KEY3"],
    tierModels: {
      opus: ["gemini-3.6-flash"],
      sonnet: ["gemini-3.5-flash", "gemini-3-flash"],
      haiku: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
    },
    cooldownMs: 60_000,
    ...overrides,
  };
}

/** Creates a mock Response with the given status. */
function mockResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Creates a request function that records calls and returns responses in order. */
function mockRequestFn(responses: Array<Response | Error>): {
  fn: (apiKey: string, model: string) => Promise<Response>;
  calls: Array<{ apiKey: string; model: string }>;
} {
  const calls: Array<{ apiKey: string; model: string }> = [];
  let index = 0;

  const fn = async (apiKey: string, model: string): Promise<Response> => {
    calls.push({ apiKey, model });
    const response = responses[index++];
    if (!response) throw new Error(`No mock response at index ${index - 1}`);
    if (response instanceof Error) throw response;
    return response;
  };

  return { fn, calls };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("keyFingerprint", () => {
  it("returns an 8-character hex string", () => {
    const fp = keyFingerprint("test-api-key");
    expect(fp).toHaveLength(8);
    expect(fp).toMatch(/^[a-f0-9]{8}$/);
  });

  it("is deterministic", () => {
    expect(keyFingerprint("key1")).toBe(keyFingerprint("key1"));
  });

  it("differs for different keys", () => {
    expect(keyFingerprint("key1")).not.toBe(keyFingerprint("key2"));
  });

  it("never equals the original key (no accidental exposure)", () => {
    const key = "my-secret-api-key";
    expect(keyFingerprint(key)).not.toBe(key);
    expect(key).not.toContain(keyFingerprint(key));
  });
});

describe("isRetryableStatus", () => {
  it("treats 429, 500, 502, 503, 504 as retryable", () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(s)).toBe(true);
    }
  });

  it("treats other statuses as non-retryable", () => {
    for (const s of [200, 301, 400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });
});

describe("buildCombinations", () => {
  it("produces key × model in deterministic order", () => {
    const combos = buildCombinations(
      ["KEY1", "KEY2", "KEY3"],
      ["modelA", "modelB"],
    );

    expect(combos.map(({ key, model }) => `${key}/${model}`)).toEqual([
      "KEY1/modelA",
      "KEY1/modelB",
      "KEY2/modelA",
      "KEY2/modelB",
      "KEY3/modelA",
      "KEY3/modelB",
    ]);
  });

  it("returns empty array for empty keys", () => {
    expect(buildCombinations([], ["model"])).toEqual([]);
  });

  it("returns empty array for empty models", () => {
    expect(buildCombinations(["KEY"], [])).toEqual([]);
  });

  it("sets keyFingerprint on each combination", () => {
    const combos = buildCombinations(["MY_KEY"], ["model"]);
    expect(combos[0].keyFingerprint).toBe(keyFingerprint("MY_KEY"));
  });
});

describe("CooldownTracker", () => {
  const combo: Combination = {
    key: "KEY1",
    model: "model-a",
    keyFingerprint: keyFingerprint("KEY1"),
  };

  it("starts with nothing in cooldown", () => {
    const tracker = new CooldownTracker(60_000);
    expect(tracker.isInCooldown(combo)).toBe(false);
  });

  it("marks a combination as in cooldown after failure", () => {
    const tracker = new CooldownTracker(60_000);
    tracker.markFailed(combo);
    expect(tracker.isInCooldown(combo)).toBe(true);
  });

  it("clears cooldown on markHealthy", () => {
    const tracker = new CooldownTracker(60_000);
    tracker.markFailed(combo);
    tracker.markHealthy(combo);
    expect(tracker.isInCooldown(combo)).toBe(false);
  });

  it("auto-clears expired cooldowns", () => {
    // Use a 1ms cooldown
    const tracker = new CooldownTracker(1);
    tracker.markFailed(combo);

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    expect(tracker.isInCooldown(combo)).toBe(false);
  });

  it("tracks multiple combinations independently", () => {
    const tracker = new CooldownTracker(60_000);
    const combo2: Combination = {
      key: "KEY2",
      model: "model-b",
      keyFingerprint: keyFingerprint("KEY2"),
    };

    tracker.markFailed(combo);
    expect(tracker.isInCooldown(combo)).toBe(true);
    expect(tracker.isInCooldown(combo2)).toBe(false);
  });
});

describe("GeminiRotationManager", () => {
  // ── Construction ──

  it("throws when no keys provided", () => {
    expect(() => new GeminiRotationManager({
      keys: [],
      tierModels: { opus: ["m"], sonnet: ["m"], haiku: ["m"] },
      cooldownMs: 1000,
    })).toThrow("At least one GEMINI API key is required.");
  });

  it("builds separate pools per tier", () => {
    const mgr = new GeminiRotationManager(makeConfig());

    expect(mgr.getPool("opus").length).toBe(3);   // 3 keys × 1 model
    expect(mgr.getPool("sonnet").length).toBe(6);  // 3 keys × 2 models
    expect(mgr.getPool("haiku").length).toBe(6);   // 3 keys × 2 models
  });

  // ── Test 1: Single key + single model succeeds ──

  it("succeeds with single key and single model", async () => {
    const mgr = new GeminiRotationManager({
      keys: ["SINGLE_KEY"],
      tierModels: { opus: ["model-a"], sonnet: ["model-a"], haiku: ["model-a"] },
      cooldownMs: 60_000,
    });

    const { fn, calls } = mockRequestFn([mockResponse(200, { ok: true })]);

    const result = await mgr.executeWithRotation("haiku", fn);
    expect(result.model).toBe("model-a");
    expect(calls).toHaveLength(1);
    expect(calls[0].apiKey).toBe("SINGLE_KEY");
    expect(calls[0].model).toBe("model-a");
  });

  // ── Test 2: First model succeeds → only one upstream request ──

  it("makes only one upstream request when first combination succeeds", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([mockResponse(200)]);

    await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(1);
  });

  // ── Test 3: First model returns 429 → second model attempted ──

  it("rotates to second model on 429", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(429, { error: "rate limited" }),
      mockResponse(200, { ok: true }),
    ]);

    const result = await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe("gemini-3.5-flash-lite");
    expect(calls[1].model).toBe("gemini-3.1-flash-lite");
    expect(result.model).toBe("gemini-3.1-flash-lite");
  });

  // ── Test 4: First model returns 500 → second model attempted ──

  it("rotates to second model on 500", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(500, { error: "internal" }),
      mockResponse(200),
    ]);

    const result = await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(2);
    expect(result.model).toBe("gemini-3.1-flash-lite");
  });

  // ── Test 5: First key/model fails → next combination in exact order ──

  it("follows deterministic order across keys and models", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(429), // KEY1/gemini-3.5-flash-lite
      mockResponse(429), // KEY1/gemini-3.1-flash-lite
      mockResponse(429), // KEY2/gemini-3.5-flash-lite
      mockResponse(200), // KEY2/gemini-3.1-flash-lite → success
    ]);

    const result = await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({ apiKey: "KEY1", model: "gemini-3.5-flash-lite" });
    expect(calls[1]).toEqual({ apiKey: "KEY1", model: "gemini-3.1-flash-lite" });
    expect(calls[2]).toEqual({ apiKey: "KEY2", model: "gemini-3.5-flash-lite" });
    expect(calls[3]).toEqual({ apiKey: "KEY2", model: "gemini-3.1-flash-lite" });
    expect(result.model).toBe("gemini-3.1-flash-lite");
  });

  // ── Test 6: Multiple keys + multiple models → deterministic ordering ──

  it("produces exact KEY1/modelA, KEY1/modelB, KEY2/modelA, KEY2/modelB, KEY3/modelA, KEY3/modelB ordering", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    // Fail all 6 haiku combos
    const { fn, calls } = mockRequestFn([
      mockResponse(429), mockResponse(429),
      mockResponse(429), mockResponse(429),
      mockResponse(429), mockResponse(429),
    ]);

    await expect(mgr.executeWithRotation("haiku", fn)).rejects.toThrow(AllCombinationsExhaustedError);

    const order = calls.map(({ apiKey, model }) => `${apiKey}/${model}`);
    expect(order).toEqual([
      "KEY1/gemini-3.5-flash-lite",
      "KEY1/gemini-3.1-flash-lite",
      "KEY2/gemini-3.5-flash-lite",
      "KEY2/gemini-3.1-flash-lite",
      "KEY3/gemini-3.5-flash-lite",
      "KEY3/gemini-3.1-flash-lite",
    ]);
  });

  // ── Test 7: Opus only uses Opus pool ──

  it("opus requests only use opus models", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(429), mockResponse(429), mockResponse(429),
    ]);

    await expect(mgr.executeWithRotation("opus", fn)).rejects.toThrow(AllCombinationsExhaustedError);

    // All 3 calls should use the opus model only
    for (const call of calls) {
      expect(call.model).toBe("gemini-3.6-flash");
    }
    expect(calls).toHaveLength(3); // 3 keys × 1 opus model
  });

  // ── Test 8: Sonnet only uses Sonnet pool ──

  it("sonnet requests only use sonnet models", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(429), mockResponse(429),
      mockResponse(429), mockResponse(429),
      mockResponse(429), mockResponse(429),
    ]);

    await expect(mgr.executeWithRotation("sonnet", fn)).rejects.toThrow(AllCombinationsExhaustedError);

    const models = new Set(calls.map(({ model }) => model));
    expect(models).toEqual(new Set(["gemini-3.5-flash", "gemini-3-flash"]));
    expect(calls).toHaveLength(6); // 3 keys × 2 sonnet models
  });

  // ── Test 9: Haiku only uses Haiku pool ──

  it("haiku requests only use haiku models", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(429), mockResponse(429),
      mockResponse(429), mockResponse(429),
      mockResponse(429), mockResponse(429),
    ]);

    await expect(mgr.executeWithRotation("haiku", fn)).rejects.toThrow(AllCombinationsExhaustedError);

    const models = new Set(calls.map(({ model }) => model));
    expect(models).toEqual(new Set(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]));
    expect(calls).toHaveLength(6);
  });

  // ── Test 10: Haiku failure never causes fallback to Sonnet ──

  it("haiku failure never falls back to sonnet models", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn(
      Array.from({ length: 6 }, () => mockResponse(429))
    );

    await expect(mgr.executeWithRotation("haiku", fn)).rejects.toThrow(AllCombinationsExhaustedError);

    const sonnetModels = new Set(["gemini-3.5-flash", "gemini-3-flash"]);
    for (const call of calls) {
      expect(sonnetModels.has(call.model)).toBe(false);
    }
  });

  // ── Test 11: Sonnet failure never causes fallback to Opus ──

  it("sonnet failure never falls back to opus models", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn(
      Array.from({ length: 6 }, () => mockResponse(429))
    );

    await expect(mgr.executeWithRotation("sonnet", fn)).rejects.toThrow(AllCombinationsExhaustedError);

    for (const call of calls) {
      expect(call.model).not.toBe("gemini-3.6-flash");
    }
  });

  // ── Test 12: Successful fallback stops the sequence ──

  it("stops immediately after first success", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(429),
      mockResponse(429),
      mockResponse(200, { success: true }),
      mockResponse(200, { should_not_reach: true }),
    ]);

    await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(3);
  });

  // ── Test 13: No concurrent duplicate retries ──

  it("handles concurrent requests without duplicate retries", async () => {
    const mgr = new GeminiRotationManager(makeConfig());

    // Two concurrent haiku requests
    const { fn: fn1, calls: calls1 } = mockRequestFn([mockResponse(200)]);
    const { fn: fn2, calls: calls2 } = mockRequestFn([mockResponse(200)]);

    const [r1, r2] = await Promise.all([
      mgr.executeWithRotation("haiku", fn1),
      mgr.executeWithRotation("haiku", fn2),
    ]);

    // Each request makes exactly 1 call (no duplicates)
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
    expect(r1.model).toBeDefined();
    expect(r2.model).toBeDefined();
  });

  // ── Test 14: Cooldown marks a failed combination unavailable ──

  it("cooldown causes subsequent requests to skip failed combinations", async () => {
    const mgr = new GeminiRotationManager(makeConfig({
      keys: ["KEY1"],
      tierModels: {
        opus: ["m"],
        sonnet: ["m"],
        haiku: ["model-a", "model-b"],
      },
      cooldownMs: 60_000,
    }));

    // First request: model-a fails, model-b succeeds
    const { fn: fn1 } = mockRequestFn([
      mockResponse(429),
      mockResponse(200),
    ]);
    await mgr.executeWithRotation("haiku", fn1);

    // Second request: should skip model-a (in cooldown), go straight to model-b
    const { fn: fn2, calls: calls2 } = mockRequestFn([
      mockResponse(200),
    ]);
    await mgr.executeWithRotation("haiku", fn2);

    expect(calls2).toHaveLength(1);
    expect(calls2[0].model).toBe("model-b");
  });

  // ── Test 15: Combination becomes eligible again after cooldown expires ──

  it("combination becomes eligible after cooldown expires", async () => {
    const mgr = new GeminiRotationManager(makeConfig({
      keys: ["KEY1"],
      tierModels: {
        opus: ["m"],
        sonnet: ["m"],
        haiku: ["model-a"],
      },
      cooldownMs: 1, // 1ms cooldown
    }));

    // Fail model-a
    const { fn: fn1 } = mockRequestFn([mockResponse(429)]);
    await expect(mgr.executeWithRotation("haiku", fn1)).rejects.toThrow(AllCombinationsExhaustedError);

    // Wait for cooldown to expire
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now model-a should be eligible again
    const { fn: fn2, calls: calls2 } = mockRequestFn([mockResponse(200)]);
    await mgr.executeWithRotation("haiku", fn2);

    expect(calls2).toHaveLength(1);
    expect(calls2[0].model).toBe("model-a");
  });

  // ── Test 16: Healthy combinations preferred over cooldown ones ──

  it("prefers healthy combinations over ones in cooldown", async () => {
    const mgr = new GeminiRotationManager(makeConfig({
      keys: ["KEY1", "KEY2"],
      tierModels: {
        opus: ["m"],
        sonnet: ["m"],
        haiku: ["model-a"],
      },
      cooldownMs: 60_000,
    }));

    // First request: KEY1+model-a fails, KEY2+model-a succeeds
    const { fn: fn1 } = mockRequestFn([
      mockResponse(429),
      mockResponse(200),
    ]);
    await mgr.executeWithRotation("haiku", fn1);

    // Second request: should try KEY2 first (healthy) before KEY1 (cooldown)
    const { fn: fn2, calls: calls2 } = mockRequestFn([mockResponse(200)]);
    await mgr.executeWithRotation("haiku", fn2);

    expect(calls2).toHaveLength(1);
    expect(calls2[0].apiKey).toBe("KEY2");
  });

  // ── Test 17: All combinations unavailable → appropriate error ──

  it("throws AllCombinationsExhaustedError when all combinations fail", async () => {
    const mgr = new GeminiRotationManager(makeConfig({
      keys: ["KEY1"],
      tierModels: { opus: ["m"], sonnet: ["m"], haiku: ["m1", "m2"] },
      cooldownMs: 60_000,
    }));

    const { fn } = mockRequestFn([
      mockResponse(429),
      mockResponse(429),
    ]);

    await expect(mgr.executeWithRotation("haiku", fn))
      .rejects.toThrow(AllCombinationsExhaustedError);
  });

  // ── Test 18: API keys never appear in error messages ──

  it("does not expose API keys in AllCombinationsExhaustedError", async () => {
    const secretKey = "super-secret-api-key-12345";
    const mgr = new GeminiRotationManager({
      keys: [secretKey],
      tierModels: { opus: ["m"], sonnet: ["m"], haiku: ["m"] },
      cooldownMs: 60_000,
    });

    const { fn } = mockRequestFn([mockResponse(429)]);

    try {
      await mgr.executeWithRotation("haiku", fn);
      fail("Should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain(secretKey);
      expect(JSON.stringify(err)).not.toContain(secretKey);
    }
  });

  // ── Non-retryable errors do NOT rotate ──

  it("throws immediately on non-retryable errors (401)", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(401, { error: "unauthorized" }),
    ]);

    await expect(mgr.executeWithRotation("haiku", fn))
      .rejects.toThrow(GeminiUpstreamError);

    expect(calls).toHaveLength(1);
  });

  it("throws immediately on non-retryable errors (400)", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      mockResponse(400, { error: "bad request" }),
    ]);

    await expect(mgr.executeWithRotation("haiku", fn))
      .rejects.toThrow(GeminiUpstreamError);

    expect(calls).toHaveLength(1);
  });

  // ── Network errors are retryable ──

  it("treats network errors as retryable", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const { fn, calls } = mockRequestFn([
      new Error("ECONNREFUSED"),
      mockResponse(200),
    ]);

    const result = await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(2);
    expect(result.model).toBe("gemini-3.1-flash-lite");
  });

  // ── All retryable statuses handled ──

  it("retries on all retryable HTTP statuses", async () => {
    const mgr = new GeminiRotationManager(makeConfig({
      keys: ["K1", "K2", "K3"],
      tierModels: {
        opus: ["m"],
        sonnet: ["m"],
        haiku: ["m1", "m2", "m3"],
      },
      cooldownMs: 1,
    }));

    const { fn, calls } = mockRequestFn([
      mockResponse(429), // rate limit
      mockResponse(500), // internal server error
      mockResponse(502), // bad gateway
      mockResponse(503), // service unavailable
      mockResponse(504), // gateway timeout
      mockResponse(200), // success
    ]);

    const result = await mgr.executeWithRotation("haiku", fn);
    expect(calls).toHaveLength(6);
    expect(result.response.ok).toBe(true);
  });

  // ── Empty tier pool ──

  it("throws AllCombinationsExhaustedError for empty tier pool", async () => {
    const mgr = new GeminiRotationManager({
      keys: ["K1"],
      tierModels: { opus: [], sonnet: ["m"], haiku: ["m"] },
      cooldownMs: 1000,
    });

    const { fn } = mockRequestFn([]);
    await expect(mgr.executeWithRotation("opus", fn))
      .rejects.toThrow(AllCombinationsExhaustedError);
  });

  // ── Response returned from successful rotation ──

  it("returns the raw response for the caller to consume", async () => {
    const mgr = new GeminiRotationManager(makeConfig());
    const successBody = { candidates: [{ content: { parts: [{ text: "hello" }] } }] };
    const { fn } = mockRequestFn([mockResponse(200, successBody)]);

    const { response, model } = await mgr.executeWithRotation("haiku", fn);
    const json = await response.json();
    expect(json).toEqual(successBody);
    expect(model).toBe("gemini-3.5-flash-lite");
  });
});
