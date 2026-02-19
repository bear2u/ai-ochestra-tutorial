import path from "node:path";
import fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { config } from "./config";
import { ArtifactStore } from "./services/artifactStore";
import { SessionStore } from "./services/sessionStore";
import { SessionInput } from "./types";

export interface SupervisorLike {
  start(input: SessionInput): Promise<string>;
}

export interface LlmLike {
  complete(system: string, user: string): Promise<string>;
}

export interface CommandRunnerLike {
  run(command: string, options?: { workspaceRoot?: string }): Promise<{ exitCode: number; output: string }>;
}

export interface ServerDeps {
  store: SessionStore;
  artifacts: ArtifactStore;
  supervisor: SupervisorLike;
  llm: LlmLike;
  commandRunner: CommandRunnerLike;
}

const inputSchema = z
  .object({
    topic: z.string().min(1).optional(),
    task: z.string().min(1).optional(),
    autonomous: z.boolean().optional(),
    workspaceRoot: z.string().min(1).max(200).optional(),
    filePaths: z.array(z.string().min(1)).min(1),
    testCommand: z.string().min(1).optional(),
    validationCommands: z.array(z.string().min(1)).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    maxIterations: z.number().int().min(1).max(20).optional(),
    maxMinutes: z.number().int().min(1).max(180).optional()
  })
  .refine((value) => Boolean(value.topic?.trim() || value.task?.trim()), {
    message: "Either topic or task is required.",
    path: ["topic"]
  })
  .refine((value) => Boolean(value.testCommand?.trim() || (value.validationCommands?.length ?? 0) > 0), {
    message: "Either testCommand or validationCommands is required.",
    path: ["testCommand"]
  });

const llmPingSchema = z.object({
  prompt: z.string().min(1).max(200).default("Respond with one short line: pong")
});

const commandSchema = z.object({
  command: z.string().min(1).max(200)
});

const hasUnsafeShellChars = (command: string): boolean => /[;&|><`$]/.test(command);

const isCommandAllowed = (command: string): boolean => {
  const normalized = command.trim();
  return /^(pnpm|npm)\s+/i.test(normalized) && !hasUnsafeShellChars(normalized);
};

export const buildApp = (deps: ServerDeps): FastifyInstance => {
  const app = fastify({ logger: true });

  app.register(fastifyStatic, {
    root: path.join(config.workspaceRoot, "public"),
    prefix: "/"
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/tools/overview", async () => ({
    ok: true,
    service: "agent-orchestration-lab",
    port: config.port,
    model: config.model,
    openaiBaseUrl: config.openaiBaseUrl,
    workspaceRoot: config.workspaceRoot,
    now: new Date().toISOString()
  }));

  app.post("/api/tools/llm/ping", async (request, reply) => {
    const parsed = llmPingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const started = Date.now();
    try {
      const output = await deps.llm.complete(
        "You are a health-check assistant. Respond in one short plain-text sentence.",
        parsed.data.prompt
      );

      return {
        ok: true,
        latencyMs: Date.now() - started,
        output: output.slice(0, 1000)
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(502).send({
        ok: false,
        latencyMs: Date.now() - started,
        error: message
      });
    }
  });

  app.post("/api/tools/command", async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { command } = parsed.data;
    if (!isCommandAllowed(command)) {
      return reply.code(400).send({
        error: "Only simple npm/pnpm commands are allowed. Shell operators are blocked."
      });
    }

    const result = await deps.commandRunner.run(command);
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      command,
      output: result.output,
      finishedAt: new Date().toISOString()
    };
  });

  app.get("/api/sessions", async () => ({ sessions: deps.store.all() }));

  app.get("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { session, events: deps.store.getEvents(id) };
  });

  app.get("/api/sessions/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();

    const send = (data: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    for (const event of deps.store.getEvents(id)) {
      send(event);
    }

    const unsubscribe = deps.store.subscribe(id, (event) => send(event));

    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });

  app.get("/api/sessions/:id/artifacts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return {
      artifacts: deps.artifacts.getAll(id),
      refs: session.artifactRefs ?? {}
    };
  });

  app.get("/api/sessions/:id/pr-package", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const prPackage = deps.artifacts.getPrPackage(id);
    if (!prPackage) {
      return reply.code(404).send({ error: "PR package not found" });
    }

    return { prPackage };
  });

  app.post("/api/sessions", async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const maxIterations = parsed.data.maxIterations ?? parsed.data.maxAttempts ?? 6;
    const maxMinutes = parsed.data.maxMinutes ?? 45;
    const topic = (parsed.data.topic ?? parsed.data.task ?? "").trim();
    const autonomous = parsed.data.autonomous ?? true;
    const workspaceRoot = parsed.data.workspaceRoot?.trim() || ".";

    const sessionId = await deps.supervisor.start({
      ...parsed.data,
      topic,
      task: topic,
      autonomous,
      workspaceRoot,
      maxIterations,
      maxMinutes,
      maxAttempts: parsed.data.maxAttempts ?? maxIterations
    });
    return reply.code(202).send({ sessionId });
  });

  return app;
};
