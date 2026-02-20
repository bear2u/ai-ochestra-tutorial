import { describe, expect, it } from "vitest";
import { ArchitectAgent } from "../../src/agents/architectAgent";
import { PlanArtifact } from "../../src/types";

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

describe("ArchitectAgent", () => {
  it("creates valid architecture artifact from llm JSON", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          overview: "overview",
          modules: [{ name: "core", responsibility: "resp", files: ["src/a.ts"] }],
          decisions: [{ title: "d1", rationale: "r1", tradeoffs: ["t1"] }],
          risks: [{ risk: "risk", mitigation: "mitigation" }]
        })
    };
    const architect = new ArchitectAgent(llm, () => "arch-id-1");

    const artifact = await architect.createArchitecture({
      sessionId: "session-1",
      plan
    });

    expect(artifact.id).toBe("arch-id-1");
    expect(artifact.phase).toBe("architecture");
    expect(artifact.modules[0].name).toBe("core");
  });

  it("builds fallback architecture when llm JSON is empty", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          overview: "",
          modules: [],
          decisions: [],
          risks: []
        })
    };
    const architect = new ArchitectAgent(llm, () => "arch-id-1");

    const artifact = await architect.createArchitecture({
      sessionId: "session-1",
      plan
    });

    expect(artifact.id).toBe("arch-id-1");
    expect(artifact.overview.length).toBeGreaterThan(0);
    expect(artifact.modules.length).toBeGreaterThan(0);
    expect(artifact.decisions.length).toBeGreaterThan(0);
    expect(artifact.risks.length).toBeGreaterThan(0);
  });

  it("normalizes overview object and tradeoffs string from llm output", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          overview: { summary: "overview text" },
          modules: [{ module: "core", purpose: "resp", files: "src/a.ts" }],
          decisions: [{ decision: "d1", reason: "r1", tradeoffs: "simple but rigid" }],
          risks: [{ title: "risk", plan: "mitigation" }]
        })
    };
    const architect = new ArchitectAgent(llm, () => "arch-id-2");

    const artifact = await architect.createArchitecture({
      sessionId: "session-1",
      plan
    });

    expect(artifact.id).toBe("arch-id-2");
    expect(artifact.overview).toBe("overview text");
    expect(artifact.modules[0].files).toEqual(["src/a.ts"]);
    expect(artifact.decisions[0].tradeoffs).toEqual(["simple but rigid"]);
    expect(artifact.risks[0].mitigation).toBe("mitigation");
  });
});
