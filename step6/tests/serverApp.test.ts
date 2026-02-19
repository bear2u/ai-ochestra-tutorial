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

  const app = buildApp({
    store,
    artifacts,
    supervisor,
    llm,
    commandRunner
  });

  return { app, store, artifacts, supervisor, llm, commandRunner };
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
});
