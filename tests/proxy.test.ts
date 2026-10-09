import { config } from "../src/config";
import { handleRequest } from "../src/main";
import { rotationManager } from "../src/gemini/rotation-instance";
import { describe, it, expect, spyOn } from "bun:test";

type ErrorResponse = {
  type: "error";
  error: { message: string };
};

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("type" in value) || value.type !== "error") {
    return false;
  }

  if (!("error" in value) || typeof value.error !== "object" || value.error === null) {
    return false;
  }

  if (!("message" in value.error)) {
    return false;
  }

  return typeof value.error.message === "string";
}

function isModelsResponse(value: unknown): value is { data: Array<{ id: string }> } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("data" in value) || !Array.isArray(value.data)) {
    return false;
  }

  return value.data.every((model): model is { id: string } => {
    if (typeof model !== "object" || model === null) {
      return false;
    }
    return "id" in model && typeof model.id === "string";
  });
}

describe("Proxy Server Integration", () => {
  it("handles GET /v1/models successfully", async () => {
    const req = new Request("http://localhost:8787/v1/models", {
      method: "GET",
    });

    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    expect(isModelsResponse(json)).toBe(true);
    if (isModelsResponse(json)) {
      const modelIds = json.data.map(({ id }) => id);
      expect(modelIds).toContain(config.defaultGeminiModel);
    }
  });

  it("handles health check HEAD/GET", async () => {
    const reqGet = new Request("http://localhost:8787/health", { method: "GET" });
    const resGet = await handleRequest(reqGet);
    expect(resGet.status).toBe(200);
    expect(await resGet.text()).toBe("ok");

    const reqHead = new Request("http://localhost:8787/health", { method: "HEAD" });
    const resHead = await handleRequest(reqHead);
    expect(resHead.status).toBe(200);
  });

  it("returns 400 for invalid JSON on POST /v1/messages", async () => {
    const req = new Request("http://localhost:8787/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "invalid-json",
    });

    const res = await handleRequest(req);
    expect(res.status).toBe(400);
    const json: unknown = await res.json();
    expect(isErrorResponse(json)).toBe(true);
    if (isErrorResponse(json)) {
      expect(json.error.message).toBe("Invalid JSON in request body");
    }
  });

  it("returns 400 for invalid request body schema", async () => {
    const req = new Request("http://localhost:8787/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invalid: true }),
    });

    const res = await handleRequest(req);
    expect(res.status).toBe(400);
    const json: unknown = await res.json();
    expect(isErrorResponse(json)).toBe(true);
    if (isErrorResponse(json)) {
      expect(json.type).toBe("error");
    }
  });

  it("returns 404 for unknown endpoints", async () => {
    const req = new Request("http://localhost:8787/unknown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await handleRequest(req);
    expect(res.status).toBe(404);
  });

  it("routes request with subagent system prompt to haiku tier in /v1/messages", async () => {
    let capturedTier: string | undefined;
    const spy = spyOn(rotationManager, "executeWithRotation").mockImplementation(async (tier, _fn) => {
      capturedTier = tier;
      return {
        response: new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Hello from mock gemini" }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 15,
              candidatesTokenCount: 10,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
        model: "gemini-2.5-flash",
      };
    });

    try {
      const req = new Request("http://localhost:8787/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          system: "You are a read-only search agent for broad fan-out searches.",
          messages: [{ role: "user", content: "Find files" }],
        }),
      });

      const res = await handleRequest(req);
      expect(res.status).toBe(200);
      expect(capturedTier).toBe("haiku");
    } finally {
      spy.mockRestore();
    }
  });

  it("routes standard request to default model tier in /v1/messages", async () => {
    let capturedTier: string | undefined;
    const spy = spyOn(rotationManager, "executeWithRotation").mockImplementation(async (tier, _fn) => {
      capturedTier = tier;
      return {
        response: new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Hello from mock gemini" }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 15,
              candidatesTokenCount: 10,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
        model: "gemini-2.5-flash",
      };
    });

    try {
      const req = new Request("http://localhost:8787/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const res = await handleRequest(req);
      expect(res.status).toBe(200);
      expect(capturedTier).toBe("sonnet");
    } finally {
      spy.mockRestore();
    }
  });

  it("passes thinkingConfig and adjusted maxOutputTokens when output_config.effort is set", async () => {
    let capturedRequestBody: GeminiRequestBody | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com")) {
        capturedRequestBody = JSON.parse(init?.body as string) as GeminiRequestBody;
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    };

    try {
      const req = new Request("http://localhost:8787/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Think hard" }],
          max_tokens: 2000,
          output_config: { effort: "high" },
        }),
      });

      const res = await handleRequest(req);
      expect(res.status).toBe(200);
      expect(capturedRequestBody?.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 8192 });
      expect(capturedRequestBody?.generationConfig.maxOutputTokens).toBe(8192 + 2000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

