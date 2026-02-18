import { describe, expect, it } from "vitest";
import { DevAgent } from "../../src/agents/devAgent";

describe("DevAgent", () => {
  it("returns llm output when schema is valid", async () => {
    const agent = new DevAgent({
      completeJsonObject: async () =>
        JSON.stringify({
          rationale: "update file",
          changes: [{ path: "playground/planning-smoke.md", patch: "@@ -1 +1 @@\n-before\n+updated", fallbackContent: "updated" }]
        })
    });

    const output = await agent.propose({
      sessionId: "session-1",
      iteration: 1,
      task: "task",
      files: { "playground/planning-smoke.md": "before" },
      feedback: ""
    });

    expect(output.rationale).toBe("update file");
    expect(output.changes[0].path).toBe("playground/planning-smoke.md");
    expect(output.changes[0].fallbackContent).toBe("updated");
  });

  it("falls back to deterministic no-op change when llm payload is invalid", async () => {
    const agent = new DevAgent({
      completeJsonObject: async () =>
        JSON.stringify({
          rationale: "broken payload",
          changes: []
        })
    });

    const output = await agent.propose({
      sessionId: "session-2",
      iteration: 1,
      task: "task",
      files: { "playground/planning-smoke.md": "keep-this-content" },
      feedback: ""
    });

    expect(output.rationale).toContain("Fallback");
    expect(output.changes).toEqual([{ path: "playground/planning-smoke.md", fallbackContent: "keep-this-content" }]);
  });
});
