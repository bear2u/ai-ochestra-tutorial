import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/serverApp";
import { SessionStore } from "../src/services/sessionStore";

const createTestApp = () => {
  const store = new SessionStore();
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
    supervisor,
    llm,
    commandRunner
  });

  return { app, supervisor, llm, commandRunner };
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

  it("starts session with validationCommands only", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        task: "fix test",
        filePaths: ["src/utils/json.ts"],
        validationCommands: ["pnpm lint", "pnpm typecheck", "pnpm test"],
        maxAttempts: 2
      }
    });

    expect(res.statusCode).toBe(202);
    expect(ctx.supervisor.start).toHaveBeenCalledOnce();
  });

  it("starts session with maxIterations/maxMinutes and no maxAttempts", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        task: "review loop",
        filePaths: ["src/utils/json.ts"],
        validationCommands: ["pnpm lint", "pnpm typecheck", "pnpm test"],
        maxIterations: 6,
        maxMinutes: 45
      }
    });

    expect(res.statusCode).toBe(202);
    expect(ctx.supervisor.start).toHaveBeenCalledOnce();
    expect(ctx.supervisor.start).toHaveBeenCalledWith(
      expect.objectContaining({
        maxIterations: 6,
        maxMinutes: 45,
        maxAttempts: 6
      })
    );
  });

  it("rejects session when both testCommand and validationCommands are missing", async () => {
    const ctx = createTestApp();
    apps.add(ctx.app);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        task: "fix test",
        filePaths: ["src/utils/json.ts"],
        maxAttempts: 2
      }
    });

    expect(res.statusCode).toBe(400);
    expect(ctx.supervisor.start).not.toHaveBeenCalled();
  });
});
