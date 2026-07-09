/**
 * gemini-proxy.ts — minimal Anthropic Messages API <-> Gemini generateContent proxy
 * preserves Gemini 3.x thoughtSignature across tool-call round trips
 */

import { mkdirSync, statSync, renameSync, appendFile } from "fs";
import { join } from "path";
import { getErrorMessage } from "./error.util";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const PORT = Number(process.env.PORT ?? 8787);
const LOG_DEBUG = process.env.GEMINI_PROXY_DEBUG === "1";

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}

// ---------- logging ----------
// Batched + size-capped so normal use doesn't hammer the disk with one write
// per request. Concise one-liners by default; full bodies only under DEBUG.
const LOG_DIR = join(import.meta.dir, "logs");
mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, `proxy-${new Date().toISOString().slice(0, 10)}.log`);
const LOG_MAX_BYTES = 5_242_880;
const LOG_FLUSH_MS = 2_000;

let logBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function rotateIfNeeded() {
  try {
    const { size } = statSync(LOG_FILE);

    if (size > LOG_MAX_BYTES) {
      renameSync(LOG_FILE, LOG_FILE.replace(/\.log$/, `.${Date.now()}.log`));
    }
  } catch {
    // file doesn't exist yet
  }
}

function flushLogs() {
  flushTimer = null;
  
  if (logBuffer.length === 0) {
    return;
  }

  rotateIfNeeded();
  const chunk = logBuffer.join("");
  logBuffer = [];

  appendFile(LOG_FILE, chunk, (err: NodeJS.ErrnoException | null) => {
    if (err) {
      console.error("log write failed:", getErrorMessage(err));
    }
  });
}

function log(level: "info" | "error", msg: string, data?: unknown) {
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg,
  };

  if (data !== undefined) {
    entry.data = data;
  }

  logBuffer.push(JSON.stringify(entry) + "\n");

  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, LOG_FLUSH_MS);
  }

  console.log(`[${level}] ${msg}`);
}

function debugLog(msg: string, data?: unknown) {
  if (LOG_DEBUG) {
    log("info", msg, data);
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    flushLogs();
    process.exit(0);
  });
}

// ---------- schema sanitizer ----------
const GEMINI_SCHEMA_ALLOWED_KEYS = new Set([
  "type", "format", "description", "nullable", "enum",
  "items", "properties", "required", "minItems", "maxItems",
]);

function sanitizeSchemaForGemini(schema: unknown): GeminiSchema {
  if (schema === null || typeof schema !== "object") {
    return schema as GeminiSchema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchemaForGemini) as unknown as GeminiSchema;
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_ALLOWED_KEYS.has(key)) {
      continue;
    }

    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => {
          return [k, sanitizeSchemaForGemini(v)];
        }),
      );
    } else if (key === "items") {
      out.items = sanitizeSchemaForGemini(value);
    } else {
      out[key] = value;
    }
  }

  if (!out.type && out.properties) {
    out.type = "object";
  }

  return out as GeminiSchema;
}

// tool_use id -> { name, signature }
const toolCallMeta = new Map<string, { name: string; signature: string }>();

function anthropicToolsToGemini(tools: AnthropicTool[] | undefined): GeminiToolDeclaration[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  
  return [{
    functionDeclarations: tools.map(({ name, description, input_schema }) => {
      return {
        name,
        description: description ?? "",
        parameters: sanitizeSchemaForGemini(input_schema ?? { type: "object", properties: {} }),
      };
    }),
  }];
}

function anthropicMessagesToGeminiContents(messages: AnthropicMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const { role: rawRole, content } of messages) {
    const role = rawRole === "assistant" ? "model" : "user";
    const blocks: AnthropicContentBlock[] = Array.isArray(content)
      ? content
      : [{ type: "text", text: content }];
    const parts: GeminiPart[] = [];

    for (const block of blocks) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        parts.push({
          functionCall: { name: block.name, args: block.input ?? {} },
          thoughtSignature: toolCallMeta.get(block.id)?.signature ?? "skip_thought_signature_validator",
        });
      } else if (block.type === "tool_result") {
        const contentText = Array.isArray(block.content)
          ? block.content.map(({ text }) => text ?? "").join("\n")
          : String(block.content ?? "");

        parts.push({
          functionResponse: {
            name: toolCallMeta.get(block.tool_use_id)?.name ?? "unknown_function",
            response: { content: contentText },
          },
        });
      }
    }
    contents.push({ role, parts });
  }

  return contents;
}

function geminiPartsToAnthropicBlocks(parts: GeminiResponsePart[]): AnthropicOutputBlock[] {
  const blocks: AnthropicOutputBlock[] = [];

  for (const part of parts) {
    const { text, functionCall } = part;
    if (text) {
      blocks.push({ type: "text", text });
    } else if (functionCall) {
      const id = "toolu_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);

      toolCallMeta.set(id, {
        name: functionCall.name,
        signature: part.thoughtSignature ?? "skip_thought_signature_validator",
      });

      blocks.push({
        type: "tool_use",
        id,
        name: functionCall.name,
        input: functionCall.args ?? {},
      });
    }
  }

  return blocks;
}

// callGemini's return value is the one Gemini-side wire-boundary `any` the
// conventions call out: an external, loosely-typed API response we don't
// fully model. Everything downstream narrows it explicitly before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callGemini(body: GeminiRequestBody): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildSseStream(blocks: AnthropicOutputBlock[], stopReason: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const push = (s: string) => controller.enqueue(encoder.encode(s));

      push(sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_" + crypto.randomUUID(),
          type: "message",
          role: "assistant",
          content: [],
          model: GEMINI_MODEL,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));

      blocks.forEach((block, i) => {
        const { type } = block;
        
        if (type === "text") {
          push(sseEvent("content_block_start", {
            type: "content_block_start",
            index: i,
            content_block: { type: "text", text: "" },
          }));

          push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: i,
            delta: { type: "text_delta", text: block.text },
          }));
        } else if (type === "tool_use") {
          push(sseEvent("content_block_start", {
            type: "content_block_start",
            index: i,
            content_block: {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: {},
            },
          }));

          push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: i,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify(block.input),
            },
          }));
        }

        push(sseEvent("content_block_stop", {
          type: "content_block_stop",
          index: i,
        }));
      });

      push(sseEvent("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
        },
        usage: { output_tokens: 0 },
      }));

      push(sseEvent("message_stop", { type: "message_stop" }));

      controller.close();
    },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const start = Date.now();
    const { method } = req;
    const { pathname } = new URL(req.url);

    try {
      if (pathname === "/v1/models") {
        const responseData = {
          data: [{
            type: "model",
            id: GEMINI_MODEL,
            display_name: GEMINI_MODEL,
            created_at: "2026-01-01T00:00:00Z",
          }],
          has_more: false,
          first_id: GEMINI_MODEL,
          last_id: GEMINI_MODEL,
        };
        return new Response(JSON.stringify(responseData), {
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "HEAD" || method === "GET") {
        return new Response("ok", { status: 200 });
      }

      if (method !== "POST" || !pathname.endsWith("/v1/messages")) {
        return new Response("not found", { status: 404 });
      }

      // Wire-boundary `any`, per convention: req.json() on the Anthropic side.
      const body = (await req.json()) as AnthropicMessagesRequestBody;
      debugLog("request body", body);

      const generationConfig: GeminiGenerationConfig = {
        maxOutputTokens: body.max_tokens ?? 4096,
      };
      if (body.temperature != null) {
        generationConfig.temperature = body.temperature;
      }
      const tools = anthropicToolsToGemini(body.tools);

      const geminiBody: GeminiRequestBody = {
        contents: anthropicMessagesToGeminiContents(body.messages ?? []),
        generationConfig,
        ...(body.system ? {
          systemInstruction: {
            parts: [{ text: Array.isArray(body.system) ? body.system.map((b) => b.text ?? "").join("\n") : body.system }],
          },
        } : {}),
        ...(tools ? { tools } : {}),
      };

      const geminiRes = await callGemini(geminiBody);
      debugLog("gemini response", geminiRes);

      const candidate = geminiRes.candidates?.[0];
      const parts: GeminiResponsePart[] = candidate?.content?.parts ?? [];
      const blocks = geminiPartsToAnthropicBlocks(parts);
      const stopReason = blocks.some((b) => {
        return b.type === "tool_use";
      }) ? "tool_use" : "end_turn";

      log("info", `${method} ${pathname} -> ${stopReason}`, {
        ms: Date.now() - start,
        toolCalls: blocks.filter((block): block is Extract<AnthropicOutputBlock, { type: "tool_use" }> => {
          return block.type === "tool_use";
        }).map(({ name }) => name),
      });

      if (body.stream) {
        return new Response(buildSseStream(blocks, stopReason), {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" },
        });
      }

      const responseBody = {
        id: "msg_" + crypto.randomUUID(),
        type: "message",
        role: "assistant",
        content: blocks,
        model: GEMINI_MODEL,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };

      return new Response(JSON.stringify(responseBody), {
        headers: { "content-type": "application/json" },
      });

    } catch (err: unknown) {
      const message = getErrorMessage(err);
      const stack = err instanceof Error ? err.stack : undefined;
      log("error", "request failed", { message, stack, ms: Date.now() - start });
      const errorResponse = {
        type: "error",
        error: { message },
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
});

console.log(`Gemini<->Anthropic proxy listening on http://127.0.0.1:${PORT}`);
console.log(`Logs: ${LOG_FILE}${LOG_DEBUG ? " (debug mode: full bodies logged)" : ""}`);
