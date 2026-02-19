import { describe, expect, it } from "vitest";
import {
  ArchitectAgentLike,
  DesignerAgentLike,
  DevAgentLike,
  PlannerAgentLike,
  ReviewerAgentLike,
  Supervisor,
  TestAgentLike
} from "../src/orchestrator/supervisor";
import { ArtifactStore } from "../src/services/artifactStore";
import { SessionStore } from "../src/services/sessionStore";
import { ArchitectureArtifact, DesignArtifact, FileChange, PlanArtifact, SessionState } from "../src/types";

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
    if (!session) {
      throw new Error(`Session not found while waiting: ${sessionId}`);
    }
    if (session.status === "success" || session.status === "failed") {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for terminal session state: ${sessionId}`);
};

const createPlanArtifact = (sessionId: string): PlanArtifact => ({
  id: `plan-${sessionId}`,
  sessionId,
  phase: "planning",
  topic: "demo topic",
  goals: ["goal1"],
  requirements: [{ id: "REQ-1", description: "req", priority: "must" }],
  constraints: [],
  assumptions: [],
  doneCriteria: ["done"],
  createdAt: new Date().toISOString()
});

const createArchitectureArtifact = (sessionId: string): ArchitectureArtifact => ({
  id: `arch-${sessionId}`,
  sessionId,
  phase: "architecture",
  overview: "overview",
  modules: [{ name: "core", responsibility: "core", files: ["src/demo.ts"] }],
  decisions: [{ title: "decision", rationale: "why", tradeoffs: ["tradeoff"] }],
  risks: [{ risk: "risk", mitigation: "mitigation" }],
  createdAt: new Date().toISOString()
});

const createDesignArtifact = (sessionId: string): DesignArtifact => ({
  id: `design-${sessionId}`,
  sessionId,
  phase: "design",
  components: [{ name: "component", purpose: "purpose", files: ["src/demo.ts"] }],
  apis: [{ name: "api", input: "in", output: "out", errors: [] }],
  dataModels: [{ name: "model", fields: ["id:string"] }],
  implementationChecklist: ["check1"],
  testIdeas: ["test1"],
  createdAt: new Date().toISOString()
});

describe("Supervisor step3 phase engine", () => {
  it("creates planning/architecture/design artifacts and succeeds", async () => {
    const store = new SessionStore();
    const artifacts = new ArtifactStore();
    const workspace = new FakeWorkspace({ "src/demo.ts": "export const demo = 0;\n" });
    const devFeedbacks: string[] = [];

    const plannerAgent: PlannerAgentLike = {
      createPlan: async ({ sessionId }) => createPlanArtifact(sessionId)
    };
    const architectAgent: ArchitectAgentLike = {
      createArchitecture: async ({ sessionId }) => createArchitectureArtifact(sessionId)
    };
    const designerAgent: DesignerAgentLike = {
      createDesign: async ({ sessionId }) => createDesignArtifact(sessionId)
    };
    const reviewerAgent: ReviewerAgentLike = {
      createReview: async ({ sessionId, iteration }) => ({
        id: `review-${sessionId}-${iteration}`,
        sessionId,
        phase: "review",
        iteration,
        blockingIssues: [],
        nonBlockingIssues: [{ id: "INFO-1", title: "approved", detail: "no blocking issues" }],
        score: 90,
        fixPlan: [],
        createdAt: new Date().toISOString()
      })
    };
    const devAgent: DevAgentLike = {
      propose: async ({ feedback }) => {
        devFeedbacks.push(feedback);
        return {
          rationale: "apply fix",
          changes: [{ path: "src/demo.ts", content: "export const demo = 1;\n" }]
        };
      }
    };
    const testAgent: TestAgentLike = {
      evaluate: async ({ exitCode, commandOutput }) => ({
        summary: exitCode === 0 ? "all tests passed" : "tests failed",
        exitCode,
        commandOutput
      })
    };
    const commandRunner = {
      run: async () => ({ exitCode: 0, output: "ok" })
    };

    const supervisor = new Supervisor(
      store,
      artifacts,
      workspace,
      plannerAgent,
      architectAgent,
      designerAgent,
      reviewerAgent,
      devAgent,
      testAgent,
      commandRunner
    );

    const sessionId = await supervisor.start({
      task: "set demo to 1",
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxAttempts: 3
    });

    const session = await waitForTerminalSession(store, sessionId);
    expect(session.status).toBe("success");
    expect(session.phaseStatuses).toEqual({
      planning: "completed",
      architecture: "completed",
      design: "completed",
      implementation: "completed",
      validation: "completed",
      review: "completed",
      packaging: "completed"
    });
    expect(session.artifactRefs).toEqual({
      planning: `plan-${sessionId}`,
      architecture: `arch-${sessionId}`,
      design: `design-${sessionId}`,
      validation: expect.any(String),
      review: expect.any(String)
    });

    const events = store.getEvents(sessionId);
    const createdArtifacts = events.filter((event) => event.type === "artifact_created");
    expect(createdArtifacts).toHaveLength(5);
    expect(createdArtifacts.map((event) => event.role)).toEqual(["planner", "architect", "designer", "test", "reviewer"]);
    expect(createdArtifacts.every((event) => typeof event.artifactId === "string")).toBe(true);

    expect(devFeedbacks).toHaveLength(1);
    expect(devFeedbacks[0]).toContain("Artifact context");
    expect(devFeedbacks[0]).toContain(`plan-${sessionId}`);

    expect(artifacts.getAll(sessionId)).toHaveLength(5);
    expect(workspace.appliedChanges).toHaveLength(1);
  });

  it("fails session when planning phase throws and skips downstream phases", async () => {
    const store = new SessionStore();
    const artifacts = new ArtifactStore();
    const workspace = new FakeWorkspace({ "src/demo.ts": "export const demo = 0;\n" });

    const plannerAgent: PlannerAgentLike = {
      createPlan: async () => {
        throw new Error("Invalid planning schema");
      }
    };
    const architectAgent: ArchitectAgentLike = {
      createArchitecture: async ({ sessionId }) => createArchitectureArtifact(sessionId)
    };
    const designerAgent: DesignerAgentLike = {
      createDesign: async ({ sessionId }) => createDesignArtifact(sessionId)
    };
    const reviewerAgent: ReviewerAgentLike = {
      createReview: async ({ sessionId, iteration }) => ({
        id: `review-${sessionId}-${iteration}`,
        sessionId,
        phase: "review",
        iteration,
        blockingIssues: [],
        nonBlockingIssues: [{ id: "INFO-1", title: "approved", detail: "no blocking issues" }],
        score: 88,
        fixPlan: [],
        createdAt: new Date().toISOString()
      })
    };
    const devAgent: DevAgentLike = {
      propose: async () => ({
        rationale: "noop",
        changes: [{ path: "src/demo.ts", content: "export const demo = 1;\n" }]
      })
    };
    const testAgent: TestAgentLike = {
      evaluate: async ({ exitCode, commandOutput }) => ({
        summary: "summary",
        exitCode,
        commandOutput
      })
    };
    const commandRunner = {
      run: async () => ({ exitCode: 0, output: "ok" })
    };

    const supervisor = new Supervisor(
      store,
      artifacts,
      workspace,
      plannerAgent,
      architectAgent,
      designerAgent,
      reviewerAgent,
      devAgent,
      testAgent,
      commandRunner
    );

    const sessionId = await supervisor.start({
      task: "break planning",
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxAttempts: 2
    });

    const session = await waitForTerminalSession(store, sessionId);
    expect(session.status).toBe("failed");
    expect(session.phaseStatuses?.planning).toBe("failed");
    expect(session.phaseStatuses?.architecture).toBe("skipped");
    expect(session.phaseStatuses?.design).toBe("skipped");
    expect(session.phaseStatuses?.implementation).toBe("skipped");
    expect(session.phaseStatuses?.validation).toBe("skipped");
    expect(session.phaseStatuses?.review).toBe("skipped");
    expect(session.phaseStatuses?.packaging).toBe("skipped");

    const events = store.getEvents(sessionId);
    const phaseFailed = events.find((event) => event.type === "phase_failed" && event.phase === "planning");
    expect(phaseFailed).toBeDefined();
    expect(phaseFailed?.data?.errorType).toBe("runtime_error");
    expect(String(phaseFailed?.data?.errorMessage)).toContain("Invalid planning schema");
    expect(events.some((event) => event.type === "phase_skipped" && event.phase === "architecture")).toBe(true);
    expect(events.some((event) => event.type === "session_finished" && event.message.includes("Phase planning failed"))).toBe(true);
  });
});
