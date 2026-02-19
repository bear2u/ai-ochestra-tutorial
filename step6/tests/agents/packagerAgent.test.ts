import { describe, expect, it } from "vitest";
import { PackagerAgent } from "../../src/agents/packagerAgent";

describe("PackagerAgent", () => {
  it("creates package draft from llm JSON", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          title: "feat: add step6 packaging",
          body: "Package summary",
          changedFiles: ["src/a.ts", "src/b.ts"],
          testSummary: "all checks passed",
          reviewSummary: "approved",
          riskNotes: ["minor migration risk"],
          advisorNotes: ["keep patch small"]
        })
    };

    const agent = new PackagerAgent(llm);
    const draft = await agent.createPrPackage({
      sessionId: "session-1",
      iteration: 2,
      topic: "step6 packaging",
      changedFiles: ["src/a.ts"],
      testSummary: "ok",
      reviewSummary: "approved",
      riskNotes: [],
      advisorNotes: [],
      timeline: ["event"]
    });

    expect(draft.title).toContain("step6 packaging");
    expect(draft.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(draft.riskNotes).toHaveLength(1);
  });

  it("returns deterministic fallback when llm output is invalid", async () => {
    const llm = {
      completeJsonObject: async () => "not-json"
    };

    const agent = new PackagerAgent(llm);
    const draft = await agent.createPrPackage({
      sessionId: "session-2",
      iteration: 1,
      topic: "fallback test",
      changedFiles: ["src/demo.ts"],
      testSummary: "test ok",
      reviewSummary: "review ok",
      riskNotes: [],
      advisorNotes: [],
      timeline: []
    });

    expect(draft.title).toContain("fallback test");
    expect(draft.body).toContain("Validation");
    expect(draft.changedFiles).toEqual(["src/demo.ts"]);
  });
});
