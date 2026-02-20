import { describe, expect, it } from "vitest";
import { applyUnifiedPatch } from "../../src/services/patchApply";

describe("patchApply", () => {
  it("applies a unified diff with headers", () => {
    const original = ["line-1", "line-2", ""].join("\n");
    const patch = ["--- a/file.txt", "+++ b/file.txt", "@@ -1,2 +1,2 @@", "-line-1", "+line-1-updated", " line-2"].join(
      "\n"
    );

    const next = applyUnifiedPatch(original, patch);
    expect(next).toContain("line-1-updated");
    expect(next).toContain("line-2");
  });

  it("applies a hunk patch even without file headers", () => {
    const original = ["before", "keep", ""].join("\n");
    const patch = ["@@ -1,2 +1,2 @@", "-before", "+after", " keep"].join("\n");

    const next = applyUnifiedPatch(original, patch);
    expect(next).toContain("after");
    expect(next).not.toContain("before\n");
  });

  it("throws when patch cannot be applied", () => {
    expect(() => applyUnifiedPatch("a\n", "not-a-patch")).toThrowError();
  });
});
