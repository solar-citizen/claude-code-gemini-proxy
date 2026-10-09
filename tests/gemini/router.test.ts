import { routeRequest } from "../../src/gemini/router";
import { config } from "../../src/config";
import { detectTier } from "../../src/gemini/tier";

describe("routeRequest", () => {
  const originalEnableAutoSubagentRouting = config.enableAutoSubagentRouting;

  afterEach(() => {
    config.enableAutoSubagentRouting = originalEnableAutoSubagentRouting;
  });

  describe("standard model-based routing (no subagent patterns or tools)", () => {
    it("routes to default tier based on detectTier when no subagent patterns match", () => {
      expect(routeRequest({ model: "gemini-3.6-flash", system: "You are a general assistant" })).toBe(
        detectTier("gemini-3.6-flash")
      );
      expect(routeRequest({ model: "gemini-3.5-flash-lite" })).toBe(
        detectTier("gemini-3.5-flash-lite")
      );
      expect(routeRequest({ model: "unknown-model" })).toBe("sonnet");
    });

    it("handles undefined or empty model", () => {
      expect(routeRequest({})).toBe("sonnet");
    });
  });

  describe("system prompt pattern matching (Haiku subagent routing)", () => {
    it("routes Explore / Read-Only subagents with string system prompt to haiku", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "You are a read-only search agent for broad fan-out searches.",
        })
      ).toBe("haiku");

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "You are an explore agent for codebases.",
        })
      ).toBe("haiku");
    });

    it("routes implementation subagents with string system prompt to haiku", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "Executing subagent-driven-development plan.",
        })
      ).toBe("haiku");

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "This is an implementation plan step.",
        })
      ).toBe("haiku");
    });

    it("routes subagents with array of system blocks to haiku", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: [
            { type: "text", text: "You are an AI assistant." },
            { type: "text", text: "Role: explore agent" },
          ],
        })
      ).toBe("haiku");

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: [
            { text: "Some prefix" },
            { text: "subagent-driven-development in progress" },
          ],
        })
      ).toBe("haiku");
    });

    it("matches patterns case-insensitively", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "READ-ONLY SEARCH AGENT",
        })
      ).toBe("haiku");
    });
  });

  describe("tool-based routing", () => {
    it("routes to haiku when request tools contain forcing tools and no write tools", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          tools: [{ name: "Read" }, { name: "Grep" }, { name: "Glob" }],
        })
      ).toBe("haiku");

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          tools: [{ name: "read" }],
        })
      ).toBe("haiku");
    });

    it("falls back to default tier when write tools are present alongside forcing tools", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          tools: [{ name: "Read" }, { name: "Write" }],
        })
      ).toBe(detectTier("gemini-3.6-flash"));

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          tools: [{ name: "Read" }, { name: "Edit" }],
        })
      ).toBe(detectTier("gemini-3.6-flash"));

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          tools: [{ name: "Read" }, { name: "NotebookEdit" }],
        })
      ).toBe(detectTier("gemini-3.6-flash"));
    });

    it("prioritizes system prompt match even if write tools are present", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "subagent-driven-development",
          tools: [{ name: "Write" }],
        })
      ).toBe("haiku");
    });
  });

  describe("planning context protection", () => {
    it("does not downgrade Plan / Software Architect requests to Haiku even with read-only tools", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "You are a software architect agent for designing implementation plans.",
          tools: [{ name: "Read" }, { name: "Grep" }],
        })
      ).toBe("opus");

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "You are the Plan agent. Design the architecture.",
          tools: [{ name: "Read" }],
        })
      ).toBe("opus");

      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "General session instructions",
          messages: [{ role: "user", content: "Using superpowers:writing-plans to design the architecture" }],
          tools: [{ name: "Read" }],
        })
      ).toBe("opus");
    });
  });

  describe("message content pattern matching", () => {
    it("routes subagent instructions in message content to haiku", () => {
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          messages: [
            {
              role: "user",
              content: "You are an implementer subagent executing subagent-driven-development tasks.",
            },
          ],
          tools: [{ name: "Write" }],
        })
      ).toBe("haiku");
    });
  });

  describe("config.enableAutoSubagentRouting flag", () => {
    it("falls back to model default tier when enableAutoSubagentRouting is false", () => {
      config.enableAutoSubagentRouting = false;

      // System prompt match should be ignored
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          system: "You are a read-only search agent.",
        })
      ).toBe(detectTier("gemini-3.6-flash"));

      // Tool match should be ignored
      expect(
        routeRequest({
          model: "gemini-3.6-flash",
          tools: [{ name: "Read" }, { name: "Grep" }],
        })
      ).toBe(detectTier("gemini-3.6-flash"));
    });
  });
});
