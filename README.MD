# claude-gemini-proxy

A minimal Anthropic Messages API ↔ Gemini `generateContent` proxy. It lets you run Claude Code against Gemini/Gemma models instead of the Anthropic API, with different models assigned to Claude Code's different quality tiers (opus / sonnet / haiku).

## Setup

Add this function to your shell config (`~/.bashrc` or `~/.zshrc`):

```bash
gemini() {
  unset ANTHROPIC_AUTH_TOKEN
  export CLAUDE_CONFIG_DIR=~/.claude-gemini
  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
  export ANTHROPIC_MODEL="gemma-4-31b-it"
  export ANTHROPIC_DEFAULT_OPUS_MODEL="gemma-4-31b-it"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="gemma-4-31b-it"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="gemini-3.1-flash-lite"
  export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
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
| `gemini-3.1-flash-lite` | Proprietary, fast/cheap, 1M context |
| `gemini-3.5-flash` | Proprietary, stronger reasoning/coding than flash-lite, 1M context |

Swap any tier's env var to any of these to change what handles that tier's requests.

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
  -d '{"model":"gemini-3.1-flash-lite","max_tokens":30,"messages":[{"role":"user","content":"Reply with exactly: FLASH_OK"}]}' | jq
```

Expect `"text": "FLASH_OK"` and `"model": "gemini-3.1-flash-lite"` in the response, with real (non-zero) `usage` numbers.

Don't rely on `/v1/models` to verify routing — it doesn't call Gemini at all, it just echoes back whatever model string it's given. The `/v1/messages` test above is the only one that proves an actual request reached the model.

To confirm tool calls also round-trip correctly (not just plain text), run a real Claude Code session through the `gemini` function and give it a task that requires reading a file:

```
gemini
> read package.json and tell me the main entry point
```
