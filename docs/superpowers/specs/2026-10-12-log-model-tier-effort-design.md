# Design: Include Model, Effort, and Tier in Completion Log

## Overview
Enhance the completion log message in `src/main.ts` so that on standard log levels (`LOG_LEVEL=2`), the console output and file summary show the model (annotated with effort, if present) and the routed tier without requiring verbose payload dumps (`LOG_LEVEL=3`).

## Context & Motivation
Currently, on `LOG_LEVEL=2`, `src/utils/logger.util.ts` only logs the message string (`[info] POST /v1/messages -> end_turn`), while the detailed `data` object containing `tier` and `model` (with effort) is only attached to logs when `LOG_LEVEL=3`. However, `LOG_LEVEL=3` also logs complete request and response bodies via `debugLog()`, resulting in excessive output.

By embedding `[model: ${responseModel}] [tier: ${tier}]` directly into the info message string, users on `LOG_LEVEL=2` can immediately monitor effort level and tier routing without spam.

## Specification

### Code Changes
In `src/main.ts`:
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

### Log Output Examples
- Request with effort:
  `[info] POST /v1/messages -> end_turn [model: gemini-3.8-flash[1m] (effort: high)] [tier: sonnet]`
- Request without effort:
  `[info] POST /v1/messages -> end_turn [model: gemini-3.8-flash[1m]] [tier: sonnet]`

## Testing & Verification
- Verify with unit and integration test suite (`bun test`).
- Add a test checking the log output format when handling messages requests.
