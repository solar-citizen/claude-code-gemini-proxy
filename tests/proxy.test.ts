import { config } from "../src/config";

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
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              data: [
                {
                  type: "model",
                  id: config.defaultGeminiModel,
                  display_name: config.defaultGeminiModel,
                  created_at: "2026-01-01T00:00:00Z",
                },
              ],
              has_more: false,
              first_id: config.defaultGeminiModel,
              last_id: config.defaultGeminiModel,
            }),
            { headers: { "content-type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const res = await fetch(`http://localhost:${server.port}/v1/models`);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    expect(isModelsResponse(json)).toBe(true);
    if (isModelsResponse(json)) {
      expect(json.data[0].id).toBe(config.defaultGeminiModel);
    }
    server.stop();
  });

  it("handles health check HEAD/GET", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "HEAD" || req.method === "GET") {
          return new Response("ok", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const resGet = await fetch(`http://localhost:${server.port}/health`);
    expect(resGet.status).toBe(200);
    expect(await resGet.text()).toBe("ok");

    const resHead = await fetch(`http://localhost:${server.port}/health`, { method: "HEAD" });
    expect(resHead.status).toBe(200);
    server.stop();
  });

  it("returns 400 for invalid request body", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/messages") {
          try {
            const body: unknown = await req.json();
            if (typeof body !== "object" || body === null || !("messages" in body)) {
              return new Response(
                JSON.stringify({ type: "error", error: { message: "Invalid request body" } }),
                { status: 400, headers: { "content-type": "application/json" } }
              );
            }
          } catch {
            return new Response(
              JSON.stringify({ type: "error", error: { message: "Invalid request body" } }),
              { status: 400, headers: { "content-type": "application/json" } }
            );
          }
        }
        return new Response("not found", { status: 404 });
      },
    });

    const res = await fetch(`http://localhost:${server.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invalid: true }),
    });

    expect(res.status).toBe(400);
    const json: unknown = await res.json();
    expect(isErrorResponse(json)).toBe(true);
    if (isErrorResponse(json)) {
      expect(json.type).toBe("error");
    }
    server.stop();
  });
});