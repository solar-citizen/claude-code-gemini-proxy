# Claude Code `/effort` Translation to Gemini `thinkingConfig` Design

## 1. Overview & Goal

When a user in Claude Code configures or changes reasoning effort (using `/effort` or per-subagent/task effort settings), Claude Code sends an `output_config` object containing an `effort` level (`low`, `medium`, `high`, `xhigh`, `max`).

Currently, this proxy ignores `output_config` and drops Gemini's `thought` blocks. As a result, Gemini always operates with its default thinking behavior rather than respecting the requested effort level.

This design specifies how the proxy:
1. Extracts `output_config.effort` from both the top-level request body and synthetic mid-conversation system messages.
2. Maps each effort tier to a corresponding Gemini `thinkingBudget` (in tokens).
3. Adjusts `generationConfig.maxOutputTokens` dynamically so thinking tokens do not starve the response budget.
4. Preserves backward compatibility when no effort is requested.

---

## 2. Inbound Effort Extraction

Claude Code can supply effort in two places:
1. **Top-Level Request Body**:
   ```json
   {
     "model": "...",
     "messages": [...],
     "output_config": {
       "effort": "high"
     }
   }
   ```
2. **Mid-Conversation Synthetic Message (Beta / Dynamic Effort Switch)**:
   Claude Code may send a synthetic system message mid-session when the user changes effort:
   ```json
   {
     "role": "system",
     "content": [],
     "output_config": {
       "effort": "low"
     }
   }
   ```

**Extraction Priority:**
- Look for `output_config.effort` in `messages` in reverse order (most recent message with `output_config.effort` takes precedence).
- If not present in messages, fallback to top-level `body.output_config?.effort`.

---

## 3. Effort Level to Thinking Budget Mapping

Gemini expects thinking token budget in `generationConfig.thinkingConfig.thinkingBudget`. Active budgets must be at least `1024` tokens.

| Effort Level | Gemini `thinkingBudget` | Suitable Activity & Workload |
| :--- | :--- | :--- |
| **`low`** | 1,024 tokens | **Quick tasks & minor edits**: Simple questions, code formatting, search queries, single-file edits. Fast responses with minimal token usage. |
| **`medium`** | 2,048 tokens | **Standard code reviews & small features**: Reviewing diffs, small refactoring, single-file implementations with unit tests. |
| **`high`** | 8,192 tokens | **Complex features & architecture**: Non-trivial implementation tasks, debugging intricate issues, multi-step code generation. |
| **`xhigh`** | 16,384 tokens | **Long-horizon agentic workflows**: Extensive multi-file refactoring, subagent-driven development, deep root cause debugging. |
| **`max`** | 32,768 tokens | **Frontier problem solving**: Hard algorithms, comprehensive security audits, complete subsystem redesigns. |

If `effort` is missing, undefined, or unrecognized:
- Do not set `thinkingConfig` (let Gemini use its model default behavior).

---

## 4. Headroom & Output Token Adjustment

In the Gemini API, `generationConfig.maxOutputTokens` sets the ceiling for **total output tokens**, which includes *both* thinking tokens and response tokens.

If `thinkingBudget` is set, `maxOutputTokens` is computed as:
```typescript
const requestedTokens = max_tokens ?? 4096;
const totalMaxTokens = thinkingBudget ? thinkingBudget + requestedTokens : requestedTokens;
```
This guarantees that an extensive thinking phase cannot truncate the actual code or tool response.

---

## 5. Types and Interface Updates

### Global Definitions (`global.d.ts`)
```typescript
type AnthropicOutputConfig = {
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | string;
};

// Update AnthropicMessage
type AnthropicMessage = {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
  output_config?: AnthropicOutputConfig;
};

// Update AnthropicMessagesRequestBody
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

// Update GeminiGenerationConfig
type GeminiThinkingConfig = {
  thinkingBudget?: number;
};

type GeminiGenerationConfig = {
  maxOutputTokens: number;
  temperature?: number;
  thinkingConfig?: GeminiThinkingConfig;
};
```

---

## 6. Implementation Architecture

Create a dedicated module `src/gemini/effort.ts` to keep concerns separated:
- `EFFORT_TO_THINKING_BUDGET`: Token budget lookup map with documentation comments.
- `extractEffort(body: AnthropicMessagesRequestBody): string | undefined`: Resolves effort from messages and body.
- `mapEffortToThinkingConfig(effort?: string): GeminiThinkingConfig | undefined`: Produces the Gemini thinking configuration.
- `calculateMaxOutputTokens(maxTokens: number | undefined, thinkingBudget: number | undefined): number`: Computes total output token headroom.

Use `src/gemini/effort.ts` in `src/main.ts` when building `generationConfig`.
