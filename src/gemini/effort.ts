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

export function translateHarnessGeneration(request: Record<string,unknown>, policy:{max_request_tokens:number;max_upstream_tokens:number}) {
  const tokens=request.max_tokens;
  const thinking=request.thinking, output=request.output_config;
  const exact=(v:unknown,expected:Record<string,string>)=>v!==null&&typeof v==='object'&&!Array.isArray(v)
    &&Object.keys(v).length===Object.keys(expected).length
    &&Object.entries(expected).every(([key,value])=>(v as Record<string,unknown>)[key]===value);
  if(!Number.isSafeInteger(policy.max_request_tokens)||policy.max_request_tokens<1||!Number.isSafeInteger(policy.max_upstream_tokens)||policy.max_upstream_tokens<1
    ||typeof tokens!=='number'||!Number.isSafeInteger(tokens)||tokens<1||tokens>policy.max_request_tokens||tokens>policy.max_upstream_tokens
    ||!exact(thinking,{type:'adaptive',display:'updates'})||!exact(output,{effort:'high'}))throw new Error('unsupported_generation_contract');
  return {version:'claude-adaptive-high-gemini-high-v1',requested:{max_tokens:tokens,thinking,output_config:output},
    generationConfig:{maxOutputTokens:tokens,thinkingConfig:{thinkingLevel:'HIGH' as const}},
    caps:{...policy},presentation:{requested:'updates',effective:'unavailable',degraded:true}};
}
