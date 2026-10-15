# Claude Code `/effort` Translation to Gemini `thinkingConfig` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly translate Claude Code's requested `/effort` level into Gemini's `thinkingConfig.thinkingBudget` and dynamically adjust `maxOutputTokens` headroom so reasoning never truncates responses.

**Architecture:** 
1. Update schema validators to permit `output_config` objects.
2. Build an isolated `src/gemini/effort.ts` module containing the effort-to-token map and extraction helpers.
3. Integrate the helper in `src/main.ts` when building `generationConfig`.

**Tech Stack:** TypeScript, Bun Test

## Global Constraints

- Never use placeholder comments like "TODO" or "TBD".
- Support both top-level `output_config` and per-message synthetic `output_config`.
- Active `thinkingBudget` values must be at least `1024`.

---

### Task 1: Update Types and Validators

Add definitions for `output_config` to `global.d.ts` and modify validators to allow them without warnings.

**Files:**
- Modify: `global.d.ts`
- Modify: `src/anthropic/validators.ts`

**Interfaces:**
- Produces: `output_config` optionally validated as an object with `effort?: string`

- [ ] **Step 1: Write a failing test verifying `output_config` parsing**

Add a test block to `tests/validators.test.ts` to verify `isAnthropicMessagesRequestBody` accepts `output_config`.

```typescript
// Edit/add inside tests/validators.test.ts
import { isAnthropicMessagesRequestBody } from "../src/anthropic/validators";

describe("Anthropic Validators - output_config", () => {
  it("accepts output_config in request body", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      output_config: { effort: "high" }
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("accepts output_config inside system messages", () => {
    const body = {
      messages: [
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: "hello" }
      ]
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/validators.test.ts`
Expected: Fails or ignores validation errors depending on implementation, but types will fail compilation if we use TypeScript.

- [ ] **Step 3: Update `global.d.ts`**

Update `global.d.ts` to include:

```typescript
type AnthropicOutputConfig = {
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | string;
};

type AnthropicMessage = {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
  output_config?: AnthropicOutputConfig;
};

type AnthropicMessagesRequestBody = {
  messages?: AnthropicMessage[];
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicTool[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  model?: string;
  output_config?: AnthropicOutputConfig;
};

type GeminiThinkingConfig = {
  thinkingBudget?: number;
};

type GeminiGenerationConfig = {
  maxOutputTokens: number;
  temperature?: number;
  thinkingConfig?: GeminiThinkingConfig;
};
```

- [ ] **Step 4: Update `src/anthropic/validators.ts`**

Modify `src/anthropic/validators.ts` to allow `output_config` inside request body and messages.

```typescript
// Add function to validate output_config
function isAnthropicOutputConfig(value: unknown): value is AnthropicOutputConfig {
  return isRecord(value) && (value.effort === undefined || typeof value.effort === "string");
}

// In isAnthropicMessagesRequestBody, destruct output_config:
const { messages, system, tools, max_tokens, temperature, stream, model, output_config } = value;

// Validate output_config if present:
if (output_config !== undefined && !isAnthropicOutputConfig(output_config)) {
  issues.push(`output_config: expected an object with effort string, got ${describe(output_config)}`);
}

// In checkMessage, allow output_config:
if (isRecord(value) && value.output_config !== undefined && !isAnthropicOutputConfig(value.output_config)) {
  issues.push(`${path}.output_config: expected an object with effort string`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/validators.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add global.d.ts src/anthropic/validators.ts
git commit -m "feat: validate and support output_config schema"
```

---

### Task 2: Implement Effort Mapping Module

Create the dedicated `src/gemini/effort.ts` module.

**Files:**
- Create: `src/gemini/effort.ts`
- Create: `tests/gemini/effort.test.ts`

**Interfaces:**
- Produces: `extractEffort(body: AnthropicMessagesRequestBody): string | undefined`
- Produces: `mapEffortToThinkingConfig(effort?: string): GeminiThinkingConfig | undefined`
- Produces: `calculateMaxOutputTokens(maxTokens: number | undefined, thinkingBudget: number | undefined): number`

- [ ] **Step 1: Write tests for effort mapping module**

Create `tests/gemini/effort.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/gemini/effort.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement `src/gemini/effort.ts`**

Create `src/gemini/effort.ts`:

```typescript
export const EFFORT_TO_THINKING_BUDGET: Record<string, number> = {
  // Quick tasks, formatting, simple edits (fast & cheap)
  low: 1024,
  // Standard code reviews, small refactoring, single-file implementations
  medium: 2048,
  // Complex feature builds, tricky bug debugging, system architecture
  high: 8192,
  // Long-running agentic tasks, multi-file refactoring
  xhigh: 16384,
  // Frontier algorithmic reasoning, deep security audits
  max: 32768,
};

export function extractEffort(body: AnthropicMessagesRequestBody): string | undefined {
  // Check messages from last to first
  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg.output_config?.effort) {
        return msg.output_config.effort;
      }
    }
  }

  // Fallback to top-level output_config
  return body.output_config?.effort;
}

export function mapEffortToThinkingConfig(effort?: string): GeminiThinkingConfig | undefined {
  if (!effort) return undefined;
  const budget = EFFORT_TO_THINKING_BUDGET[effort.toLowerCase()];
  if (!budget) return undefined;
  return { thinkingBudget: budget };
}

export function calculateMaxOutputTokens(
  maxTokens: number | undefined,
  thinkingBudget: number | undefined,
): number {
  const requested = maxTokens ?? 4096;
  return thinkingBudget ? thinkingBudget + requested : requested;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/gemini/effort.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/gemini/effort.ts tests/gemini/effort.test.ts
git commit -m "feat: implement effort mapping, extraction, and budget calculation"
```

---

### Task 3: Integrate with Request Pipeline

Integrate the logic into `src/main.ts` to construct the request body sent to Gemini.

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: helper functions from `src/gemini/effort`

- [ ] **Step 1: Write integration test**

Add integration assertions in `tests/main.test.ts` if appropriate, or write a dedicated test scenario.

Let's inspect `tests/main.test.ts` or add a scenario directly to mock `fetch` and verify `thinkingConfig` payload is passed correctly.

- [ ] **Step 2: Modify `src/main.ts`**

Import and call helper functions in `src/main.ts`:

```typescript
// Import at top of src/main.ts:
import { extractEffort, mapEffortToThinkingConfig, calculateMaxOutputTokens } from "./gemini/effort";

// Inside handleRequest, replace generationConfig setup:
    const body = rawBody;
    const { messages, system, tools: anthropicTools, max_tokens, temperature, stream, model } = body;
    const requestedModel = model?.trim() || config.defaultGeminiModel;

    const effort = extractEffort(body);
    const thinkingConfig = mapEffortToThinkingConfig(effort);
    const thinkingBudget = thinkingConfig?.thinkingBudget;

    const generationConfig: GeminiGenerationConfig = {
      maxOutputTokens: calculateMaxOutputTokens(max_tokens, thinkingBudget),
    };

    if (thinkingConfig) {
      generationConfig.thinkingConfig = thinkingConfig;
    }

    if (temperature != null) {
      generationConfig.temperature = temperature;
    }
```

- [ ] **Step 3: Run entire test suite**

Run: `bun test`
Expected: PASS with 100% success

- [ ] **Step 4: Commit changes**

```bash
git add src/main.ts
git commit -m "feat: integrate effort to thinkingConfig translation in main request handler"
```
