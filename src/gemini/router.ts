import { config } from "../config";
import { detectTier } from "./tier";
import type { Tier } from "./rotation";

export type AnthropicSystemBlock = {
  type?: string;
  text?: string;
}

export type AnthropicToolLike = {
  name?: string;
  description?: string;
}

export type AnthropicMessageContentBlock = {
  type?: string;
  text?: string;
}

export type AnthropicMessageLike = {
  role?: string;
  content?: string | AnthropicMessageContentBlock[];
}

export type RoutingParams = {
  model?: string;
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicToolLike[];
  messages?: AnthropicMessageLike[];
}

function extractSystemText(system?: string | AnthropicSystemBlock[]): string {
  if (typeof system === "string") {
    return system.toLowerCase();
  }

  if (Array.isArray(system)) {
    return system
      .map((block) => (typeof block === "string" ? block : block?.text ?? ""))
      .join("\n")
      .toLowerCase();
  }

  return "";
}

function extractMessagesText(messages?: AnthropicMessageLike[]): string {
  if (!Array.isArray(messages)) {
    return "";
  }

  return messages
    .map(({ content }) => {
      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
        return content.map((b) => b?.text ?? "").join("\n");
      }

      return "";
    })
    .join("\n")
    .toLowerCase();
}

export function routeRequest({ model, system, tools, messages }: RoutingParams): Tier {
  const defaultTier = detectTier(model);

  if (!config.enableAutoSubagentRouting) {
    return defaultTier;
  }

  const systemText = extractSystemText(system);
  const messagesText = extractMessagesText(messages);
  const combinedText = `${systemText}\n${messagesText}`;

  // 1. Check for explicit Planning / Architectural context
  // Plan agents and planning tools must NOT be downgraded to Haiku even if they only use read tools
  const isPlanningContext =
    systemText.includes("software architect") ||
    systemText.includes("plan agent") ||
    systemText.includes("agent type: plan") ||
    combinedText.includes("superpowers:brainstorming") ||
    combinedText.includes("superpowers:writing-plans") ||
    combinedText.includes("designing implementation plans");

  if (isPlanningContext) {
    return defaultTier;
  }

  // 2. Check for subagent pattern matches in system prompt or messages (Haiku routing)
  const isHaikuSubagent = config.haikuSubagentPatterns.some((pattern) =>
    combinedText.includes(pattern.toLowerCase())
  );

  if (isHaikuSubagent) {
    return "haiku";
  }

  // 3. Check for tool-based pattern match (Read-only search without write tools)
  const toolNames = (tools || []).map((t) => t?.name || "");
  const hasWriteTools = toolNames.some((name) =>
    ["Write", "Edit", "NotebookEdit"].includes(name)
  );
  const hasHaikuTools = toolNames.some((name) =>
    config.forceHaikuTools.map((t) => t.toLowerCase()).includes(name.toLowerCase())
  );

  if (hasHaikuTools && !hasWriteTools) {
    return "haiku";
  }

  return defaultTier;
}
