import { describe, expect, it } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent";
import { ArchitectureArtifact, DesignArtifact, PlanArtifact } from "../../src/types";

const plan: PlanArtifact = {
  id: "plan-1",
  sessionId: "session-1",
  phase: "planning",
  topic: "topic",
  goals: ["goal"],
  requirements: [{ id: "REQ-1", description: "requirement", priority: "must" }],
  constraints: [],
  assumptions: [],
  doneCriteria: ["done"],
  createdAt: new Date().toISOString()
};

const architecture: ArchitectureArtifact = {
  id: "arch-1",
  sessionId: "session-1",
  phase: "architecture",
  overview: "overview",
  modules: [{ name: "core", responsibility: "resp", files: ["src/a.ts"] }],
  decisions: [{ title: "d1", rationale: "r1", tradeoffs: ["t1"] }],
  risks: [{ risk: "risk", mitigation: "mitigation" }],
  createdAt: new Date().toISOString()
};

const design: DesignArtifact = {
  id: "design-1",
  sessionId: "session-1",
  phase: "design",
  components: [{ name: "Comp", purpose: "p", files: ["src/a.ts"] }],
  apis: [{ name: "api", input: "i", output: "o", errors: [] }],
  dataModels: [{ name: "model", fields: ["id:string"] }],
  implementationChecklist: ["check"],
  testIdeas: ["test idea"],
  createdAt: new Date().toISOString()
};

describe("ReviewerAgent", () => {
  it("creates review artifact from llm JSON", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          blockingIssues: [{ id: "BLOCK-1", title: "Missing edge case", detail: "Null input path not covered." }],
          nonBlockingIssues: [{ id: "INFO-1", title: "Naming", detail: "Variable naming can be improved." }],
          score: 62,
          fixPlan: ["Add null guard", "Add regression test"]
        })
    };

    const reviewer = new ReviewerAgent(llm, () => "review-id-1");
    const artifact = await reviewer.createReview({
      sessionId: "session-1",
      iteration: 2,
      task: "review task",
      feedback: "fix edge case",
      plan,
      architecture,
      design,
      validationSummary: "validation passed"
    });

    expect(artifact.id).toBe("review-id-1");
    expect(artifact.phase).toBe("review");
    expect(artifact.iteration).toBe(2);
    expect(artifact.blockingIssues).toHaveLength(1);
    expect(artifact.score).toBe(62);
    expect(artifact.fixPlan).toHaveLength(2);
  });

  it("builds safe fallback review when llm payload is invalid", async () => {
    const llm = {
      completeJsonObject: async () => "not-json"
    };

    const reviewer = new ReviewerAgent(llm, () => "review-id-2");
    const artifact = await reviewer.createReview({
      sessionId: "session-1",
      iteration: 1,
      task: "review task",
      feedback: "",
      plan,
      architecture,
      design,
      validationSummary: "validation passed"
    });

    expect(artifact.id).toBe("review-id-2");
    expect(artifact.blockingIssues).toHaveLength(0);
    expect(artifact.nonBlockingIssues.length).toBeGreaterThan(0);
    expect(artifact.score).toBeGreaterThanOrEqual(0);
  });

  it("supports deterministic forced block/approve task flags", async () => {
    const llm = {
      completeJsonObject: async () => JSON.stringify({})
    };

    const reviewer = new ReviewerAgent(llm, () => "review-id-3");
    const blocked = await reviewer.createReview({
      sessionId: "session-1",
      iteration: 1,
      task: "[force_review_block] task",
      feedback: "",
      validationSummary: "validation passed"
    });
    const approved = await reviewer.createReview({
      sessionId: "session-1",
      iteration: 2,
      task: "[force_review_approve] task",
      feedback: "",
      validationSummary: "validation passed"
    });

    expect(blocked.blockingIssues.length).toBeGreaterThan(0);
    expect(approved.blockingIssues).toHaveLength(0);
  });
});
