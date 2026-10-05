# Subagent-Aware Dynamic Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Approach B (Subagent-Aware Dynamic Model Routing) within `claude-code-gemini-proxy` to automatically route simple subagent tasks (e.g. Explore agents, implementation subagents) to the Haiku tier, while retaining the high-level planning/brainstorming sessions in the Opus/Sonnet tiers.

**Architecture:** We introduce `src/gemini/router.ts` containing a request routing classifier. The proxy's main request handler (`src/main.ts`) invokes this classifier, passing the request's model, system instructions, tools, and messages. The router preserves Opus for planning/architectural context, while routing Explore agents, read-only search operations, and implementation subagents to the Haiku tier.

**Tech Stack:** TypeScript, Bun Test

## Global Constraints
- Target Node/Bun versions: Bun 1.3+
- Configuration keys: `ENABLE_AUTO_SUBAGENT_ROUTING`, `HAIKU_SUBAGENT_PATTERNS`, `FORCE_HAIKU_TOOLS`.
- No placeholders: All step code blocks must be complete and syntactically correct.
- Strict Type Safety: Use explicit types for Anthropic system blocks, tools, and message contents instead of `any`.

---

### Task 1: Add Configuration Options

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: Nothing
- Produces: `export function parseConfig(env?: Record<string, string | undefined>)` and `config` object with `enableAutoSubagentRouting`, `haikuSubagentPatterns`, `forceHaikuTools`.

- [ ] **Step 1: Write tests verifying config parsing with default and custom environment variables**

```typescript
// tests/config.test.ts
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
});
```

- [ ] **Step 2: Run tests to verify failure**
Run: `bun test tests/config.test.ts`
Expected: FAIL due to missing config properties / `parseConfig` export.

- [ ] **Step 3: Update `src/config.ts` and `.env.example`**
Refactor helper functions in `src/config.ts` to accept `env` object and export `parseConfig`:

```typescript
function parseBoolean(env: Record<string, string | undefined>, envVar: string, defaultValue: boolean): boolean {
  const value = env[envVar]?.toLowerCase().trim();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return defaultValue;
}

export function parseConfig(env: Record<string, string | undefined> = process.env) {
  const geminiApiKeys = parseApiKeys(env);
  const defaultGeminiModel = env.DEFAULT_GEMINI_MODEL ?? "gemini-3.5-flash-lite";

  return {
    geminiApiKeys,
    geminiApiKey: geminiApiKeys[0],
    defaultGeminiModel,
    port: Number(env.PORT ?? 8787),
    logLevel: parseInt(env.LOG_LEVEL ?? "1", 10),
    haikuModels: parseModelList(env, "HAIKU_MODELS", [defaultGeminiModel]),
    sonnetModels: parseModelList(env, "SONNET_MODELS", [defaultGeminiModel]),
    opusModels: parseModelList(env, "OPUS_MODELS", [defaultGeminiModel]),
    rotationCooldownSeconds: Number(env.ROTATION_COOLDOWN_SECONDS ?? 60),
    rotationMode: parseRotationMode(env),
    enableAutoSubagentRouting: parseBoolean(env, "ENABLE_AUTO_SUBAGENT_ROUTING", true),
    haikuSubagentPatterns: parseModelList(env, "HAIKU_SUBAGENT_PATTERNS", [
      "read-only search agent",
      "subagent-driven-development",
      "implementation plan step",
      "explore agent",
    ]),
    forceHaikuTools: parseModelList(env, "FORCE_HAIKU_TOOLS", ["Grep", "Glob", "Read"]),
  };
}

export const config = parseConfig();
```

- [ ] **Step 4: Run tests to verify success**
Run: `bun test tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/config.ts .env.example tests/config.test.ts
git commit -m "feat: add config parameters for dynamic model routing"
```

---

### Task 2: Build the Dynamic Routing Engine

**Files:**
- Create: `src/gemini/router.ts`
- Test: `tests/gemini/router.test.ts`

**Interfaces:**
- Consumes: `config.ts`, `detectTier` from `src/gemini/tier.ts`
- Produces: `routeRequest(params: RoutingParams): Tier`

- [ ] **Step 1: Write unit tests for the routing engine**
Create `tests/gemini/router.test.ts`:

```typescript
import { routeRequest } from "../../src/gemini/router";

describe("routeRequest", () => {
  it("preserves Opus tier for planning/architecture agents even with read tools", () => {
    const tier = routeRequest({
      model: "gemini-3.6-flash",
      system: "You are a software architect agent for designing implementation plans.",
      tools: [{ name: "Read" }, { name: "Grep" }],
    });
    expect(tier).toBe("opus");
  });

  it("routes Explore / Read-Only subagents to Haiku", () => {
    const tier = routeRequest({
      model: "gemini-3.6-flash",
      system: "You are a read-only search agent for broad fan-out searches.",
      tools: [{ name: "Grep" }, { name: "Read" }],
    });
    expect(tier).toBe("haiku");
  });

  it("routes implementation subagents from messages to Haiku", () => {
    const tier = routeRequest({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "Executing subagent-driven-development tasks." }],
      tools: [{ name: "Write" }, { name: "Edit" }],
    });
    expect(tier).toBe("haiku");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**
Run: `bun test tests/gemini/router.test.ts`
Expected: FAIL (Module not found)

- [ ] **Step 3: Implement `src/gemini/router.ts`**
Implement the router with strongly typed interfaces and planning protection:

```typescript
import { config } from "../config";
import { detectTier } from "./tier";
import type { Tier } from "./rotation";

export interface AnthropicSystemBlock {
  type?: string;
  text?: string;
}

export interface AnthropicToolLike {
  name?: string;
  description?: string;
}

export interface AnthropicMessageContentBlock {
  type?: string;
  text?: string;
}

export interface AnthropicMessageLike {
  role?: string;
  content?: string | AnthropicMessageContentBlock[];
}

export interface RoutingParams {
  model?: string;
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicToolLike[];
  messages?: AnthropicMessageLike[];
}

export function routeRequest({ model, system, tools, messages }: RoutingParams): Tier {
  const defaultTier = detectTier(model);

  if (!config.enableAutoSubagentRouting) {
    return defaultTier;
  }

  const systemText = typeof system === "string" ? system.toLowerCase() : Array.isArray(system) ? system.map(b => (typeof b === "string" ? b : b?.text ?? "")).join("\n").toLowerCase() : "";
  const messagesText = Array.isArray(messages) ? messages.map(m => typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map(b => b?.text ?? "").join("\n") : "").join("\n").toLowerCase() : "";
  const combinedText = `${systemText}\n${messagesText}`;

  // 1. Preserve planning/architectural context
  const isPlanning = systemText.includes("software architect") || systemText.includes("plan agent") || combinedText.includes("superpowers:writing-plans") || combinedText.includes("superpowers:brainstorming");
  if (isPlanning) {
    return defaultTier;
  }

  // 2. Route matching subagent patterns to Haiku
  const isHaikuPattern = config.haikuSubagentPatterns.some(p => combinedText.includes(p.toLowerCase()));
  if (isHaikuPattern) {
    return "haiku";
  }

  // 3. Tool-based heuristic
  const toolNames = (tools || []).map(t => t?.name || "");
  const hasWriteTools = toolNames.some(name => ["Write", "Edit", "NotebookEdit"].includes(name));
  const hasHaikuTools = toolNames.some(name => config.forceHaikuTools.map(t => t.toLowerCase()).includes(name.toLowerCase()));

  if (hasHaikuTools && !hasWriteTools) {
    return "haiku";
  }

  return defaultTier;
}
```

- [ ] **Step 4: Run tests to verify success**
Run: `bun test tests/gemini/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/gemini/router.ts tests/gemini/router.test.ts
git commit -m "feat: implement subagent-aware dynamic routing engine"
```

---

### Task 3: Integrate Router into Main Handler

**Files:**
- Modify: `src/main.ts`
- Test: `tests/proxy.test.ts`

**Interfaces:**
- Consumes: `routeRequest` from `src/gemini/router.ts`
- Produces: Updated `/v1/messages` request handler passing `model`, `system`, `anthropicTools`, and `messages` into `routeRequest`.

- [ ] **Step 1: Add integration test verifying subagent routing in `tests/proxy.test.ts`**

```typescript
it("dynamically routes subagent requests to haiku tier", async () => {
  let executedTier: string | undefined;
  const spy = spyOn(rotationManager, "executeWithRotation").mockImplementation(
    async (tier, execute) => {
      executedTier = tier;
      return {
        response: new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }),
        model: "gemini-3.5-flash-lite",
      };
    }
  );

  try {
    const req = new Request("http://localhost:8787/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3.6-flash", // Opus tier model requested
        system: "You are a read-only search agent.",
        messages: [{ role: "user", content: "Find files" }],
      }),
    });

    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    expect(executedTier).toBe("haiku");
  } finally {
    spy.mockRestore();
  }
});
```

- [ ] **Step 2: Run tests to verify integration**
Run: `bun test tests/proxy.test.ts`
Expected: PASS with full mock verification.

- [ ] **Step 3: Modify `src/main.ts`**
Import `routeRequest` and replace `detectTier` with `routeRequest({ model: requestedModel, system, tools: anthropicTools, messages })`.

- [ ] **Step 4: Run all tests to ensure no regressions**
Run: `bun test`
Expected: PASS across all test files.

- [ ] **Step 5: Commit**
```bash
git add src/main.ts tests/proxy.test.ts
git commit -m "feat: integrate subagent-aware model router into main request flow"
```

---

### Task 4: Integration & Verification

- [ ] **Step 1: Perform full verification**
Run `npx tsc --noEmit && bun test`
Expected: 0 errors, 100% tests passing.

- [ ] **Step 2: Documentation update**
Update `README.MD` with details on subagent dynamic routing and configuration.
