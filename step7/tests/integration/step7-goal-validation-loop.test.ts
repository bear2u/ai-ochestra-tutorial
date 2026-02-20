import { describe, expect, it } from "vitest";
import {
  ArchitectAgentLike,
  DesignerAgentLike,
  DevAgentLike,
  GoalValidatorLike,
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
    for (const [filePath, content] of Object.entries(initialFiles)) {
      this.files.set(filePath, content);
    }
  }

  async readFiles(filePaths: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(filePaths.map((filePath) => [filePath, this.files.get(filePath) ?? ""]));
  }

  async applyChanges(changes: FileChange[]): Promise<Array<{ path: string; mode: "patch" | "fallbackContent" }>> {
    const results: Array<{ path: string; mode: "patch" | "fallbackContent" }> = [];
    for (const change of changes) {
      this.appliedChanges.push(change);
      const nextContent = change.fallbackContent ?? change.content ?? "";
      this.files.set(change.path, nextContent);
      results.push({ path: change.path, mode: change.patch ? "patch" : "fallbackContent" });
    }
    return results;
  }
}

const waitForTerminalSession = async (store: SessionStore, sessionId: string, timeoutMs = 3000): Promise<SessionState> => {
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

describe("step7 goal validation loop integration", () => {
  it("re-enters implementation when goal_validation fails and passes on retry", async () => {
    const store = new SessionStore();
    const artifacts = new ArtifactStore();
    const workspace = new FakeWorkspace({ "src/demo.ts": "export const demo = 0;\n" });

    const planner: PlannerAgentLike = {
      createPlan: async ({ sessionId }) => createPlan(sessionId)
    };
    const architect: ArchitectAgentLike = {
      createArchitecture: async ({ sessionId }) => createArchitecture(sessionId)
    };
    const designer: DesignerAgentLike = {
      createDesign: async ({ sessionId }) => createDesign(sessionId)
    };
    const reviewer: ReviewerAgentLike = {
      createReview: async ({ sessionId, iteration }) => ({
        id: `review-${sessionId}-${iteration}`,
        sessionId,
        phase: "review",
        iteration,
        blockingIssues: [],
        nonBlockingIssues: [{ id: "INFO-1", title: "approved", detail: "review ok" }],
        score: 95,
        fixPlan: [],
        createdAt: new Date().toISOString()
      })
    };
    const dev: DevAgentLike = {
      propose: async ({ iteration }) => ({
        rationale: "apply change",
        changes: [{ path: "src/demo.ts", fallbackContent: `export const demo = ${iteration ?? 1};\n` }]
      })
    };
    const test: TestAgentLike = {
      evaluate: async ({ exitCode, commandOutput }) => ({ summary: exitCode === 0 ? "ok" : "failed", exitCode, commandOutput })
    };
    const goalValidator: GoalValidatorLike = {
      validate: async ({ iteration }) => ({
        iteration,
        passed: iteration >= 2,
        summary: iteration >= 2 ? "goal validation passed" : "example directory missing",
        checks: [
          {
            id: "dir:example",
            label: "Directory exists: example",
            passed: iteration >= 2,
            detail: iteration >= 2 ? "exists" : "missing"
          }
        ],
        missingTargets: iteration >= 2 ? [] : ["example"],
        suggestions: iteration >= 2 ? [] : ["Create example directory and scaffold Next.js app."]
      })
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
      prPackageWriter,
      goalValidator
    );

    const sessionId = await supervisor.start({
      topic: "example 폴더를 만들고 NextJs16+ShadCN을 기본 설치",
      filePaths: ["src/demo.ts"],
      validationCommands: ["node -e \"console.log('ok'); process.exit(0)\""],
      maxIterations: 4,
      maxMinutes: 45
    });

    const session = await waitForTerminalSession(store, sessionId);
    expect(session.status).toBe("success");
    expect(session.iteration).toBe(2);

    const goalArtifacts = artifacts.getGoalValidationArtifacts(sessionId);
    expect(goalArtifacts).toHaveLength(2);
    expect(goalArtifacts[0].passed).toBe(false);
    expect(goalArtifacts[1].passed).toBe(true);

    const events = store.getEvents(sessionId);
    expect(events.some((event) => event.type === "goal_validation_failed")).toBe(true);
    expect(events.some((event) => event.type === "goal_validation_passed")).toBe(true);
  });
});
