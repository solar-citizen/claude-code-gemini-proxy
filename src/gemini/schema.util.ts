const geminiSchemaAllowedKeys = new Set([
  "type", "format", "description", "nullable", "enum",
  "items", "properties", "required", "minItems", "maxItems",
]);

export function sanitizeSchemaForGemini(schema: unknown): GeminiSchema {
  if (schema === null || typeof schema !== "object") {
    return {};
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchemaForGemini);
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!geminiSchemaAllowedKeys.has(key)) {
      continue;
    }

    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => {
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

  return out;
}