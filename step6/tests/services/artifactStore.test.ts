import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/services/artifactStore";
import { ArchitectureArtifact, DesignArtifact, PlanArtifact, PrPackageArtifact, ReviewArtifact, ValidationArtifact } from "../../src/types";

const createPlan = (sessionId: string): PlanArtifact => ({
  id: `plan-${sessionId}`,
  sessionId,
  phase: "planning",
  topic: "topic",
  goals: ["goal"],
  requirements: [{ id: "REQ-1", description: "requirement", priority: "must" }],
  constraints: [],
  assumptions: [],
  doneCriteria: ["done"],
  createdAt: new Date().toISOString()
});

const createArchitecture = (sessionId: string): ArchitectureArtifact => ({
  id: `arch-${sessionId}`,
  sessionId,
  phase: "architecture",
  overview: "overview",
  modules: [{ name: "core", responsibility: "resp", files: ["src/a.ts"] }],
  decisions: [{ title: "d1", rationale: "r1", tradeoffs: ["t1"] }],
  risks: [{ risk: "risk", mitigation: "mitigation" }],
  createdAt: new Date().toISOString()
});

const createDesign = (sessionId: string): DesignArtifact => ({
  id: `design-${sessionId}`,
  sessionId,
  phase: "design",
  components: [{ name: "Comp", purpose: "p", files: ["src/a.ts"] }],
  apis: [{ name: "api", input: "i", output: "o", errors: [] }],
  dataModels: [{ name: "model", fields: ["id:string"] }],
  implementationChecklist: ["check"],
  testIdeas: ["test idea"],
  createdAt: new Date().toISOString()
});

const createValidation = (sessionId: string, iteration: number, passed: boolean): ValidationArtifact => ({
  id: `validation-${sessionId}-${iteration}`,
  sessionId,
  phase: "validation",
  iteration,
  passed,
  summary: passed ? "ok" : "failed",
  classification: passed ? undefined : "test",
  steps: [
    {
      stage: "test",
      command: "pnpm test",
      passed,
      exitCode: passed ? 0 : 1,
      output: passed ? "ok" : "fail",
      summary: passed ? "ok" : "fail",
      durationMs: 10,
      classification: passed ? undefined : "test"
    }
  ],
  createdAt: new Date().toISOString()
});

const createReview = (sessionId: string, iteration: number, blocking: boolean): ReviewArtifact => ({
  id: `review-${sessionId}-${iteration}`,
  sessionId,
  phase: "review",
  iteration,
  blockingIssues: blocking ? [{ id: "BLOCK-1", title: "block", detail: "needs fix" }] : [],
  nonBlockingIssues: [{ id: "INFO-1", title: "note", detail: "minor note" }],
  score: blocking ? 60 : 90,
  fixPlan: blocking ? ["fix issue"] : [],
  createdAt: new Date().toISOString()
});

const createPackaging = (sessionId: string): PrPackageArtifact => ({
  id: `pkg-${sessionId}`,
  sessionId,
  phase: "packaging",
  iteration: 2,
  topic: "topic",
  title: "chore: package topic",
  body: "body",
  changedFiles: ["src/a.ts"],
  testSummary: "ok",
  reviewSummary: "approved",
  riskNotes: [],
  advisorNotes: [],
  outputPath: `.orchestra/sessions/${sessionId}/pr-package.json`,
  createdAt: new Date().toISOString()
});

describe("ArtifactStore", () => {
  it("saves and retrieves artifacts by phase", () => {
    const store = new ArtifactStore();

    const plan = createPlan("session-1");
    const architecture = createArchitecture("session-1");
    store.save("session-1", plan);
    store.save("session-1", architecture);

    expect(store.get("session-1", "planning")).toEqual(plan);
    expect(store.get("session-1", "architecture")).toEqual(architecture);
    expect(store.get("session-1", "design")).toBeUndefined();
  });

  it("returns refs and all artifacts in phase order", () => {
    const store = new ArtifactStore();
    const plan = createPlan("session-1");
    const architecture = createArchitecture("session-1");
    const design = createDesign("session-1");
    const validation1 = createValidation("session-1", 1, false);
    const validation2 = createValidation("session-1", 2, true);
    const review1 = createReview("session-1", 2, true);
    const review2 = createReview("session-1", 3, false);
    const packaging = createPackaging("session-1");
    store.save("session-1", design);
    store.save("session-1", plan);
    store.save("session-1", architecture);
    store.save("session-1", validation1);
    store.save("session-1", validation2);
    store.save("session-1", review1);
    store.save("session-1", review2);
    store.save("session-1", packaging);

    expect(store.getRefs("session-1")).toEqual({
      planning: plan.id,
      architecture: architecture.id,
      design: design.id,
      validation: validation2.id,
      review: review2.id,
      packaging: packaging.id
    });

    expect(store.getAll("session-1").map((artifact) => artifact.phase)).toEqual([
      "planning",
      "architecture",
      "design",
      "validation",
      "validation",
      "review",
      "review",
      "packaging"
    ]);
    expect(store.getValidationArtifacts("session-1").map((artifact) => artifact.iteration)).toEqual([1, 2]);
    expect(store.getReviewArtifacts("session-1").map((artifact) => artifact.iteration)).toEqual([2, 3]);
    expect(store.getPrPackage("session-1")?.id).toBe(packaging.id);
  });

  it("isolates artifacts by session", () => {
    const store = new ArtifactStore();
    store.save("session-a", createPlan("session-a"));
    store.save("session-b", createPlan("session-b"));

    expect(store.get("session-a", "planning")?.sessionId).toBe("session-a");
    expect(store.get("session-b", "planning")?.sessionId).toBe("session-b");
  });
});
