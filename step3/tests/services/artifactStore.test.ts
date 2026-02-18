import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/services/artifactStore";
import { ArchitectureArtifact, DesignArtifact, PlanArtifact } from "../../src/types";

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
    store.save("session-1", design);
    store.save("session-1", plan);
    store.save("session-1", architecture);

    expect(store.getRefs("session-1")).toEqual({
      planning: plan.id,
      architecture: architecture.id,
      design: design.id
    });

    expect(store.getAll("session-1").map((artifact) => artifact.phase)).toEqual(["planning", "architecture", "design"]);
  });

  it("isolates artifacts by session", () => {
    const store = new ArtifactStore();
    store.save("session-a", createPlan("session-a"));
    store.save("session-b", createPlan("session-b"));

    expect(store.get("session-a", "planning")?.sessionId).toBe("session-a");
    expect(store.get("session-b", "planning")?.sessionId).toBe("session-b");
  });
});
