import { describe, expect, it } from "vitest";
import { DevAgentLike, Supervisor, TestAgentLike } from "../src/orchestrator/supervisor";
import { SessionStore } from "../src/services/sessionStore";
import { FileChange, SessionState } from "../src/types";

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

  async applyChanges(changes: FileChange[]): Promise<void> {
    for (const change of changes) {
      this.appliedChanges.push(change);
      this.files.set(change.path, change.content);
    }
  }
}

const waitForTerminalSession = async (store: SessionStore, sessionId: string, timeoutMs = 1500): Promise<SessionState> => {
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

describe("Supervisor phase engine", () => {
  it("runs phases in order and succeeds on first validation", async () => {
    const store = new SessionStore();
    const workspace = new FakeWorkspace({ "src/demo.ts": "export const demo = 0;\n" });

    const devAgent: DevAgentLike = {
      propose: async () => ({
        rationale: "Implement the requested change",
        changes: [{ path: "src/demo.ts", content: "export const demo = 1;\n" }]
      })
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

    const supervisor = new Supervisor(store, workspace, devAgent, testAgent, commandRunner);
    const sessionId = await supervisor.start({
      task: "set demo to 1",
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxAttempts: 3
    });

    const session = await waitForTerminalSession(store, sessionId);
    expect(session.status).toBe("success");
    expect(session.iteration).toBe(1);
    expect(session.attempt).toBe(1);
    expect(session.currentPhase).toBe("packaging");
    expect(session.phaseStatuses).toEqual({
      planning: "completed",
      architecture: "completed",
      design: "completed",
      implementation: "completed",
      validation: "completed",
      review: "completed",
      packaging: "completed"
    });

    const events = store.getEvents(sessionId);
    expect(events.filter((event) => event.type === "phase_started").map((event) => event.phase)).toEqual([
      "planning",
      "architecture",
      "design",
      "implementation",
      "validation",
      "review",
      "packaging"
    ]);

    for (const phase of ["planning", "architecture", "design", "review", "packaging"]) {
      expect(events.some((event) => event.type === "phase_completed" && event.phase === phase)).toBe(true);
    }

    const implementationEvent = events.find((event) => event.role === "dev" && event.type === "changes_applied");
    expect(implementationEvent?.phase).toBe("implementation");
    expect(implementationEvent?.iteration).toBe(1);

    const validationEvent = events.find((event) => event.role === "test" && event.type === "tests_passed");
    expect(validationEvent?.phase).toBe("validation");
    expect(validationEvent?.iteration).toBe(1);
    expect(workspace.appliedChanges).toHaveLength(1);
  });

  it("retries implementation-validation loop and fails after maxAttempts", async () => {
    const store = new SessionStore();
    const workspace = new FakeWorkspace({ "src/demo.ts": "export const demo = 0;\n" });
    let devCallCount = 0;

    const devAgent: DevAgentLike = {
      propose: async () => {
        devCallCount += 1;
        return {
          rationale: `attempt ${devCallCount}`,
          changes: [{ path: "src/demo.ts", content: `export const demo = ${devCallCount};\n` }]
        };
      }
    };
    const testAgent: TestAgentLike = {
      evaluate: async ({ exitCode, commandOutput }) => ({
        summary: "still failing",
        exitCode,
        commandOutput
      })
    };
    const commandRunner = {
      run: async () => ({ exitCode: 1, output: "Expected success" })
    };

    const supervisor = new Supervisor(store, workspace, devAgent, testAgent, commandRunner);
    const sessionId = await supervisor.start({
      task: "set demo to passing value",
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxAttempts: 2
    });

    const session = await waitForTerminalSession(store, sessionId);
    expect(session.status).toBe("failed");
    expect(session.iteration).toBe(2);
    expect(session.attempt).toBe(2);
    expect(session.phaseStatuses).toEqual({
      planning: "completed",
      architecture: "completed",
      design: "completed",
      implementation: "completed",
      validation: "failed",
      review: "skipped",
      packaging: "skipped"
    });

    const events = store.getEvents(sessionId);
    expect(events.filter((event) => event.type === "phase_started").map((event) => event.phase)).toEqual([
      "planning",
      "architecture",
      "design",
      "implementation",
      "validation",
      "implementation",
      "validation"
    ]);

    const failedValidationEvents = events.filter((event) => event.type === "tests_failed");
    expect(failedValidationEvents).toHaveLength(2);
    expect(failedValidationEvents.map((event) => event.iteration)).toEqual([1, 2]);
    expect(failedValidationEvents.every((event) => event.phase === "validation")).toBe(true);

    expect(events.some((event) => event.type === "phase_skipped" && event.phase === "review")).toBe(true);
    expect(events.some((event) => event.type === "phase_skipped" && event.phase === "packaging")).toBe(true);
    expect(devCallCount).toBe(2);
  });
});
