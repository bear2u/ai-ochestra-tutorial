import { assertConfig, config } from "./config";
import { ArchitectAgent } from "./agents/architectAgent";
import { DevAgent } from "./agents/devAgent";
import { DesignerAgent } from "./agents/designerAgent";
import { PackagerAgent } from "./agents/packagerAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { ReviewerAgent } from "./agents/reviewerAgent";
import { SupervisorAdvisorAgent } from "./agents/supervisorAdvisorAgent";
import { TestAgent } from "./agents/testAgent";
import { GoalValidatorAgent } from "./agents/goalValidatorAgent";
import { TaskDecomposerAgent } from "./agents/taskDecomposerAgent";
import { WorkerAgent } from "./agents/workerAgent";
import { OpenAiClient } from "./llm/openaiClient";
import { Supervisor } from "./orchestrator/supervisor";
import { TeamOrchestrator } from "./orchestrator/teamOrchestrator";
import { ApprovalQueue } from "./services/approvalQueue";
import { ArtifactStore } from "./services/artifactStore";
import { ChatSessionStore } from "./services/chatSessionStore";
import { CommandRunner } from "./services/commandRunner";
import { FileSelector } from "./services/fileSelector";
import { FileLockManager } from "./services/fileLockManager";
import { PrPackageWriter } from "./services/prPackageWriter";
import { RunLogArchive, RunLogSnapshot } from "./services/runLogArchive";
import { SessionStore } from "./services/sessionStore";
import { TaskGraphStore } from "./services/taskGraphStore";
import { WorkerScheduler } from "./services/workerScheduler";
import { WorkspaceService } from "./services/workspace";
import { WorkspaceIndexer } from "./services/workspaceIndexer";
import { buildApp } from "./serverApp";

const store = new SessionStore();
const artifacts = new ArtifactStore();
const workspace = new WorkspaceService();
const llm = new OpenAiClient();
const commandRunner = new CommandRunner();
const prPackageWriter = new PrPackageWriter();
const chatStore = new ChatSessionStore();
const taskGraphStore = new TaskGraphStore();
const approvalQueue = new ApprovalQueue();
const workspaceIndexer = new WorkspaceIndexer();
const fileSelector = new FileSelector();
const taskDecomposer = new TaskDecomposerAgent();
const runLogArchive = new RunLogArchive();

const logPrompt = (entry: {
  sessionId: string;
  role: "planner" | "architect" | "designer" | "dev" | "test" | "reviewer" | "advisor" | "packager";
  phase: "planning" | "architecture" | "design" | "implementation" | "validation" | "review" | "packaging";
  system: string;
  user: string;
  iteration?: number;
}): void => {
  store.pushEvent(entry.sessionId, entry.role, "prompt_logged", `${entry.role} prompt captured.`, {
    phase: entry.phase,
    iteration: entry.iteration,
    data: {
      system: entry.system,
      user: entry.user
    }
  });
};

const workerAgent = new WorkerAgent(new DevAgent(llm, logPrompt), workspace, commandRunner);
const workerScheduler = new WorkerScheduler(new FileLockManager(), 3);

const supervisor = new Supervisor(
  store,
  artifacts,
  workspace,
  new PlannerAgent(llm, undefined, logPrompt),
  new ArchitectAgent(llm, undefined, logPrompt),
  new DesignerAgent(llm, undefined, logPrompt),
  new ReviewerAgent(llm, undefined, logPrompt),
  new DevAgent(llm, logPrompt),
  new TestAgent(llm, logPrompt),
  commandRunner,
  new SupervisorAdvisorAgent(llm, logPrompt),
  new PackagerAgent(llm, logPrompt),
  prPackageWriter,
  new GoalValidatorAgent()
);

const teamOrchestrator = new TeamOrchestrator(
  store,
  chatStore,
  taskGraphStore,
  approvalQueue,
  workspace,
  workspaceIndexer,
  fileSelector,
  taskDecomposer,
  workerScheduler,
  workerAgent,
  supervisor
);

const archiveTriggerTypes = new Set([
  "session_finished",
  "session_waiting_approval",
  "task_failed",
  "task_blocked",
  "phase_failed",
  "budget_exhausted",
  "approval_requested",
  "session_blocked_without_approval"
]);

const archiveRunQueues = new Map<string, Promise<void>>();

const createRunSnapshot = (runId: string, triggerEvent: ReturnType<SessionStore["pushEvent"]>): RunLogSnapshot | undefined => {
  const session = store.get(runId);
  if (!session) return undefined;

  const chatSessionId = session.input.chatSessionId;
  const linkedChat = chatSessionId
    ? (() => {
        const chat = chatStore.get(chatSessionId);
        if (!chat) return null;
        return {
          session: chat,
          messages: chatStore.listMessages(chatSessionId),
          events: chatStore.getEvents(chatSessionId)
        };
      })()
    : null;

  return {
    version: 1,
    runId,
    archivedAt: new Date().toISOString(),
    trigger: {
      type: triggerEvent.type,
      eventId: triggerEvent.id,
      message: triggerEvent.message,
      phase: triggerEvent.phase,
      iteration: triggerEvent.iteration,
      timestamp: triggerEvent.timestamp
    },
    session,
    events: store.getEvents(runId),
    tasks: taskGraphStore.listTasks(runId),
    handoffs: taskGraphStore.listHandoffs(runId),
    discovery: taskGraphStore.getDiscovery(runId) ?? null,
    approvalsPending: approvalQueue.listPending(runId),
    artifacts: artifacts.getAll(runId),
    prPackage: artifacts.getPrPackage(runId) ?? null,
    chat: linkedChat
  };
};

const scheduleRunArchive = (runId: string, triggerEvent: ReturnType<SessionStore["pushEvent"]>): void => {
  const previous = archiveRunQueues.get(runId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const snapshot = createRunSnapshot(runId, triggerEvent);
      if (!snapshot) return;
      await runLogArchive.write(snapshot);
    });
  archiveRunQueues.set(runId, next);
};

store.subscribeAll((event) => {
  if (!archiveTriggerTypes.has(event.type)) return;
  scheduleRunArchive(event.sessionId, event);
});

const app = buildApp({
  store,
  artifacts,
  supervisor,
  teamOrchestrator,
  llm,
  commandRunner
});

const start = async (): Promise<void> => {
  assertConfig();
  await llm.assertModelAvailable();
  await app.listen({ port: config.port, host: "0.0.0.0" });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
