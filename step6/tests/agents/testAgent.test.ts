import { describe, expect, it } from "vitest";
import { TestAgent } from "../../src/agents/testAgent";

describe("TestAgent", () => {
  it("uses llm summary when available", async () => {
    const agent = new TestAgent({
      complete: async () => "Looks good."
    });

    const result = await agent.evaluate({
      sessionId: "session-1",
      iteration: 1,
      task: "task",
      exitCode: 0,
      commandOutput: "ok"
    });

    expect(result.summary).toBe("Looks good.");
    expect(result.exitCode).toBe(0);
  });

  it("falls back to deterministic summary when llm throws", async () => {
    const agent = new TestAgent({
      complete: async () => {
        throw new Error("timeout");
      }
    });

    const result = await agent.evaluate({
      sessionId: "session-2",
      iteration: 1,
      task: "task",
      exitCode: 1,
      commandOutput: "failure log"
    });

    expect(result.summary).toContain("Validation command failed.");
    expect(result.summary).toContain("Exit code: 1");
  });

  it("classifies custom failures with rules fallback", async () => {
    const agent = new TestAgent({
      complete: async () => "unknown"
    });

    const classification = await agent.classifyFailure({
      task: "task",
      stage: "custom",
      command: "node -e \"throw\"",
      commandOutput: "something strange happened",
      summary: "unclassified failure"
    });

    expect(classification).toBe("unknown");
  });
});
