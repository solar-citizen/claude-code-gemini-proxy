import { isAnthropicMessagesRequestBody } from "../src/anthropic/validators";

describe("Anthropic Validators - output_config", () => {
  it("accepts output_config in request body", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      output_config: { effort: "high" },
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("accepts output_config inside system messages", () => {
    const body = {
      messages: [
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: "hello" },
      ],
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("rejects invalid output_config in request body", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      output_config: "not-an-object",
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(false);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects invalid effort in output_config", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      output_config: { effort: 123 },
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(false);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects invalid output_config inside messages", () => {
    const body = {
      messages: [
        { role: "system", content: [], output_config: "not-an-object" },
        { role: "user", content: "hello" },
      ],
    };
    const issues: string[] = [];
    const valid = isAnthropicMessagesRequestBody(body, issues);
    expect(valid).toBe(false);
    expect(issues.length).toBeGreaterThan(0);
  });
});
