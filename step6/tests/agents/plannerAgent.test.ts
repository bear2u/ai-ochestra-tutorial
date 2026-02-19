import { describe, expect, it } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent";

describe("PlannerAgent", () => {
  it("creates valid plan artifact from llm JSON", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          goals: ["goal"],
          requirements: [{ id: "REQ-1", description: "requirement", priority: "must" }],
          constraints: ["constraint"],
          assumptions: ["assumption"],
          doneCriteria: ["done"]
        })
    };
    const planner = new PlannerAgent(llm, () => "plan-id-1");

    const artifact = await planner.createPlan({
      sessionId: "session-1",
      topic: "topic",
      filePaths: ["src/a.ts"]
    });

    expect(artifact.id).toBe("plan-id-1");
    expect(artifact.phase).toBe("planning");
    expect(artifact.topic).toBe("topic");
    expect(artifact.requirements[0].priority).toBe("must");
  });

  it("builds fallback plan when llm JSON does not match schema", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          goals: ["goal"],
          requirements: [],
          doneCriteria: ["done"]
        })
    };
    const planner = new PlannerAgent(llm, () => "plan-id-1");

    const artifact = await planner.createPlan({
      sessionId: "session-1",
      topic: "topic",
      filePaths: ["src/a.ts"]
    });

    expect(artifact.id).toBe("plan-id-1");
    expect(artifact.requirements.length).toBeGreaterThan(0);
    expect(artifact.doneCriteria.length).toBeGreaterThan(0);
  });

  it("normalizes object-shaped string arrays from llm output", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          goals: [{ title: "goal A" }, { description: "goal B" }],
          requirements: [{ id: "REQ-1", description: "requirement", priority: "must" }],
          constraints: [{ text: "constraint A" }],
          assumptions: [{ name: "assumption A" }],
          doneCriteria: [{ value: "done A" }]
        })
    };
    const planner = new PlannerAgent(llm, () => "plan-id-2");

    const artifact = await planner.createPlan({
      sessionId: "session-2",
      topic: "topic",
      filePaths: ["src/a.ts"]
    });

    expect(artifact.id).toBe("plan-id-2");
    expect(artifact.goals).toEqual(["goal A", "goal B"]);
    expect(artifact.constraints).toEqual(["constraint A"]);
    expect(artifact.assumptions).toEqual(["assumption A"]);
    expect(artifact.doneCriteria).toEqual(["done A"]);
  });
});
