import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TeamOrchestrator } from "../src/orchestrator/teamOrchestrator";
import { SessionStore } from "../src/services/sessionStore";
import { ChatSessionStore } from "../src/services/chatSessionStore";
import { TaskGraphStore } from "../src/services/taskGraphStore";
import { ApprovalQueue } from "../src/services/approvalQueue";

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout waiting for condition");
};

describe("TeamOrchestrator waiting approval behavior", () => {
  it("fails when scheduler is blocked but there are no pending approvals", async () => {
    const sessionStore = new SessionStore();
    const chatStore = new ChatSessionStore();
    const taskStore = new TaskGraphStore();
    const approvalQueue = new ApprovalQueue();

    const supervisor = {
      createSession: (input: any) => {
        const session = sessionStore.create(input);
        return session.id;
      },
      resume: () => undefined,
      cancel: () => true
    };

    const workspace = {
      resolveWorkspaceRoot: (value?: string) => value ?? "."
    };

    const workspaceIndexer = {
      scan: async () => [{ path: "src/app.ts", size: 10, mtimeMs: Date.now() }]
    };

    const fileSelector = {
      select: () => ({
        selectedFiles: ["src/app.ts"],
        scoredCandidates: [{ path: "src/app.ts", score: 10, reasons: ["token:app"] }]
      })
    };

    const taskDecomposer = {
      decompose: ({ runId }: { runId: string }) => ({
        id: "graph-1",
        runId,
        createdAt: new Date().toISOString(),
        tasks: [
          {
            id: "worker-1",
            runId,
            title: "worker",
            objective: "obj",
            phase: "implementation",
            status: "queued",
            assignee: "worker",
            dependencies: [],
            targetFiles: ["src/app.ts"],
            acceptanceCriteria: [],
            commands: [],
            retries: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          {
            id: "coord-1",
            runId,
            title: "coord",
            objective: "obj",
            phase: "review",
            status: "queued",
            assignee: "coordinator",
            dependencies: ["worker-1"],
            targetFiles: [],
            acceptanceCriteria: [],
            commands: [],
            retries: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        edges: [{ from: "worker-1", to: "coord-1" }]
      })
    };

    const workerScheduler = {
      run: async (tasks: any[]) => ({
        tasks: tasks.map((task) => ({
          ...task,
          status: task.id === "coord-1" ? "blocked" : "done"
        })),
        blocked: true,
        failed: false
      })
    };

    const workerAgent = {
      execute: async () => ({
        status: "done",
        summary: "ok",
        changedPaths: ["src/app.ts"],
        executedCommands: []
      })
    };

    const orchestrator = new TeamOrchestrator(
      sessionStore,
      chatStore,
      taskStore,
      approvalQueue,
      workspace as any,
      workspaceIndexer as any,
      fileSelector as any,
      taskDecomposer as any,
      workerScheduler as any,
      workerAgent as any,
      supervisor
    );

    const chat = orchestrator.createChatSession({
      workspaceRoot: ".",
      autonomous: true,
      approvalMode: "auto_safe",
      maxIterations: 3,
      maxMinutes: 30
    });

    const { runSessionId } = await orchestrator.postMessage(chat.id, "do it");

    await waitFor(() => {
      const session = sessionStore.get(runSessionId);
      return Boolean(session && (session.status === "failed" || session.status === "waiting_approval"));
    });

    const session = sessionStore.get(runSessionId);
    expect(session?.status).toBe("failed");
    expect(approvalQueue.listPending(runSessionId)).toHaveLength(0);
  });

  it("continues to supervisor loop even when requested folder is missing", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "step7-orch-"));

    const sessionStore = new SessionStore();
    const chatStore = new ChatSessionStore();
    const taskStore = new TaskGraphStore();
    const approvalQueue = new ApprovalQueue();

    let resumeCalled = false;
    const supervisor = {
      createSession: (input: any) => {
        const session = sessionStore.create(input);
        return session.id;
      },
      resume: () => {
        resumeCalled = true;
      },
      cancel: () => true
    };

    const workspace = {
      resolveWorkspaceRoot: () => tmpRoot
    };

    const workspaceIndexer = {
      scan: async () => [{ path: "README.md", size: 10, mtimeMs: Date.now() }]
    };

    const fileSelector = {
      select: () => ({
        selectedFiles: ["README.md"],
        scoredCandidates: [{ path: "README.md", score: 10, reasons: ["fallback"] }]
      })
    };

    const taskDecomposer = {
      decompose: ({ runId }: { runId: string }) => ({
        id: "graph-2",
        runId,
        createdAt: new Date().toISOString(),
        tasks: [
          {
            id: "worker-1",
            runId,
            title: "worker",
            objective: "obj",
            phase: "implementation",
            status: "queued",
            assignee: "worker",
            dependencies: [],
            targetFiles: ["README.md"],
            acceptanceCriteria: [],
            commands: [],
            retries: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        edges: []
      })
    };

    const workerScheduler = {
      run: async (tasks: any[]) => ({
        tasks: tasks.map((task) => ({
          ...task,
          status: "done"
        })),
        blocked: false,
        failed: false
      })
    };

    const workerAgent = {
      execute: async () => ({
        status: "done",
        summary: "ok",
        changedPaths: ["README.md"],
        executedCommands: []
      })
    };

    const orchestrator = new TeamOrchestrator(
      sessionStore,
      chatStore,
      taskStore,
      approvalQueue,
      workspace as any,
      workspaceIndexer as any,
      fileSelector as any,
      taskDecomposer as any,
      workerScheduler as any,
      workerAgent as any,
      supervisor
    );

    const chat = orchestrator.createChatSession({
      workspaceRoot: ".",
      autonomous: true,
      approvalMode: "auto_safe",
      maxIterations: 3,
      maxMinutes: 30
    });

    const { runSessionId } = await orchestrator.postMessage(chat.id, "example 폴더를 만들어줘");

    await waitFor(() => resumeCalled === true);

    const session = sessionStore.get(runSessionId);
    const events = sessionStore.getEvents(runSessionId);
    expect(session?.status).toBe("running");
    expect(events.some((event) => event.type === "goal_validation_failed")).toBe(false);
    expect(resumeCalled).toBe(true);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("builds supervisor validation plan for frontend bootstrap topics", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "step7-orch-validation-"));

    const sessionStore = new SessionStore();
    const chatStore = new ChatSessionStore();
    const taskStore = new TaskGraphStore();
    const approvalQueue = new ApprovalQueue();

    let resumeCalled = false;
    const supervisor = {
      createSession: (input: any) => {
        const session = sessionStore.create(input);
        return session.id;
      },
      resume: () => {
        resumeCalled = true;
      },
      cancel: () => true
    };

    const workspace = {
      resolveWorkspaceRoot: () => tmpRoot
    };

    const workspaceIndexer = {
      scan: async () => [{ path: "README.md", size: 10, mtimeMs: Date.now() }]
    };

    const fileSelector = {
      select: () => ({
        selectedFiles: ["README.md"],
        scoredCandidates: [{ path: "README.md", score: 10, reasons: ["fallback"] }]
      })
    };

    const taskDecomposer = {
      decompose: ({ runId }: { runId: string }) => ({
        id: "graph-validation",
        runId,
        createdAt: new Date().toISOString(),
        tasks: [],
        edges: []
      })
    };

    const workerScheduler = {
      run: async () => ({
        tasks: [],
        blocked: false,
        failed: false
      })
    };

    const workerAgent = {
      execute: async () => ({
        status: "done",
        summary: "ok",
        changedPaths: [],
        executedCommands: []
      })
    };

    const orchestrator = new TeamOrchestrator(
      sessionStore,
      chatStore,
      taskStore,
      approvalQueue,
      workspace as any,
      workspaceIndexer as any,
      fileSelector as any,
      taskDecomposer as any,
      workerScheduler as any,
      workerAgent as any,
      supervisor
    );

    const chat = orchestrator.createChatSession({
      workspaceRoot: ".",
      autonomous: true,
      approvalMode: "auto_safe",
      maxIterations: 3,
      maxMinutes: 30
    });

    const { runSessionId } = await orchestrator.postMessage(chat.id, "example 폴더를 만들고 React 를 세팅해줘");
    await waitFor(() => resumeCalled === true);

    const session = sessionStore.get(runSessionId);
    expect(session?.input.validationCommands).toEqual(["cd example && npm install", "cd example && npm run build"]);
    expect(session?.input.validationGuidance).toContain("Validation goal: verify the requested bootstrap/setup actually works");
    expect(session?.input.validationGuidance).toContain("Target directory: example.");
    expect(session?.input.testCommand).toBeUndefined();

    const events = sessionStore.getEvents(runSessionId);
    const validationPlanEvent = events.find((event) => event.type === "validation_plan_created");
    expect(validationPlanEvent).toBeDefined();
    expect((validationPlanEvent?.data as { guidance?: string } | undefined)?.guidance).toContain(
      "Validation goal: verify the requested bootstrap/setup actually works"
    );
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("announces React bootstrap start message for React setup requests", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "step7-orch-react-bootstrap-"));

    const sessionStore = new SessionStore();
    const chatStore = new ChatSessionStore();
    const taskStore = new TaskGraphStore();
    const approvalQueue = new ApprovalQueue();

    let resumeCalled = false;
    const supervisor = {
      createSession: (input: any) => {
        const session = sessionStore.create(input);
        return session.id;
      },
      resume: () => {
        resumeCalled = true;
      },
      cancel: () => true
    };

    const workspace = {
      resolveWorkspaceRoot: () => tmpRoot
    };

    const workspaceIndexer = {
      scan: async () => [{ path: "README.md", size: 10, mtimeMs: Date.now() }]
    };

    const fileSelector = {
      select: () => ({
        selectedFiles: ["README.md"],
        scoredCandidates: [{ path: "README.md", score: 10, reasons: ["fallback"] }]
      })
    };

    const taskDecomposer = {
      decompose: ({ runId }: { runId: string }) => ({
        id: "graph-react-bootstrap",
        runId,
        createdAt: new Date().toISOString(),
        tasks: [
          {
            id: "worker-react-bootstrap",
            runId,
            title: "Bootstrap Example React (Vite)",
            objective: "Create example workspace and scaffold React TypeScript app.",
            phase: "implementation",
            status: "queued",
            assignee: "worker",
            dependencies: [],
            targetFiles: ["example/package.json", "example/src/main.tsx"],
            acceptanceCriteria: [],
            commands: ["pnpm create vite@latest example --template react-ts"],
            retries: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        edges: []
      })
    };

    const workerScheduler = {
      run: async (tasks: any[], execute: (task: any) => Promise<any>, callbacks?: { onTaskStarted?: (task: any) => void; onTaskFinished?: (task: any, result: any) => void }) => {
        const task = tasks[0];
        callbacks?.onTaskStarted?.({ ...task, status: "running" });
        const result = await execute(task);
        callbacks?.onTaskFinished?.({ ...task, status: "done" }, result);
        return {
          tasks: tasks.map((candidate: any) => ({ ...candidate, status: "done" })),
          blocked: false,
          failed: false
        };
      }
    };

    const workerAgent = {
      execute: async () => ({
        status: "done",
        summary: "react bootstrap done",
        changedPaths: ["example/package.json"],
        executedCommands: []
      })
    };

    const orchestrator = new TeamOrchestrator(
      sessionStore,
      chatStore,
      taskStore,
      approvalQueue,
      workspace as any,
      workspaceIndexer as any,
      fileSelector as any,
      taskDecomposer as any,
      workerScheduler as any,
      workerAgent as any,
      supervisor
    );

    const chat = orchestrator.createChatSession({
      workspaceRoot: ".",
      autonomous: true,
      approvalMode: "auto_safe",
      maxIterations: 3,
      maxMinutes: 30
    });

    await orchestrator.postMessage(chat.id, "example 폴더를 만들어서 react 기본 세팅해줘");
    await waitFor(() => resumeCalled === true);

    const messages = chatStore.listMessages(chat.id).map((item) => item.content);
    const bootstrapStartMessage = messages.find((message) => message.includes("example 초기 설치 작업을 시작했습니다."));
    expect(bootstrapStartMessage).toContain("React (Vite)");
    expect(bootstrapStartMessage).not.toContain("Next.js + shadcn");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
