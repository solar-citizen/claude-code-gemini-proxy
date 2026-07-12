Add function to shell.

```bash
gemini() {
  unset ANTHROPIC_AUTH_TOKEN
  export CLAUDE_CONFIG_DIR=~/.claude-gemini
  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
  export ANTHROPIC_MODEL="gemini-3.1-flash-lite"
  export ANTHROPIC_DEFAULT_OPUS_MODEL="gemini-3.1-flash-lite"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="gemini-3.1-flash-lite"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="gemini-3.1-flash-lite"
  export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
  claude "$@"
}
```

Use actual folder here: `export CLAUDE_CONFIG_DIR=~/.claude-gemini`

Now instead of `claude` command run with `gemini`.