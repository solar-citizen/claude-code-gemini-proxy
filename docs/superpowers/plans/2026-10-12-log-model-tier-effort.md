# Log Model, Effort, and Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include model (with effort annotation) and tier in the proxy completion log message so it is visible on standard log level (`LOG_LEVEL=2`).

**Architecture:** Update `src/main.ts` where the completion log is issued to include `[model: ${responseModel}] [tier: ${tier}]` in the message string. Add test coverage in `tests/proxy.test.ts` spying on the logger to verify the output format.

**Tech Stack:** TypeScript, Bun test framework.

## Global Constraints

- Keep formatting consistent: `${method} ${pathname} -> ${stopReason} [model: ${responseModel}] [tier: ${tier}]`.
- Ensure backwards compatibility with log structure and arguments passed to `log("info", ...)`.

---

### Task 1: Update Completion Log Message in Request Handler

**Files:**
- Modify: `src/main.ts:154`
- Test: `tests/proxy.test.ts`

**Interfaces:**
- Consumes: `responseModel: string`, `tier: Tier`, `method: string`, `pathname: string`, `stopReason: string`.
- Produces: Log string: `${method} ${pathname} -> ${stopReason} [model: ${responseModel}] [tier: ${tier}]`.

- [ ] **Step 1: Write the failing test**

Add a test in `tests/proxy.test.ts` verifying that `logger.log` is called with the formatted message containing `[model: ...]` and `[tier: ...]`:

```typescript
  it("logs completion message with model and tier", async () => {
    const loggerModule = await import("../src/utils/logger.util");
    const logSpy = spyOn(loggerModule, "log");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com")) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as unknown as typeof fetch;

    try {
      const req = new Request("http://localhost:8787/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          output_config: { effort: "high" },
        }),
      });

      const res = await handleRequest(req);
      expect(res.status).toBe(200);

      const completionCall = logSpy.mock.calls.find(
        (call) => typeof call[1] === "string" && call[1].startsWith("POST /v1/messages ->")
      );
      expect(completionCall).toBeDefined();
      expect(completionCall?.[1]).toMatch(/^POST \/v1\/messages -> \w+ \[model: .+ \(effort: high\)\] \[tier: \w+\]$/);
    } finally {
      globalThis.fetch = originalFetch;
      logSpy.mockRestore();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/proxy.test.ts`
Expected: FAIL due to completion log message not matching `[model: ...] [tier: ...]`.

- [ ] **Step 3: Update implementation in `src/main.ts`**

Change line 154 in `src/main.ts`:
```typescript
      log("info", `${method} ${pathname} -> ${stopReason} [model: ${responseModel}] [tier: ${tier}]`, {
        ms: Date.now() - start,
        tier,
        model: responseModel,
        usage,
        toolCalls: blocks.filter((block): block is Extract<AnthropicOutputBlock, { type: "tool_use" }> => {
          return block.type === "tool_use";
        }).map(({ name }) => name),
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test`
Expected: PASS across all test suites.

- [ ] **Step 5: Commit changes**

```bash
git add src/main.ts tests/proxy.test.ts docs/superpowers/plans/2026-10-12-log-model-tier-effort.md
git commit -m "feat: include model, effort, and tier in completion log message"
```
