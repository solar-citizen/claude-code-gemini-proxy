import { isRecord, isStringArray } from "../utils/common.util";

const geminiSchemaAllowedKeys = new Set([
  "type", "format", "description", "nullable", "enum",
  "items", "properties", "required", "minItems", "maxItems",
]);

function sanitizeSchemaObject(schema: Record<string, unknown>): GeminiSchema {
  let source: Record<string, unknown> = { ...schema };

  const polyVariants = Array.isArray(source.anyOf)
    ? source.anyOf
    : Array.isArray(source.oneOf)
      ? source.oneOf
      : null;

  if (polyVariants) {
    const hasNull = polyVariants.some((v) => isRecord(v) && v.type === "null");
    if (hasNull) source.nullable = true;

    const primary = polyVariants.find((v) => isRecord(v) && v.type !== "null");
    if (isRecord(primary)) {
      source = { ...primary, ...source };
    }
  }

  if (Array.isArray(source.allOf)) {
    for (const sub of source.allOf) {
      if (!isRecord(sub)) continue;

      if (isRecord(sub.properties)) {
        source.properties = {
          ...(isRecord(source.properties) ? source.properties : {}),
          ...sub.properties,
        };
      }

      if (isStringArray(sub.required)) {
        source.required = [
          ...(isStringArray(source.required) ? source.required : []),
          ...sub.required,
        ];
      }

      if (!source.type && sub.type) {
        source.type = sub.type;
      }
    }
  }

  if (Array.isArray(source.type)) {
    const types = source.type.filter((t): t is string => typeof t === "string");
    if (types.includes("null")) source.nullable = true;
    source.type = types.find((t) => t !== "null") ?? "string";
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!geminiSchemaAllowedKeys.has(key)) continue;

    if (key === "type" && typeof value === "string") {
      out.type = value.toLowerCase();
    } else if (key === "properties" && isRecord(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, sanitizeSchemaForGemini(v)]),
      );
    } else if (key === "items") {
      if (Array.isArray(value)) {
        out.items = value.length > 0 ? sanitizeSchemaForGemini(value[0]) : { type: "string" };
      } else if (isRecord(value)) {
        out.items = sanitizeSchemaObject(value);
      } else {
        out.items = { type: "string" };
      }
    } else if (key === "enum" && Array.isArray(value)) {
      out.enum = value.map(String);
    } else {
      out[key] = value;
    }
  }

  if (!out.type) {
    if (out.properties) out.type = "object";
    else if (out.items) out.type = "array";
  }

  if (out.type === "array") {
    const itemsIsEmpty = isRecord(out.items) && Object.keys(out.items).length === 0;

    if (!out.items || itemsIsEmpty) {
      out.items = { type: "string" };
    } else if (Array.isArray(out.items)) {
      out.items = out.items.length > 0 ? out.items[0] : { type: "string" };
    }

    if (isRecord(out.items) && !out.items.type) {
      if (isRecord(out.items.properties)) out.items.type = "object";
      else if (out.items.items) out.items.type = "array";
      else out.items.type = "string";
    }
  }

  if (isStringArray(out.required)) {
    if (isRecord(out.properties)) {
      const validProps = new Set(Object.keys(out.properties));
      const filtered = out.required.filter((k) => validProps.has(k));
      if (filtered.length > 0) out.required = filtered;
      else delete out.required;
    } else {
      delete out.required;
    }
  } else if (out.required) {
    delete out.required;
  }

  return out as GeminiSchema;
}

export function sanitizeSchemaForGemini(schema: unknown): GeminiSchema | GeminiSchema[] {
  if (Array.isArray(schema)) {
    return schema.map((item) => (isRecord(item) ? sanitizeSchemaObject(item) : {}));
  }
  
  return isRecord(schema) ? sanitizeSchemaObject(schema) : {};
}
