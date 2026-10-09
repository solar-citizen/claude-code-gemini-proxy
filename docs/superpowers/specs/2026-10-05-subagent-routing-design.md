# Subagent-Aware Dynamic Model Routing Design Specification

## Overview
This specification details the design for implementing **Approach B (Subagent-Aware Model Routing)** in `claude-code-gemini-proxy`. The proxy will intelligently inspect incoming Anthropic API requests (`POST /v1/messages`) and dynamically route them between powerful models (Opus) and faster, lighter models (Haiku/Flash) based on agent type, system prompt inspection, tool usage, and configurable routing rules.

---

## Architecture & Data Flow

1. **Request Inception:** Claude Code sends an API request to `POST /v1/messages`.
2. **Proxy Interception (`src/main.ts`):** 
   - Extracts `model`, `system` prompts, `tools`, and message history.
   - Evaluates the request against the **Hybrid Routing Engine**.
3. **Tier Determination:**
   - **Opus Tier:** High-level planning, brainstorming, primary user conversation, complex reasoning.
   - **Haiku Tier:** Explore agents, read-only search tasks, routine implementation subagents, boilerplate generation.
4. **Upstream Dispatch:** The proxy selects the appropriate Gemini model corresponding to the resolved tier and forwards the request.

---

## Configuration (`src/config.ts`)

Add routing configuration options to `.env` and `src/config.ts`:
- `ENABLE_AUTO_SUBAGENT_ROUTING` (boolean, default: true)
- `HAIKU_SUBAGENT_PATTERNS` (regex / keywords matching system prompts for Explore / implementation subagents)
- `OPUS_PRIMARY_MODEL` / `HAIKU_FALLBACK_MODEL` mappings

---

## Routing Heuristics

The hybrid classifier evaluates incoming requests using:
1. **Explicit Client Header / Model override** (if provided).
2. **System Prompt / Agent Signature Match:**
   - Explore / Search agents (`Read-only search agent`, broad codebase scanning).
   - Implementation subagents (`subagent-driven-development`, execution steps).
3. **Tool Set Heuristics:**
   - Requests with read-only tool sets (e.g. `Grep`, `Glob`, `Read`) and no write capabilities are strong candidates for Haiku.
   - Requests with full tool suites or interactive user prompts default to Opus/Sonnet.

---

## Testing & Validation Strategy
- Unit tests for the routing classifier across various mock Anthropic payloads (Explore agent, Plan agent, Main chat).
- Integration test simulating the transition from planning (Opus) to task execution (Haiku).
- Verification of correct model selection headers in upstream Gemini calls.
