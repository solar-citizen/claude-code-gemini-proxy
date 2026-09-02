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

  it("handles nested arrays and ensures inner items always has an items field", () => {
    const schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: {
              type: "array",
              items: {
                type: "array",
              },
            },
          },
        },
      },
    };

    const sanitized = sanitizeSchemaForGemini(schema) as any;
    expect(sanitized.properties.query.properties.where).toEqual({
      type: "array",
      items: {
        type: "array",
        items: {
          type: "string",
        },
      },
    });
  });

  it("provides fallback items schema for array without items", () => {
    const schema = {
      type: "array",
      description: "List of tags",
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "array",
      description: "List of tags",
      items: {
        type: "string",
      },
    });
  });

  it("provides fallback items schema for array with empty items object", () => {
    const schema = {
      type: "array",
      items: {},
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "array",
      items: {
        type: "string",
      },
    });
  });

  it("handles tuple items (array in items)", () => {
    const schema = {
      type: "array",
      items: [
        { type: "number", invalidField: "strip" },
        { type: "string" },
      ],
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "array",
      items: {
        type: "number",
      },
    });
  });

  it("handles anyOf with null type for optional fields (Pydantic / OpenAPI nullable)", () => {
    const schema = {
      type: "object",
      properties: {
        filter: {
          anyOf: [
            { type: "string" },
            { type: "null" },
          ],
          description: "Optional filter string",
        },
      },
    };

    const sanitized = sanitizeSchemaForGemini(schema) as any;
    expect(sanitized.properties.filter).toEqual({
      type: "string",
      description: "Optional filter string",
      nullable: true,
    });
  });

  it("handles type array with null (e.g. ['string', 'null'])", () => {
    const schema = {
      type: "object",
      properties: {
        identifier: {
          type: ["string", "null"],
          description: "Nullable identifier",
        },
      },
    };

    const sanitized = sanitizeSchemaForGemini(schema) as any;
    expect(sanitized.properties.identifier).toEqual({
      type: "string",
      description: "Nullable identifier",
      nullable: true,
    });
  });

  it("filters required array to only include declared properties", () => {
    const schema = {
      type: "object",
      properties: {
        foo: { type: "string" },
      },
      required: ["foo", "nonExistentBar"],
    };

    const sanitized = sanitizeSchemaForGemini(schema) as any;
    expect(sanitized.required).toEqual(["foo"]);
  });

  it("infers type as array when items is present without type", () => {
    const schema = {
      items: { type: "string" },
    };

    const sanitized = sanitizeSchemaForGemini(schema);
    expect(sanitized).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
});

