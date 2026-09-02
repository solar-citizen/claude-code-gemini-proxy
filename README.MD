# claude-code-gemini-proxy

A minimal Anthropic Messages API ↔ Gemini `generateContent` proxy. It lets you run Claude Code against Gemini/Gemma models instead of the Anthropic API, with different models assigned to Claude Code's different quality tiers (opus / sonnet / haiku).

## Setup

Add this function to your shell config (`~/.bashrc` or `~/.zshrc`):

```bash
gemini() {
  unset ANTHROPIC_AUTH_TOKEN
  export CLAUDE_CONFIG_DIR=~/.claude-gemini
  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787

  # Default fallback model
  export ANTHROPIC_MODEL="gemini-3.5-flash-lite[1m]"

  # Primary coding model (Sonnet tier)
  export ANTHROPIC_DEFAULT_SONNET_MODEL="gemini-3.5-flash[1m]"

  # Heavy reasoning / planning (Opus tier)
  export ANTHROPIC_DEFAULT_OPUS_MODEL="gemini-3.6-flash[1m]"

  # Fast background / sub-agents (Haiku tier)
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="gemini-3.5-flash-lite[1m]"

  # (optional) export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
  # ^ only useful if the proxy ever exposes models under claude*/anthropic* IDs —
  #   currently filtered out of the picker since our model names are gemini-*

  claude "$@"
}
```

Use an actual, existing folder for `CLAUDE_CONFIG_DIR` — this keeps Gemini-routed sessions (history, settings) separate from your normal Claude Code config.

Reload your shell config:

```bash
source ~/.bashrc
# or
source ~/.zshrc
```

Then run `gemini` instead of `claude` to start a Claude Code session routed through this proxy.

## Model routing

Claude Code maps every request to one of three quality tiers, and each tier has its own env var:

| Env var | Claude Code tier | What it's used for |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus | Hardest problems — planning, architecture, tricky bugs |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet | Main coding driver — most day-to-day requests |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku | Cheap/fast ops — quick reads, small edits |
| `ANTHROPIC_MODEL` | — | Fallback default model |

The proxy reads the `model` field on each incoming request and forwards it to the matching Gemini/Gemma model — each tier can point at a different backing model, or all at the same one.

**Current setup** points opus and sonnet at Gemma 4 31B (stronger on coding/agentic benchmarks) and haiku at Gemini 3.1 Flash-Lite (cheaper, faster, larger context — good for lightweight ops).

### Available models

Any model exposed via `generativelanguage.googleapis.com`'s `generateContent` endpoint works, including:

| Model | Notes |
|---|---|
| `gemma-4-31b-it` | Open-weight, dense, 31B params, 256K context, strong coding/agentic benchmarks |
| `gemini-3.1-flash-lite` | Proprietary, fast/cheap, 1M context, Jan 2025 knowledge cutoff |
| `gemini-3.5-flash-lite` | Proprietary, high-volume/low-latency tier, 1M context, sizeable jump over 3.1 Flash-Lite on coding and agentic benchmarks |
| `gemini-3.6-flash` | Proprietary, current default workhorse model, 1M context, stronger coding/agentic/computer-use than 3.5 Flash, ~17% fewer output tokens, Mar 2026 knowledge cutoff |
| `gemini-3.5-flash` | Proprietary, predecessor to 3.6 Flash, 1M context, still available but superseded as the default workhorse |

Swap any tier's env var to any of these to change what handles that tier's requests.

## Multiple Keys & Model Rotation

> [!WARNING]
> **Legal Disclaimer / Notice:**
> While this proxy technically supports rotating between many different API keys, using multiple keys or accounts to circumvent rate limits or daily quotas is strictly prohibited by Google's Terms of Service. We strongly recommend using the `default` mode with a single API key (`1 key x models` combination) to ensure full compliance with Google's API policies.

You can configure the proxy to rotate across multiple API keys and fallback models automatically. Configure this in your `.env` file (copied from `.env.example`):

```env
# Supply multiple keys separated by commas
GEMINI_API_KEYS="key1,key2,key3"

# Define ordered fallback models for each tier.
# Include Claude's [1m] suffix so it uses the 1M context window.
HAIKU_MODELS="gemini-3.5-flash-lite[1m],gemini-3.1-flash-lite[1m]"
SONNET_MODELS="gemini-3.7-flash[1m],gemini-3.6-flash[1m],gemini-3.5-flash[1m]"
OPUS_MODELS=""

# Optional: Rotation mode ("default" or "rotation")
# default  -> Uses only the 1st key, but enables model failover within tier
# rotation -> Rotates through all API keys and models for each tier
ROTATION_MODE="default"

# Optional: Cooldown in seconds for a failed key/model combination (default: 60)
ROTATION_COOLDOWN_SECONDS=60
```

### Rotation Modes

The proxy supports two modes configured via `ROTATION_MODE`:

1. **`default` mode (`ROTATION_MODE="default"`):**
   - Uses **only the first API key** (`GEMINI_API_KEY` or `GEMINI_API_KEYS[0]`).
   - Uses all models configured for the target tier in sequence (`HAIKU_MODELS`, `SONNET_MODELS`, `OPUS_MODELS`).
   - If model A rate-limits, it falls back to model B using the first API key. Subsequent keys are not used.

2. **`rotation` mode (`ROTATION_MODE="rotation"`):**
   - Rotates across **all API keys** and **all tier models**.
   - If you have 2 keys and 2 Haiku models (`A, B`), the sequence is:
     1. `KEY1 + A`
     2. `KEY1 + B`
     3. `KEY2 + A`
     4. `KEY2 + B`

**Important Guarantees:**
- **Sequential Failover:** Requests are retried sequentially. There is no background request spam.
- **Cooldowns:** Rate-limited (e.g. 429) or temporarily failing combinations enter a cooldown period. Healthy combinations are preferred over those in cooldown.
- **Temporary State:** Cooldown state is temporary and clears automatically when expired or upon success.
- **Strict Tier Boundaries:** Tiers *never* cross-fallback into one another. A failed Haiku request will never fall back to a Sonnet model. Only the models defined for that specific tier are used.

## Verifying it's working

The proxy must actually be running (`bun run src/main.ts`) and listening on port 8787 before testing.

Send a non-streaming request directly, bypassing Claude Code, to confirm a specific model is actually being hit:

### Gemma
```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "content-type: application/json" \
  -d '{"model":"gemma-4-31b-it","max_tokens":300,"messages":[{"role":"user","content":"Reply with exactly: GEMMA_OK"}]}' | jq
```

Expect `"text": "GEMMA_OK"` and `"model": "gemma-4-31b-it"` in the response, with real (non-zero) `usage` numbers.

### Flash-Lite
```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "content-type: application/json" \
  -d '{"model":"gemini-3.5-flash-lite","max_tokens":30,"messages":[{"role":"user","content":"Reply with exactly: FLASH_LITE_OK"}]}' | jq
```

Expect `"text": "FLASH_LITE_OK"` and `"model": "gemini-3.5-flash-lite"` in the response, with real (non-zero) `usage` numbers.

### Flash
```bash
curl -s http://127.0.0.1:8787/v1/messages \
  -H "content-type: application/json" \
  -d '{"model":"gemini-3.6-flash","max_tokens":30,"messages":[{"role":"user","content":"Reply with exactly: FLASH_OK"}]}' | jq
```

Expect `"text": "FLASH_OK"` and `"model": "gemini-3.6-flash"` in the response, with real (non-zero) `usage` numbers.

Don't rely on `/v1/models` to verify routing — it doesn't call Gemini at all, it just echoes back whatever model string it's given. The `/v1/messages` test above is the only one that proves an actual request reached the model.

To confirm tool calls also round-trip correctly (not just plain text), run a real Claude Code session through the `gemini` function and give it a task that requires reading a file:

```
gemini
> read package.json and tell me the main entry point
```
