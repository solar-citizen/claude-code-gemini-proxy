// ---------- Anthropic Messages API shapes (input side) ----------

type AnthropicRole = "user" | "assistant";

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

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

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
};

// ---------- Gemini shapes (output/input to Gemini) ----------

// Recursive JSON-schema-ish shape, restricted to what sanitizeSchemaForGemini keeps.
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

type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart;

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
// itself is treated as the wire-boundary `any` (see callGemini); this interface
// just keeps the code that reads `parts` off it honest instead of implicit-any.
type GeminiResponsePart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  thoughtSignature?: string;
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