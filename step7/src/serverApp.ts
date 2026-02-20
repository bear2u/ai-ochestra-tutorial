import path from "node:path";
import fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { config } from "./config";
import { ArtifactStore } from "./services/artifactStore";
import { SessionStore } from "./services/sessionStore";
import {
  ApprovalMode,
  ApprovalRequest,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  DiscoveryArtifact,
  HandoffEnvelope,
  SessionInput,
  TaskCard
} from "./types";

export interface SupervisorLike {
  start(input: SessionInput): Promise<string>;
}

export interface LlmLike {
  complete(system: string, user: string): Promise<string>;
}

export interface CommandRunnerLike {
  run(command: string, options?: { workspaceRoot?: string }): Promise<{ exitCode: number; output: string }>;
}

export interface TeamOrchestratorLike {
  createChatSession(input: {
    workspaceRoot?: string;
    autonomous?: boolean;
    approvalMode?: ApprovalMode;
    maxIterations?: number;
    maxMinutes?: number;
  }): ChatSession;
  getChatSession(chatSessionId: string): ChatSession | undefined;
  listChatMessages(chatSessionId: string): ChatMessage[];
  getChatEvents(chatSessionId: string): ChatStreamEvent[];
  subscribeChat(chatSessionId: string, handler: (event: ChatStreamEvent) => void): () => void;
  postMessage(chatSessionId: string, content: string): Promise<{ runSessionId: string; chatSessionId: string }>;
  getRunTasks(runId: string): TaskCard[];
  getRunHandoffs(runId: string): HandoffEnvelope[];
  getRunDiscovery(runId: string): DiscoveryArtifact | undefined;
  listPendingApprovals(runId?: string): ApprovalRequest[];
  decideApproval(id: string, decision: "approve" | "reject", note?: string): Promise<ApprovalRequest | undefined>;
}

export interface ServerDeps {
  store: SessionStore;
  artifacts: ArtifactStore;
  supervisor: SupervisorLike;
  teamOrchestrator: TeamOrchestratorLike;
  llm: LlmLike;
  commandRunner: CommandRunnerLike;
}

const inputSchema = z
  .object({
    topic: z.string().min(1).optional(),
    task: z.string().min(1).optional(),
    autonomous: z.boolean().optional(),
    approvalMode: z.enum(["manual", "auto_safe", "auto_all"]).optional(),
    workspaceRoot: z.string().min(1).max(200).optional(),
    filePaths: z.array(z.string().min(1)).min(1),
    testCommand: z.string().min(1).optional(),
    validationCommands: z.array(z.string().min(1)).optional(),
    validationGuidance: z.string().min(1).max(4000).optional(),
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

const chatSessionCreateSchema = z.object({
  workspaceRoot: z.string().min(1).max(200).optional(),
  autonomous: z.boolean().optional(),
  approvalMode: z.enum(["manual", "auto_safe", "auto_all"]).optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
  maxMinutes: z.number().int().min(1).max(180).optional()
});

const chatMessageSchema = z.object({
  content: z.string().min(1).max(10_000)
});

const pendingApprovalsQuerySchema = z.object({
  runId: z.string().min(1).optional()
});

const approvalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional()
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

  app.get("/api/sessions/:id/tasks", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return { tasks: deps.teamOrchestrator.getRunTasks(id) };
  });

  app.get("/api/sessions/:id/handoffs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return { handoffs: deps.teamOrchestrator.getRunHandoffs(id) };
  });

  app.get("/api/sessions/:id/discovery", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.store.get(id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return { discovery: deps.teamOrchestrator.getRunDiscovery(id) ?? null };
  });

  app.post("/api/chat/sessions", async (request, reply) => {
    const parsed = chatSessionCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const chatSession = deps.teamOrchestrator.createChatSession(parsed.data);
    return reply.code(201).send({ chatSessionId: chatSession.id });
  });

  app.get("/api/chat/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const chatSession = deps.teamOrchestrator.getChatSession(id);
    if (!chatSession) {
      return reply.code(404).send({ error: "Chat session not found" });
    }

    const latestRun = chatSession.activeRunId ? deps.store.get(chatSession.activeRunId) ?? null : null;
    const summary = chatSession.lastSummary ?? latestRun?.finalSummary ?? null;

    return {
      chatSession,
      latestRun,
      summary
    };
  });

  app.get("/api/chat/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const chatSession = deps.teamOrchestrator.getChatSession(id);
    if (!chatSession) {
      return reply.code(404).send({ error: "Chat session not found" });
    }

    return {
      messages: deps.teamOrchestrator.listChatMessages(id)
    };
  });

  app.post("/api/chat/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const chatSession = deps.teamOrchestrator.getChatSession(id);
    if (!chatSession) {
      return reply.code(404).send({ error: "Chat session not found" });
    }

    const parsed = chatMessageSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const output = await deps.teamOrchestrator.postMessage(id, parsed.data.content);
    return reply.code(202).send(output);
  });

  app.get("/api/chat/sessions/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const chatSession = deps.teamOrchestrator.getChatSession(id);
    if (!chatSession) {
      return reply.code(404).send({ error: "Chat session not found" });
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();

    const send = (data: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    for (const event of deps.teamOrchestrator.getChatEvents(id)) {
      send(event);
    }

    const unsubscribe = deps.teamOrchestrator.subscribeChat(id, (event) => send(event));
    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });

  app.get("/api/approvals/pending", async (request, reply) => {
    const parsed = pendingApprovalsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    return {
      approvals: deps.teamOrchestrator.listPendingApprovals(parsed.data.runId)
    };
  });

  app.post("/api/approvals/:id/decision", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = approvalDecisionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const approval = await deps.teamOrchestrator.decideApproval(id, parsed.data.decision, parsed.data.note);
    if (!approval) {
      return reply.code(404).send({ error: "Approval not found" });
    }
    return { approval };
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
    const approvalMode = parsed.data.approvalMode ?? "manual";
    const workspaceRoot = parsed.data.workspaceRoot?.trim() || ".";

    const sessionId = await deps.supervisor.start({
      ...parsed.data,
      topic,
      task: topic,
      autonomous,
      approvalMode,
      workspaceRoot,
      maxIterations,
      maxMinutes,
      maxAttempts: parsed.data.maxAttempts ?? maxIterations
    });
    return reply.code(202).send({ sessionId });
  });

  return app;
};
