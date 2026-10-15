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

export function formatResponseModel(model: string, effort?: string): string {
  if (!effort) return model;
  return `${model} (effort: ${effort})`;
}
