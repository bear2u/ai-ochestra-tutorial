import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/serverApp";
import { ArtifactStore } from "../src/services/artifactStore";
import { SessionStore } from "../src/services/sessionStore";

const createTestApp = () => {
  const store = new SessionStore();
  const artifacts = new ArtifactStore();
  const supervisor = {
    start: vi.fn(async () => "session-1")
  };
  const llm = {
    complete: vi.fn(async () => "pong")
  };
  const commandRunner = {
    run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
  };
  const normalizeMode = (value: unknown): "manual" | "auto_safe" | "auto_all" =>
    value === "auto_safe" || value === "auto_all" ? value : "manual";
  const teamOrchestrator = {
    createChatSession: vi.fn((input?: Record<string, unknown>) => ({
      id: "chat-1",
      status: "active" as const,
      workspaceRoot: String(input?.workspaceRoot ?? "."),
      autonomous: input?.autonomous !== false,
      approvalMode: normalizeMode(input?.approvalMode),
      maxIterations: Number(input?.maxIterations ?? 6),
      maxMinutes: Number(input?.maxMinutes ?? 45),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })),
    getChatSession: vi.fn((chatSessionId: string) =>
      chatSessionId === "chat-1"
        ? {
            id: "chat-1",
            status: "active" as const,
            workspaceRoot: ".",
            autonomous: true,
            approvalMode: "manual" as const,
            maxIterations: 6,
            maxMinutes: 45,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        : undefined
    ),
    listChatMessages: vi.fn(() => []),
    getChatEvents: vi.fn(() => []),
    subscribeChat: vi.fn(() => () => undefined),
    postMessage: vi.fn(async () => ({ runSessionId: "session-1", chatSessionId: "chat-1" })),
    getRunTasks: vi.fn(() => []),
    getRunHandoffs: vi.fn(() => []),
    getRunDiscovery: vi.fn(() => undefined),
    listPendingApprovals: vi.fn(() => []),
    decideApproval: vi.fn(async () => undefined)
  };

  const app = buildApp({
    store,
    artifacts,
    supervisor,
    teamOrchestrator,
    llm,
    commandRunner
  });

  return { app, store, artifacts, supervisor, teamOrchestrator, llm, commandRunner };
};

describe("serverApp", () => {
  const apps = new Set<ReturnType<typeof createTestApp>["app"]>();

  afterEach(async () => {
    for (const app of apps) {
      await app.close();
    }
    apps.clear();
  });

  it("returns overview information", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({ method: "GET", url: "/api/tools/overview" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.model).toBe("string");
    expect(typeof body.openaiBaseUrl).toBe("string");
  });

  it("pings llm and returns output", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tools/llm/ping",
      payload: { prompt: "hello" }
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.llm.complete).toHaveBeenCalledOnce();
    expect(res.json().ok).toBe(true);
  });

  it("returns 502 when llm ping fails", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);
    ctx.llm.complete.mockRejectedValueOnce(new Error("connection refused"));

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tools/llm/ping",
      payload: { prompt: "hello" }
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().ok).toBe(false);
  });

  it("blocks unsafe shell operators in tool command", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tools/command",
      payload: { command: "pnpm test && echo hacked" }
    });

    expect(res.statusCode).toBe(400);
    expect(ctx.commandRunner.run).not.toHaveBeenCalled();
  });

  it("runs allowed test command", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tools/command",
      payload: { command: "pnpm test" }
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.commandRunner.run).toHaveBeenCalledWith("pnpm test");
    expect(res.json().ok).toBe(true);
  });

  it("starts session via supervisor", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        task: "fix test",
        filePaths: ["src/utils/json.ts"],
        testCommand: "pnpm test",
        maxAttempts: 2
      }
    });

    expect(res.statusCode).toBe(202);
    expect(ctx.supervisor.start).toHaveBeenCalledOnce();
    expect(res.json().sessionId).toBe("session-1");
  });

  it("starts session with topic and autonomous", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        topic: "step6 packaging",
        autonomous: false,
        filePaths: ["src/utils/json.ts"],
        validationCommands: ["pnpm lint", "pnpm typecheck", "pnpm test"],
        maxIterations: 6,
        maxMinutes: 45
      }
    });

    expect(res.statusCode).toBe(202);
    expect(ctx.supervisor.start).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "step6 packaging",
        task: "step6 packaging",
        workspaceRoot: ".",
        autonomous: false,
        maxIterations: 6,
        maxMinutes: 45,
        maxAttempts: 6
      })
    );
  });

  it("forwards custom workspaceRoot to supervisor", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        topic: "workspace scoped run",
        workspaceRoot: "example",
        filePaths: ["src/utils/json.ts"],
        validationCommands: ["pnpm test"],
        maxIterations: 2,
        maxMinutes: 15
      }
    });

    expect(res.statusCode).toBe(202);
    expect(ctx.supervisor.start).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "workspace scoped run",
        task: "workspace scoped run",
        workspaceRoot: "example",
        maxIterations: 2,
        maxMinutes: 15,
        maxAttempts: 2
      })
    );
  });

  it("rejects session when topic/task is missing", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        filePaths: ["src/utils/json.ts"],
        testCommand: "pnpm test",
        maxAttempts: 2
      }
    });

    expect(res.statusCode).toBe(400);
    expect(ctx.supervisor.start).not.toHaveBeenCalled();
  });

  it("returns artifacts and refs", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const session = ctx.store.create({
      topic: "topic",
      task: "topic",
      autonomous: true,
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxIterations: 3,
      maxMinutes: 30
    });

    ctx.artifacts.save(session.id, {
      id: "plan-1",
      sessionId: session.id,
      phase: "planning",
      topic: "topic",
      goals: ["goal"],
      requirements: [{ id: "REQ-1", description: "req", priority: "must" }],
      constraints: [],
      assumptions: [],
      doneCriteria: ["done"],
      createdAt: new Date().toISOString()
    });

    ctx.store.setArtifactRef(session.id, "planning", "plan-1");

    const res = await ctx.app.inject({ method: "GET", url: `/api/sessions/${session.id}/artifacts` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.artifacts).toHaveLength(1);
    expect(body.refs.planning).toBe("plan-1");
  });

  it("returns pr package when available", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const session = ctx.store.create({
      topic: "topic",
      task: "topic",
      autonomous: true,
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxIterations: 3,
      maxMinutes: 30
    });

    ctx.artifacts.save(session.id, {
      id: "pkg-1",
      sessionId: session.id,
      phase: "packaging",
      iteration: 1,
      topic: "topic",
      title: "chore: package topic",
      body: "body",
      changedFiles: ["src/demo.ts"],
      testSummary: "ok",
      reviewSummary: "approved",
      riskNotes: [],
      advisorNotes: [],
      outputPath: ".orchestra/sessions/x/pr-package.json",
      createdAt: new Date().toISOString()
    });

    const res = await ctx.app.inject({ method: "GET", url: `/api/sessions/${session.id}/pr-package` });

    expect(res.statusCode).toBe(200);
    expect(res.json().prPackage.id).toBe("pkg-1");
  });

  it("returns 404 for missing pr package", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const session = ctx.store.create({
      topic: "topic",
      task: "topic",
      autonomous: true,
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxIterations: 3,
      maxMinutes: 30
    });

    const res = await ctx.app.inject({ method: "GET", url: `/api/sessions/${session.id}/pr-package` });

    expect(res.statusCode).toBe(404);
  });

  it("creates chat session", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      payload: {
        workspaceRoot: "example",
        autonomous: true,
        approvalMode: "auto_safe",
        maxIterations: 4,
        maxMinutes: 30
      }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().chatSessionId).toBe("chat-1");
    expect(ctx.teamOrchestrator.createChatSession).toHaveBeenCalledOnce();
    expect(ctx.teamOrchestrator.createChatSession).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalMode: "auto_safe"
      })
    );
  });

  it("returns chat session and messages", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const sessionRes = await ctx.app.inject({ method: "GET", url: "/api/chat/sessions/chat-1" });
    const messagesRes = await ctx.app.inject({ method: "GET", url: "/api/chat/sessions/chat-1/messages" });

    expect(sessionRes.statusCode).toBe(200);
    expect(messagesRes.statusCode).toBe(200);
    expect(Array.isArray(messagesRes.json().messages)).toBe(true);
  });

  it("posts chat message and returns run session id", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/chat/sessions/chat-1/messages",
      payload: { content: "build todo board" }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().runSessionId).toBe("session-1");
    expect(ctx.teamOrchestrator.postMessage).toHaveBeenCalledWith("chat-1", "build todo board");
  });

  it("returns tasks, handoffs and discovery for a run session", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const session = ctx.store.create({
      topic: "topic",
      task: "topic",
      autonomous: true,
      filePaths: ["src/demo.ts"],
      testCommand: "pnpm test",
      maxIterations: 3,
      maxMinutes: 30
    });

    const tasksRes = await ctx.app.inject({ method: "GET", url: `/api/sessions/${session.id}/tasks` });
    const handoffsRes = await ctx.app.inject({ method: "GET", url: `/api/sessions/${session.id}/handoffs` });
    const discoveryRes = await ctx.app.inject({ method: "GET", url: `/api/sessions/${session.id}/discovery` });

    expect(tasksRes.statusCode).toBe(200);
    expect(handoffsRes.statusCode).toBe(200);
    expect(discoveryRes.statusCode).toBe(200);
    expect(Array.isArray(tasksRes.json().tasks)).toBe(true);
    expect(Array.isArray(handoffsRes.json().handoffs)).toBe(true);
    expect(discoveryRes.json().discovery).toBeNull();
  });

  it("returns pending approvals and handles approval decision", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const pendingRes = await ctx.app.inject({ method: "GET", url: "/api/approvals/pending" });
    expect(pendingRes.statusCode).toBe(200);
    expect(Array.isArray(pendingRes.json().approvals)).toBe(true);

    ctx.teamOrchestrator.decideApproval.mockResolvedValueOnce({
      id: "approval-1",
      runId: "session-1",
      command: "pnpm add shadcn-ui",
      reason: "install dependency",
      riskLevel: "medium",
      status: "approved",
      requestedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy: "user"
    } as any);

    const decisionRes = await ctx.app.inject({
      method: "POST",
      url: "/api/approvals/approval-1/decision",
      payload: { decision: "approve", note: "ok" }
    });

    expect(decisionRes.statusCode).toBe(200);
    expect(decisionRes.json().approval.id).toBe("approval-1");
  });
});
