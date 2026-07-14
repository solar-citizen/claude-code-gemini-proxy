// ---------- Anthropic Messages API shapes (input side) ----------

// Claude Code sends synthetic mid-conversation
// messages (e.g. the Agent tool's available-agent-types block) with
// role: "system", separate from the top-level `system` field. Not in the
// public Anthropic Messages API docs, but real traffic sends it.
type AnthropicRole = "user" | "assistant" | "system";

type AnthropicTextBlock = {
  type: "text";
  text: string;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
};

type AnthropicToolResultContentItem = {
  text?: string;
};

type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content?: string | AnthropicToolResultContentItem[];
};

type AnthropicImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
};

type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
};

type AnthropicDeltaUsage = Pick<AnthropicUsage, "output_tokens">;

// Anthropic adds new content block types over time (thinking,
// redacted_thinking, image, document, server_tool_use, ...). The proxy only
// ever *acts on* text/tool_use/tool_result, so anything else just needs to
// survive validation and gets ignored (with a debug log) in conversion —
// it shouldn't fail the whole request.
type AnthropicUnknownBlock = {
  type: string;
};

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock
  | AnthropicUnknownBlock;

type AnthropicMessage = {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
};

type AnthropicSystemBlock = {
  text?: string;
};

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema?: GeminiSchema;
};

type AnthropicMessagesRequestBody = {
  messages?: AnthropicMessage[];
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicTool[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  model?: string;
};

// ---------- Gemini shapes (output/input to Gemini) ----------

// Recursive JSON-schema-ish shape, restricted to what sanitizeSchemaForGemini keeps.
// The `GeminiSchema[]` arm lets sanitizeSchemaForGemini return a mapped array
type GeminiSchema =
  | {
      type?: string;
      format?: string;
      description?: string;
      nullable?: boolean;
      enum?: string[];
      items?: GeminiSchema;
      properties?: Record<string, GeminiSchema>;
      required?: string[];
      minItems?: number;
      maxItems?: number;
    }
  | GeminiSchema[]
  | Record<string, unknown>;

type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: GeminiSchema;
};

type GeminiToolDeclaration = {
  functionDeclarations: GeminiFunctionDeclaration[];
};

type GeminiFunctionCallPart = {
  functionCall: { name: string; args: Record<string, unknown> };
  thoughtSignature: string;
};

type GeminiFunctionResponsePart = {
  functionResponse: { name: string; response: { content: string } };
};

type GeminiTextPart = {
  text: string;
};

type GeminiPart = 
  | GeminiTextPart 
  | GeminiFunctionCallPart 
  | GeminiFunctionResponsePart 
  | GeminiInlineDataPart;

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiGenerationConfig = {
  maxOutputTokens: number;
  temperature?: number;
};

type GeminiRequestBody = {
  contents: GeminiContent[];
  generationConfig: GeminiGenerationConfig;
  systemInstruction?: { parts: [{ text: string }] };
  tools?: GeminiToolDeclaration[];
};

// Shape of the parts we actually read back off a Gemini response. The response
// itself comes back from callGemini as `unknown` and must be narrowed
// before any of these fields are read.
type GeminiResponsePart = {
  text?: string;
  thought?: boolean;
  functionCall?: { 
    name: string; 
    args?: Record<string, unknown>
  };
  thoughtSignature?: string;
};

type GeminiApiCandidate = {
  content?: {
    parts?: GeminiResponsePart[];
  };
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
};

type GeminiApiResponse = {
  candidates?: GeminiApiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
};

type GeminiInlineDataPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

// ---------- Agent types ----------

type AgentType =
  | "claude"
  | "claude-code-guide"
  | "Explore"
  | "general-purpose"
  | "Plan"
  | "statusline-setup";

// ---------- Anthropic output shapes (what we send back) ----------

type AnthropicOutputBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

// ---------- Proxy-specific ----------

type ProxyUsageMetrics = AnthropicUsage & {
  cached_tokens: number;
};