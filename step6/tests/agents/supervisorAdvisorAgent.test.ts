import { describe, expect, it } from "vitest";
import { SupervisorAdvisorAgent } from "../../src/agents/supervisorAdvisorAgent";

describe("SupervisorAdvisorAgent", () => {
  it("returns structured advice from llm JSON", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          focusSummary: "Address validation drift",
          feedbackPatch: ["Add regression test", "Handle null path"],
          riskNotes: ["Null handling regression"],
          recommendedAction: "rework",
          confidence: 0.71
        })
    };

    const agent = new SupervisorAdvisorAgent(llm);
    const advice = await agent.createAdvice({
      sessionId: "session-1",
      iteration: 2,
      topic: "step6",
      feedback: "existing",
      validationSummary: "lint failed",
      validationClassification: "lint",
      reviewSummary: "review pending",
      budget: {
        maxIterations: 6,
        maxMinutes: 45,
        startedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 45 * 60_000).toISOString(),
        elapsedMs: 1000,
        remainingIterations: 4
      },
      artifactRefs: { planning: "plan-1" }
    });

    expect(advice.iteration).toBe(2);
    expect(advice.recommendedAction).toBe("rework");
    expect(advice.feedbackPatch).toHaveLength(2);
  });

  it("throws when llm response does not match advice schema", async () => {
    const llm = {
      completeJsonObject: async () => JSON.stringify({ foo: "bar" })
    };

    const agent = new SupervisorAdvisorAgent(llm);
    await expect(
      agent.createAdvice({
        sessionId: "session-2",
        iteration: 1,
        topic: "step6",
        feedback: "",
        artifactRefs: {}
      })
    ).rejects.toThrow();
  });
});
