import { describe, expect, it } from "vitest";
import {
  ArchitectAgentLike,
  DesignerAgentLike,
  DevAgentLike,
  PlannerAgentLike,
  ReviewerAgentLike,
  Supervisor,
  TestAgentLike
} from "../../src/orchestrator/supervisor";
import { ArtifactStore } from "../../src/services/artifactStore";
import { SessionStore } from "../../src/services/sessionStore";
import { ArchitectureArtifact, DesignArtifact, FileChange, PlanArtifact, SessionState } from "../../src/types";

class FakeWorkspace {
  private readonly files = new Map<string, string>();
  readonly appliedChanges: FileChange[] = [];

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
  }

  async readFiles(filePaths: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(filePaths.map((path) => [path, this.files.get(path) ?? ""]));
  }

  async applyChanges(changes: FileChange[]): Promise<Array<{ path: string; mode: "patch" | "fallbackContent" }>> {
    const results: Array<{ path: string; mode: "patch" | "fallbackContent" }> = [];
    for (const change of changes) {
      this.appliedChanges.push(change);
      const content = change.fallbackContent ?? change.content ?? "";
      this.files.set(change.path, content);
      results.push({ path: change.path, mode: change.patch ? "patch" : "fallbackContent" });
    }
    return results;
  }
}

const waitForTerminalSession = async (store: SessionStore, sessionId: string, timeoutMs = 2500): Promise<SessionState> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = store.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status === "success" || session.status === "failed") return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for terminal session state: ${sessionId}`);
};

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
  modules: [{ name: "core", responsibility: "resp", files: ["src/demo.ts"] }],
  decisions: [{ title: "d1", rationale: "r1", tradeoffs: ["t1"] }],
  risks: [{ risk: "risk", mitigation: "mitigation" }],
  createdAt: new Date().toISOString()
});

const createDesign = (sessionId: string): DesignArtifact => ({
  id: `design-${sessionId}`,
  sessionId,
  phase: "design",
  components: [{ name: "Comp", purpose: "p", files: ["src/demo.ts"] }],
  apis: [{ name: "api", input: "i", output: "o", errors: [] }],
  dataModels: [{ name: "model", fields: ["id:string"] }],
  implementationChecklist: ["check"],
  testIdeas: ["test idea"],
  createdAt: new Date().toISOString()
});

const packagerAgent = {
  createPrPackage: async ({
    iteration,
    topic,
    changedFiles,
    testSummary,
    reviewSummary
  }: {
    iteration: number;
    topic: string;
    changedFiles: string[];
    testSummary: string;
    reviewSummary: string;
  }) => ({
    iteration,
    topic,
    title: `chore: package ${topic}`,
    body: "package body",
    changedFiles: changedFiles.length > 0 ? changedFiles : ["src/demo.ts"],
    testSummary,
    reviewSummary,
    riskNotes: [],
    advisorNotes: []
  })
};

const prPackageWriter = {
  write: async (sessionId: string) => ({ outputPath: `.orchestra/sessions/${sessionId}/pr-package.json` })
};

describe("step3 artifact integration", () => {
  it("runs planning -> architecture -> design and propagates artifacts", async () => {
    const store = new SessionStore();
    const artifacts = new ArtifactStore();
    const workspace = new FakeWorkspace({ "src/demo.ts": "export const demo = 0;\n" });
    let devFeedback = "";
    let architecturePlanId = "";
    let designPlanId = "";
    let designArchitectureId = "";

    const planner: PlannerAgentLike = {
      createPlan: async ({ sessionId }) => createPlan(sessionId)
    };
    const architect: ArchitectAgentLike = {
      createArchitecture: async ({ sessionId, plan }) => {
        architecturePlanId = plan.id;
        return createArchitecture(sessionId);
      }
    };
    const designer: DesignerAgentLike = {
      createDesign: async ({ sessionId, plan, architecture }) => {
        designPlanId = plan.id;
        designArchitectureId = architecture.id;
        return createDesign(sessionId);
      }
    };
    const dev: DevAgentLike = {
      propose: async ({ feedback }) => {
        devFeedback = feedback;
        return {
          rationale: "done",
          changes: [{ path: "src/demo.ts", content: "export const demo = 1;\n" }]
        };
      }
    };
    const reviewer: ReviewerAgentLike = {
      createReview: async ({ sessionId, iteration }) => ({
        id: `review-${sessionId}-${iteration}`,
        sessionId,
        phase: "review",
        iteration,
        blockingIssues: [],
        nonBlockingIssues: [{ id: "INFO-1", title: "approved", detail: "validation passed" }],
        score: 92,
        fixPlan: [],
        createdAt: new Date().toISOString()
      })
    };
    const test: TestAgentLike = {
      evaluate: async ({ exitCode, commandOutput }) => ({ summary: "ok", exitCode, commandOutput })
    };
    const commandRunner = {
      run: async () => ({ exitCode: 0, output: "ok" })
    };

    const supervisor = new Supervisor(
      store,
      artifacts,
      workspace,
      planner,
      architect,
      designer,
      reviewer,
      dev,
      test,
      commandRunner,
      undefined,
      packagerAgent,
      prPackageWriter
    );
    const sessionId = await supervisor.start({
      task: "artifact flow",
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxAttempts: 2
    });

    const session = await waitForTerminalSession(store, sessionId);
    expect(session.status).toBe("success");
    expect(session.artifactRefs).toEqual({
      planning: `plan-${sessionId}`,
      architecture: `arch-${sessionId}`,
      design: `design-${sessionId}`,
      validation: expect.any(String),
      review: expect.any(String),
      packaging: expect.any(String)
    });

    const events = store.getEvents(sessionId);
    expect(events.filter((event) => event.type === "artifact_created").map((event) => event.phase)).toEqual([
      "planning",
      "architecture",
      "design",
      "validation",
      "review",
      "packaging"
    ]);
    expect(events.some((event) => event.role === "planner" && event.type === "agent_started")).toBe(true);
    expect(events.some((event) => event.role === "architect" && event.type === "agent_started")).toBe(true);
    expect(events.some((event) => event.role === "designer" && event.type === "agent_started")).toBe(true);
    expect(devFeedback).toContain("Artifact context");
    expect(devFeedback).toContain(`design-${sessionId}`);
    expect(architecturePlanId).toBe(`plan-${sessionId}`);
    expect(designPlanId).toBe(`plan-${sessionId}`);
    expect(designArchitectureId).toBe(`arch-${sessionId}`);
  });
});
