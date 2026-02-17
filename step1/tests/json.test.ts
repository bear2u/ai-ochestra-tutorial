import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../src/utils/json";

describe("extractJsonObject", () => {
  it("extracts fenced json", () => {
    const input = "```json\n{\"a\":1}\n```";
    expect(extractJsonObject(input)).toBe('{"a":1}');
  });

  it("falls back when fenced block is code pattern, not json", () => {
    const input = [
      "```ts",
      "const fenced = text.match(/```json\\\\s*([\\\\s\\\\S]*?)```/i);",
      "```",
      "Result:",
      "{\"ok\":true}"
    ].join("\n");
    expect(extractJsonObject(input)).toBe('{"ok":true}');
  });

  it("extracts bare json", () => {
    const input = "Result:\n{\"ok\":true}";
    expect(extractJsonObject(input)).toBe('{"ok":true}');
  });

  it("throws if missing json", () => {
    expect(() => extractJsonObject("hello")).toThrowError(/No JSON object/);
  });
});
