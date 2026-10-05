import { config } from "../config";
import { detectTier } from "./tier";
import type { Tier } from "./rotation";

export interface RoutingParams {
  model?: string;
  system?: any; // String or Array of System Blocks
  tools?: any[];
}

export function routeRequest({ model, system, tools }: RoutingParams): Tier {
  const defaultTier = detectTier(model);

  if (!config.enableAutoSubagentRouting) {
    return defaultTier;
  }

  // 1. Extract plain-text system prompt
  let systemText = "";
  if (typeof system === "string") {
    systemText = system.toLowerCase();
  } else if (Array.isArray(system)) {
    systemText = system
      .map((block: any) => (typeof block === "string" ? block : block?.text ?? ""))
      .join("\n")
      .toLowerCase();
  }

  // 2. Check for system prompt pattern match (Haiku routing)
  const isHaikuSubagent = config.haikuSubagentPatterns.some((pattern) =>
    systemText.includes(pattern.toLowerCase())
  );

  if (isHaikuSubagent) {
    return "haiku";
  }

  // 3. Check for tool-based pattern match
  const toolNames = (tools || []).map((t: any) => t?.name || "");
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
