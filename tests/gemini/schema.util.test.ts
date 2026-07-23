import { sanitizeSchemaForGemini } from "../../src/gemini/schema.util";

describe("sanitizeSchemaForGemini", () => {
  it("handles null or non-object inputs", () => {
    expect(sanitizeSchemaForGemini(null)).toEqual({});
    expect(sanitizeSchemaForGemini(undefined)).toEqual({});
    expect(sanitizeSchemaForGemini(123 as any)).toEqual({});
  });

  it("handles arrays", () => {
    const input = [{ type: "string", invalidKey: "foo" }, { type: "number" }];
    const expected = [{ type: "string" }, { type: "number" }];
    expect(sanitizeSchemaForGemini(input)).toEqual(expected);
  });

  it("filters out disallowed keys and retains allowed keys", () => {
    const schema = {
      type: "object",
      $schema: "http://json-schema.org/draft-07/schema#",
      description: "A test object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          default: "unknown",
          nullable: true,
        },
      },
      required: ["name"],
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "object",
      description: "A test object",
      properties: {
        name: {
          type: "string",
          nullable: true,
        },
      },
      required: ["name"],
    });
  });

  it("sanitizes array items correctly", () => {
    const schema = {
      type: "array",
      items: {
        type: "string",
        default: "foo",
      },
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "array",
      items: {
        type: "string",
      },
    });
  });

  it("defaults type to 'object' if properties are present but type is missing", () => {
    const schema = {
      properties: {
        foo: { type: "string" },
      },
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        foo: { type: "string" },
      },
    });
  });
});
