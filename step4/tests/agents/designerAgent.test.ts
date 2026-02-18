import { describe, expect, it } from "vitest";
import { DesignerAgent } from "../../src/agents/designerAgent";
import { ArchitectureArtifact, PlanArtifact } from "../../src/types";

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

describe("DesignerAgent", () => {
  it("creates valid design artifact from llm JSON", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          components: [{ name: "Comp", purpose: "p", files: ["src/a.ts"] }],
          apis: [{ name: "api", input: "i", output: "o", errors: [] }],
          dataModels: [{ name: "model", fields: ["id:string"] }],
          implementationChecklist: ["check"],
          testIdeas: ["test idea"]
        })
    };
    const designer = new DesignerAgent(llm, () => "design-id-1");

    const artifact = await designer.createDesign({
      sessionId: "session-1",
      plan,
      architecture
    });

    expect(artifact.id).toBe("design-id-1");
    expect(artifact.phase).toBe("design");
    expect(artifact.components[0].name).toBe("Comp");
  });

  it("falls back to safe design artifact when llm payload is empty", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          components: [],
          apis: [],
          dataModels: [],
          implementationChecklist: [],
          testIdeas: []
        })
    };
    const designer = new DesignerAgent(llm, () => "design-id-1");

    const artifact = await designer.createDesign({
      sessionId: "session-1",
      plan,
      architecture
    });

    expect(artifact.id).toBe("design-id-1");
    expect(artifact.components.length).toBeGreaterThan(0);
    expect(artifact.apis.length).toBeGreaterThan(0);
    expect(artifact.dataModels.length).toBeGreaterThan(0);
  });

  it("normalizes object-shaped design fields from llm output", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          components: [{ component: "Comp", scope: "p", files: "src/a.ts" }],
          apis: [
            {
              api: "api",
              input: { schema: "Req" },
              output: { type: "Res" },
              errors: [{ text: "E1" }]
            }
          ],
          dataModels: [{ model: "model", fields: { text: "id:string" } }],
          implementationChecklist: [{ step: "check" }],
          testIdeas: [{ idea: "test idea" }]
        })
    };
    const designer = new DesignerAgent(llm, () => "design-id-2");

    const artifact = await designer.createDesign({
      sessionId: "session-1",
      plan,
      architecture
    });

    expect(artifact.id).toBe("design-id-2");
    expect(artifact.components[0].purpose).toBe("p");
    expect(artifact.components[0].files).toEqual(["src/a.ts"]);
    expect(artifact.apis[0].name).toBe("api");
    expect(artifact.apis[0].input).toBe("Req");
    expect(artifact.apis[0].output).toBe("Res");
    expect(artifact.apis[0].errors).toEqual(["E1"]);
    expect(artifact.dataModels[0].fields).toEqual(["id:string"]);
    expect(artifact.implementationChecklist).toEqual(["check"]);
    expect(artifact.testIdeas).toEqual(["test idea"]);
  });

  it("repairs partially malformed design payload using fallback", async () => {
    const llm = {
      completeJsonObject: async () =>
        JSON.stringify({
          components: [{ name: "Comp", files: ["src/a.ts"] }],
          apis: [{ name: "api", input: { schema: "Req" }, output: { type: "Res" } }],
          dataModels: [{ name: "model", fields: [] }],
          implementationChecklist: [{ step: "check" }],
          testIdeas: [{ idea: "test idea" }]
        })
    };
    const designer = new DesignerAgent(llm, () => "design-id-3");

    const artifact = await designer.createDesign({
      sessionId: "session-1",
      plan,
      architecture
    });

    expect(artifact.id).toBe("design-id-3");
    expect(artifact.components[0].purpose.length).toBeGreaterThan(0);
    expect(artifact.apis[0].input).toBe("Req");
    expect(artifact.apis[0].output).toBe("Res");
    expect(artifact.dataModels[0].fields.length).toBeGreaterThan(0);
  });
});
