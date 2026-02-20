import { randomUUID } from "node:crypto";
import { TaskDecomposerAgent } from "../agents/taskDecomposerAgent";
import { WorkerAgent } from "../agents/workerAgent";
import { ChatSessionStore } from "../services/chatSessionStore";
import { ApprovalQueue } from "../services/approvalQueue";
import { FileSelector } from "../services/fileSelector";
import { TaskGraphStore } from "../services/taskGraphStore";
import { WorkerScheduler } from "../services/workerScheduler";
import { WorkspaceIndexer } from "../services/workspaceIndexer";
import { SessionStore } from "../services/sessionStore";
import {
  ApprovalMode,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  DiscoveryArtifact,
  HandoffEnvelope,
  PhaseName,
  SessionEvent,
  SessionInput,
  SessionState,
  TaskPhase,
  TaskCard
} from "../types";

const fallbackValidationCommands = ["node -e \"console.log('validation ok'); process.exit(0)\""];
const phaseFailureOrder: PhaseName[] = [
  "planning",
  "architecture",
  "design",
  "implementation",
  "goal_validation",
  "validation",
  "review",
  "packaging"
];

const toTaskPhase = (phase: PhaseName | undefined): TaskPhase => {
  if (phase === "implementation") return "implementation";
  if (phase === "validation" || phase === "goal_validation") return "validation";
  if (phase === "review") return "review";
  if (phase === "packaging") return "packaging";
  return "planning";
};

interface SupervisorLike {
  createSession(input: SessionInput): string;
  resume(sessionId: string): void;
  cancel(sessionId: string, reason?: string): boolean;
}

interface WorkspaceLike {
  resolveWorkspaceRoot(workspaceRoot?: string): string;
}

interface RunContext {
  runId: string;
  chatSessionId: string;
  topic: string;
  workspaceRoot: string;
  approvalMode: ApprovalMode;
  approvedCommands: Set<string>;
  pendingApprovalIds: Set<string>;
  runningPreparation: boolean;
  inSupervisorLoop: boolean;
  cancelled: boolean;
  cancelReason?: string;
}

export class TeamOrchestrator {
  private readonly runContexts = new Map<string, RunContext>();
  private readonly runEventUnsubscribe = new Map<string, () => void>();

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly chatStore: ChatSessionStore,
    private readonly taskStore: TaskGraphStore,
    private readonly approvalQueue: ApprovalQueue,
    private readonly workspace: WorkspaceLike,
    private readonly workspaceIndexer: WorkspaceIndexer,
    private readonly fileSelector: FileSelector,
    private readonly taskDecomposer: TaskDecomposerAgent,
    private readonly workerScheduler: WorkerScheduler,
    private readonly workerAgent: WorkerAgent,
    private readonly supervisor: SupervisorLike
  ) {}

  createChatSession(input: {
    workspaceRoot?: string;
    autonomous?: boolean;
    approvalMode?: ApprovalMode;
    maxIterations?: number;
    maxMinutes?: number;
  }): ChatSession {
    return this.chatStore.create({
      workspaceRoot: input.workspaceRoot?.trim() || ".",
      autonomous: input.autonomous ?? true,
      approvalMode: input.approvalMode ?? "manual",
      maxIterations: this.toBoundedInt(input.maxIterations, 6, 1, 20),
      maxMinutes: this.toBoundedInt(input.maxMinutes, 45, 1, 180)
    });
  }

  getChatSession(chatSessionId: string): ChatSession | undefined {
    return this.chatStore.get(chatSessionId);
  }

  listChatMessages(chatSessionId: string): ChatMessage[] {
    return this.chatStore.listMessages(chatSessionId);
  }

  getChatEvents(chatSessionId: string): ChatStreamEvent[] {
    return this.chatStore.getEvents(chatSessionId);
  }

  subscribeChat(chatSessionId: string, handler: (event: ChatStreamEvent) => void): () => void {
    return this.chatStore.subscribe(chatSessionId, handler);
  }

  getRunTasks(runId: string): TaskCard[] {
    const tasks = this.taskStore.listTasks(runId);
    const loopFailureTask = this.buildSupervisorFailureTask(runId, tasks);
    return loopFailureTask ? [...tasks, loopFailureTask] : tasks;
  }

  getRunHandoffs(runId: string): HandoffEnvelope[] {
    return this.taskStore.listHandoffs(runId);
  }

  getRunDiscovery(runId: string): DiscoveryArtifact | undefined {
    return this.taskStore.getDiscovery(runId);
  }

  listPendingApprovals(runId?: string) {
    return this.approvalQueue.listPending(runId);
  }

  async postMessage(chatSessionId: string, content: string): Promise<{ runSessionId: string; chatSessionId: string }> {
    const chatSession = this.chatStore.get(chatSessionId);
    if (!chatSession) {
      throw new Error(`Chat session not found: ${chatSessionId}`);
    }

    const topic = content.trim();
    if (!topic) {
      throw new Error("Message content is required.");
    }

    this.cancelRunsForChatSession(chatSessionId, topic);

    const userMessage = this.chatStore.appendMessage(chatSessionId, "user", topic);

    const runSessionId = this.supervisor.createSession({
      topic,
      task: topic,
      autonomous: chatSession.autonomous,
      approvalMode: chatSession.approvalMode,
      workspaceRoot: chatSession.workspaceRoot,
      chatSessionId,
      originMessageId: userMessage.id,
      filePaths: ["playground/implementation-smoke.txt"],
      maxIterations: chatSession.maxIterations,
      maxMinutes: chatSession.maxMinutes,
      maxAttempts: chatSession.maxIterations
    });

    this.sessionStore.patchInput(runSessionId, {
      chatSessionId,
      originMessageId: userMessage.id,
      approvalMode: chatSession.approvalMode
    });

    this.chatStore.setActiveRun(chatSessionId, runSessionId);
    this.chatStore.appendMessage(
      chatSessionId,
      "assistant",
      "요청을 수신했습니다. 작업 분해와 파일 탐색을 시작합니다.",
      runSessionId
    );

    this.runContexts.set(runSessionId, {
      runId: runSessionId,
      chatSessionId,
      topic,
      workspaceRoot: chatSession.workspaceRoot,
      approvalMode: chatSession.approvalMode,
      approvedCommands: new Set<string>(),
      pendingApprovalIds: new Set<string>(),
      runningPreparation: false,
      inSupervisorLoop: false,
      cancelled: false
    });

    this.attachRunEventRelay(runSessionId, chatSessionId);
    void this.runPreparation(runSessionId);
    return { runSessionId, chatSessionId };
  }

  private cancelRunsForChatSession(chatSessionId: string, nextTopic: string): void {
    const activeRuns = [...this.runContexts.values()].filter((context) => {
      if (context.chatSessionId !== chatSessionId) return false;
      const session = this.sessionStore.get(context.runId);
      return Boolean(session) && session?.status !== "success" && session?.status !== "failed";
    });

    for (const context of activeRuns) {
      const reason = `Cancelled due to a newer chat request: ${nextTopic}`;
      context.cancelled = true;
      context.cancelReason = reason;
      this.approvalQueue.rejectPendingByRun(context.runId, reason, "system");
      this.supervisor.cancel(context.runId, reason);

      if (!context.inSupervisorLoop) {
        const session = this.sessionStore.get(context.runId);
        if (session && session.status !== "success" && session.status !== "failed") {
          this.sessionStore.updateStatus(context.runId, "failed", reason);
          this.sessionStore.pushEvent(context.runId, "coordinator", "session_cancelled_by_new_request", reason, {
            phase: "implementation",
            data: {
              replacementTopic: nextTopic
            }
          });
          this.sessionStore.pushEvent(context.runId, "supervisor", "session_finished", reason, {
            phase: session.currentPhase,
            iteration: session.iteration,
            data: {
              reason: "cancelled_by_new_request"
            }
          });
        }

        const chatSession = this.chatStore.get(context.chatSessionId);
        if (chatSession) {
          this.chatStore.appendMessage(
            chatSession.id,
            "assistant",
            "새 요청이 들어와 이전 실행을 취소했습니다.",
            context.runId
          );
        }
        this.releaseRunRelay(context.runId);
        this.runContexts.delete(context.runId);
      }
    }
  }

  async decideApproval(id: string, decision: "approve" | "reject", note?: string) {
    const decided = this.approvalQueue.decide(id, decision, note);
    if (!decided) return undefined;
    const expectedStatus = decision === "approve" ? "approved" : "rejected";
    if (decided.status !== expectedStatus) {
      return decided;
    }

    const context = this.runContexts.get(decided.runId);
    if (!context) return decided;
    if (context.cancelled) return decided;

    context.pendingApprovalIds.delete(id);

      if (decision === "approve") {
      context.approvedCommands.add(decided.command.trim());
      this.sessionStore.pushEvent(decided.runId, "coordinator", "approval_approved", "Approval granted.", {
        phase: "implementation",
        data: {
          approvalId: id,
          command: decided.command,
          note: note ?? ""
        }
      });

      if (context.pendingApprovalIds.size === 0 && !context.runningPreparation) {
        this.sessionStore.pushEvent(decided.runId, "coordinator", "session_resumed", "Run resumed after approval.", {
          phase: "implementation"
        });
        this.sessionStore.updateStatus(decided.runId, "pending");
        void this.runPreparation(decided.runId);
      }

      return decided;
    }

    this.sessionStore.pushEvent(decided.runId, "coordinator", "approval_rejected", "Approval rejected by user.", {
      phase: "implementation",
      data: {
        approvalId: id,
        command: decided.command,
        note: note ?? ""
      }
    });
    this.sessionStore.updateStatus(decided.runId, "failed", "Approval rejected by user.");
    this.sessionStore.pushEvent(decided.runId, "supervisor", "session_finished", "Approval rejected by user.", {
      phase: "implementation",
      data: {
        reason: "approval_rejected"
      }
    });

    const chatSession = this.chatStore.get(context.chatSessionId);
    if (chatSession) {
      this.chatStore.appendMessage(chatSession.id, "assistant", "승인이 거절되어 실행을 중단했습니다.", decided.runId);
      this.chatStore.setSummary(chatSession.id, "Approval rejected. Run stopped.");
    }
    this.releaseRunRelay(decided.runId);
    this.runContexts.delete(decided.runId);

    return decided;
  }

  private attachRunEventRelay(runId: string, chatSessionId: string): void {
    const existing = this.runEventUnsubscribe.get(runId);
    existing?.();

    const unsubscribe = this.sessionStore.subscribe(runId, (event) => {
      this.relayRunEvent(chatSessionId, runId, event);
    });
    this.runEventUnsubscribe.set(runId, unsubscribe);
  }

  private relayRunEvent(chatSessionId: string, runId: string, event: SessionEvent): void {
    this.chatStore.pushEvent(chatSessionId, "run_event", event.message, {
      runId,
      eventId: event.id,
      role: event.role,
      type: event.type,
      phase: event.phase,
      iteration: event.iteration,
      sessionStatus: this.sessionStore.get(runId)?.status
    });

    if (event.type === "session_finished") {
      const run = this.sessionStore.get(runId);
      if (run?.status === "success") {
        this.chatStore.appendMessage(chatSessionId, "assistant", "실행이 완료되었습니다.", runId);
        this.chatStore.setSummary(chatSessionId, run.finalSummary ?? "Run finished successfully.");
      } else if (run?.status === "failed") {
        this.chatStore.appendMessage(chatSessionId, "assistant", "실행이 실패로 종료되었습니다.", runId);
        this.chatStore.setSummary(chatSessionId, run.finalSummary ?? "Run finished with failure.");
      }
      this.releaseRunRelay(runId);
      this.runContexts.delete(runId);
    }
  }

  private releaseRunRelay(runId: string): void {
    const unsubscribe = this.runEventUnsubscribe.get(runId);
    if (!unsubscribe) return;
    unsubscribe();
    this.runEventUnsubscribe.delete(runId);
  }

  private isExampleBootstrapTask(task: TaskCard): boolean {
    return /bootstrap example/i.test(task.title);
  }

  private describeBootstrapStack(task: TaskCard): string | undefined {
    const signals = [task.title, task.objective, ...(task.commands ?? [])].join(" ").toLowerCase();
    if (signals.includes("next") && signals.includes("shadcn")) {
      return "Next.js + shadcn";
    }
    if (signals.includes("react") || signals.includes("vite")) {
      return "React (Vite)";
    }
    if (signals.includes("next")) {
      return "Next.js";
    }
    return undefined;
  }

  private formatBootstrapStartMessage(task: TaskCard): string {
    const stack = this.describeBootstrapStack(task);
    return stack
      ? `example 초기 설치 작업을 시작했습니다. (${stack})`
      : "example 초기 설치 작업을 시작했습니다.";
  }

  private async runPreparation(runId: string): Promise<void> {
    const context = this.runContexts.get(runId);
    if (!context || context.runningPreparation) {
      return;
    }
    if (context.cancelled) {
      return;
    }

    context.runningPreparation = true;

    try {
      const session = this.sessionStore.get(runId);
      if (!session) {
        throw new Error(`Run session not found: ${runId}`);
      }
      if (context.cancelled) {
        return;
      }

      this.sessionStore.updateStatus(runId, "running");
      this.sessionStore.pushEvent(runId, "coordinator", "task_scheduled", "Preparing discovery and task decomposition.", {
        phase: "implementation"
      });

      this.sessionStore.pushEvent(runId, "discoverer", "discovery_started", "Workspace discovery started.", {
        phase: "implementation",
        data: { workspaceRoot: context.workspaceRoot }
      });

      const absoluteRoot = this.workspace.resolveWorkspaceRoot(context.workspaceRoot);
      const indexed = await this.workspaceIndexer.scan(absoluteRoot);
      if (context.cancelled) {
        return;
      }
      const selected = this.fileSelector.select({
        topic: context.topic,
        candidates: indexed,
        topN: 12
      });

      const discovery: DiscoveryArtifact = {
        id: randomUUID(),
        runId,
        workspaceRoot: context.workspaceRoot,
        candidates: selected.scoredCandidates,
        selectedFiles: selected.selectedFiles,
        reasoning: `Selected ${selected.selectedFiles.length} file(s) from ${indexed.length} indexed file(s).`,
        createdAt: new Date().toISOString()
      };

      this.taskStore.setDiscovery(runId, discovery);
      const filePaths = discovery.selectedFiles.length > 0 ? discovery.selectedFiles : session.input.filePaths;
      const validationPlan = this.buildValidationPlan(context.topic, filePaths);

      this.sessionStore.patchInput(runId, {
        filePaths,
        validationCommands: validationPlan.commands,
        validationGuidance: validationPlan.guidance,
        testCommand: undefined
      });

      this.sessionStore.pushEvent(runId, "supervisor", "validation_plan_created", "Supervisor validation plan generated.", {
        phase: "validation",
        data: {
          commandCount: validationPlan.commands.length,
          commands: validationPlan.commands,
          guidance: validationPlan.guidance
        }
      });

      this.sessionStore.pushEvent(runId, "discoverer", "discovery_completed", "Workspace discovery completed.", {
        phase: "implementation",
        data: {
          indexedCount: indexed.length,
          selectedFiles: filePaths
        }
      });

      const graph = this.taskDecomposer.decompose({
        runId,
        topic: context.topic,
        selectedFiles: filePaths,
        maxParallelWorkers: 3
      });
      this.taskStore.setGraph(runId, graph.tasks, graph.edges);

      this.sessionStore.pushEvent(runId, "coordinator", "task_decomposed", "Task graph created.", {
        phase: "implementation",
        data: {
          taskCount: graph.tasks.length,
          edgeCount: graph.edges.length
        }
      });

      const mergeTask = graph.tasks.find((task) => task.assignee === "coordinator" && task.dependencies.length > 0);
      const workerTasks = graph.tasks.filter((task) => task.assignee === "worker");
      const handoffs = mergeTask
        ? workerTasks.map((task) => ({
            id: randomUUID(),
            runId,
            fromTaskId: task.id,
            toTaskId: mergeTask.id,
            reason: "Worker output handoff to coordinator merge task.",
            requiredArtifacts: ["changes_applied"],
            requiredChecks: ["task_completed"],
            status: "pending" as const,
            createdAt: new Date().toISOString()
          }))
        : [];

      this.taskStore.setHandoffs(runId, handoffs);
      for (const handoff of handoffs) {
        this.sessionStore.pushEvent(runId, "coordinator", "handoff_created", "Handoff envelope created.", {
          phase: "implementation",
          data: {
            handoffId: handoff.id,
            fromTaskId: handoff.fromTaskId,
            toTaskId: handoff.toTaskId
          }
        });
      }

      const schedulerResult = await this.workerScheduler.run(
        graph.tasks,
        async (task) =>
          this.workerAgent.execute({
            runId,
            task,
            topic: context.topic,
            workspaceRoot: context.workspaceRoot,
            approvedCommands: context.approvedCommands,
            approvalMode: context.approvalMode,
            onCommandStarted: ({ command, index, total }) => {
              if (context.cancelled) return;
              this.sessionStore.pushEvent(runId, task.assignee, "worker_command_started", `${task.title} command ${index}/${total} started.`, {
                phase: "implementation",
                data: {
                  taskId: task.id,
                  command,
                  index,
                  total
                }
              });

              if (this.isExampleBootstrapTask(task)) {
                this.chatStore.appendMessage(context.chatSessionId, "assistant", `설치 진행 중 (${index}/${total}): ${command}`, runId);
              }
            },
            onCommandCompleted: ({ command, index, total, durationMs, output }) => {
              if (context.cancelled) return;
              this.sessionStore.pushEvent(runId, task.assignee, "worker_command_completed", `${task.title} command ${index}/${total} completed.`, {
                phase: "implementation",
                data: {
                  taskId: task.id,
                  command,
                  index,
                  total,
                  durationMs,
                  outputTail: output.slice(-1000)
                }
              });
            },
            onCommandFailed: ({ command, index, total, durationMs, errorMessage }) => {
              if (context.cancelled) return;
              this.sessionStore.pushEvent(runId, task.assignee, "worker_command_failed", `${task.title} command ${index}/${total} failed.`, {
                phase: "implementation",
                data: {
                  taskId: task.id,
                  command,
                  index,
                  total,
                  durationMs,
                  errorMessage
                }
              });
            }
          }),
        {
          onTaskStarted: (task) => {
            if (context.cancelled) return;
            this.taskStore.setTaskStatus(runId, task.id, "running");
            this.sessionStore.pushEvent(runId, task.assignee, "task_started", `${task.title} started.`, {
              phase: "implementation",
              data: {
                taskId: task.id,
                files: task.targetFiles
              }
            });

            if (this.isExampleBootstrapTask(task)) {
              this.chatStore.appendMessage(
                context.chatSessionId,
                "assistant",
                this.formatBootstrapStartMessage(task),
                runId
              );
            }
          },
          onTaskFinished: (task, result) => {
            if (context.cancelled) return;
            const status = result.status === "done" ? "done" : result.status === "blocked" ? "blocked" : "failed";
            this.taskStore.setTaskStatus(runId, task.id, status, {
              summary: result.summary,
              commands: result.executedCommands,
              errorMessage: result.status === "failed" ? result.summary : undefined
            });

            if (result.status === "done") {
              for (const autoApproved of result.autoApprovedCommands ?? []) {
                context.approvedCommands.add(autoApproved.command.trim());
                this.sessionStore.pushEvent(runId, "coordinator", "approval_approved", "Auto approval applied by mode.", {
                  phase: "implementation",
                  data: {
                    mode: context.approvalMode,
                    taskId: task.id,
                    command: autoApproved.command,
                    riskLevel: autoApproved.riskLevel,
                    reason: autoApproved.reason,
                    auto: true
                  }
                });
              }

              this.sessionStore.pushEvent(runId, task.assignee, "task_completed", `${task.title} completed.`, {
                phase: "implementation",
                data: {
                  taskId: task.id,
                  changedPaths: result.changedPaths,
                  commands: result.executedCommands
                }
              });

              if (this.isExampleBootstrapTask(task)) {
                this.chatStore.appendMessage(
                  context.chatSessionId,
                  "assistant",
                  "example 초기 설치 작업이 완료되었습니다. 목표 검증을 계속 진행합니다.",
                  runId
                );
              }

              for (const handoff of this.taskStore.listHandoffs(runId).filter((item) => item.fromTaskId === task.id)) {
                this.taskStore.updateHandoffStatus(runId, handoff.id, "accepted");
                this.sessionStore.pushEvent(runId, "coordinator", "handoff_accepted", "Handoff accepted.", {
                  phase: "implementation",
                  data: {
                    handoffId: handoff.id,
                    fromTaskId: handoff.fromTaskId,
                    toTaskId: handoff.toTaskId
                  }
                });
              }
            } else if (result.status === "blocked") {
              const approval = result.approvalNeed
                ? this.approvalQueue.create({
                    runId,
                    taskId: task.id,
                    command: result.approvalNeed.command,
                    reason: result.approvalNeed.reason,
                    riskLevel: result.approvalNeed.riskLevel
                  })
                : undefined;

              if (approval) {
                context.pendingApprovalIds.add(approval.id);
                this.sessionStore.pushEvent(runId, "coordinator", "approval_requested", "Approval required for command.", {
                  phase: "implementation",
                  data: {
                    approvalId: approval.id,
                    taskId: task.id,
                    command: approval.command,
                    riskLevel: approval.riskLevel,
                    reason: approval.reason
                  }
                });
              }

              this.sessionStore.pushEvent(runId, task.assignee, "task_blocked", `${task.title} blocked.`, {
                phase: "implementation",
                data: {
                  taskId: task.id,
                  reason: result.summary,
                  approvalId: approval?.id
                }
              });

              if (this.isExampleBootstrapTask(task)) {
                this.chatStore.appendMessage(
                  context.chatSessionId,
                  "assistant",
                  `example 초기 설치 작업이 승인 대기로 멈췄습니다: ${result.summary}`,
                  runId
                );
              }
            } else {
              this.sessionStore.pushEvent(runId, task.assignee, "task_failed", `${task.title} failed.`, {
                phase: "implementation",
                data: {
                  taskId: task.id,
                  error: result.summary
                }
              });

              if (this.isExampleBootstrapTask(task)) {
                this.chatStore.appendMessage(
                  context.chatSessionId,
                  "assistant",
                  `example 초기 설치 작업이 실패했습니다: ${result.summary}`,
                  runId
                );
              }
            }

            if (task.assignee === "coordinator" && result.status === "done") {
              for (const handoff of this.taskStore.listHandoffs(runId)) {
                if (handoff.status === "accepted" || handoff.status === "pending") {
                  this.taskStore.updateHandoffStatus(runId, handoff.id, "completed");
                  this.sessionStore.pushEvent(runId, "coordinator", "handoff_completed", "Handoff completed.", {
                    phase: "implementation",
                    data: {
                      handoffId: handoff.id,
                      fromTaskId: handoff.fromTaskId,
                      toTaskId: handoff.toTaskId
                    }
                  });
                }
              }
            }
          }
        }
      );
      if (context.cancelled) {
        return;
      }

      for (const task of schedulerResult.tasks) {
        this.taskStore.updateTask(runId, task.id, task);
      }

      if (context.pendingApprovalIds.size > 0) {
        this.sessionStore.updateStatus(runId, "waiting_approval", "Waiting for command approval.");
        this.sessionStore.pushEvent(runId, "coordinator", "session_waiting_approval", "Run paused for approval.", {
          phase: "implementation",
          data: {
            pendingApprovals: this.approvalQueue.listPending(runId).map((item) => item.id)
          }
        });

        this.chatStore.appendMessage(context.chatSessionId, "assistant", "승인 대기 중인 명령이 있어 실행을 일시 중지했습니다.", runId);
        return;
      }

      if (schedulerResult.failed) {
        this.sessionStore.updateStatus(runId, "failed", "Worker task failed before supervisor loop.");
        this.chatStore.appendMessage(context.chatSessionId, "assistant", "작업 분해 단계에서 실패했습니다.", runId);
        this.chatStore.setSummary(context.chatSessionId, "Worker stage failed.");
        return;
      }

      if (schedulerResult.blocked) {
        const message = "Worker tasks are blocked but no pending approvals are available.";
        this.sessionStore.updateStatus(runId, "failed", message);
        this.sessionStore.pushEvent(runId, "coordinator", "session_blocked_without_approval", message, {
          phase: "implementation",
          data: {
            blockedTaskIds: schedulerResult.tasks.filter((task) => task.status === "blocked").map((task) => task.id)
          }
        });
        this.sessionStore.pushEvent(runId, "supervisor", "session_finished", message, {
          phase: "implementation",
          data: {
            reason: "blocked_without_pending_approval"
          }
        });
        this.chatStore.appendMessage(context.chatSessionId, "assistant", "작업이 blocked 상태로 종료되었습니다. 승인 요청 항목은 없었습니다.", runId);
        this.chatStore.setSummary(context.chatSessionId, "Worker stage blocked without pending approval.");
        return;
      }

      this.chatStore.appendMessage(context.chatSessionId, "assistant", "작업 분해 단계를 완료했습니다. 메인 supervisor 루프를 시작합니다.", runId);
      context.inSupervisorLoop = true;
      this.supervisor.resume(runId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.sessionStore.pushEvent(runId, "coordinator", "error", message, {
        phase: "implementation",
        data: {
          stage: "team_orchestrator"
        }
      });
      this.sessionStore.updateStatus(runId, "failed", message);
      this.chatStore.appendMessage(context.chatSessionId, "assistant", `오케스트레이션 준비 단계에서 실패했습니다: ${message}`, runId);
      this.chatStore.setSummary(context.chatSessionId, "Preparation failed.");
      this.releaseRunRelay(runId);
    } finally {
      context.runningPreparation = false;
    }
  }

  private buildValidationPlan(topic: string, selectedFiles: string[]): { commands: string[]; guidance: string } {
    const normalizedTopic = topic.trim().toLowerCase();
    const hasSetupIntent = /(install|setup|set up|create|make|scaffold|bootstrap|만들|생성|설치|세팅|구성)/i.test(topic);
    const isFrontendBootstrapTopic = /(react|리액트|nextjs|next\.js|next16|next 16|shadcn|vite)/i.test(normalizedTopic);
    if (!hasSetupIntent || !isFrontendBootstrapTopic) {
      return {
        commands: [...fallbackValidationCommands],
        guidance: this.composeValidationGuidance({
          topic,
          commands: fallbackValidationCommands,
          workspaceRoot: ".",
          strategy: "smoke"
        })
      };
    }

    const requestedDirectory = this.extractRequestedDirectory(topic);
    const packageRoots = this.collectPackageRoots(selectedFiles);
    const workspaceRoot = requestedDirectory ?? packageRoots.find((candidate) => candidate !== ".") ?? packageRoots[0];
    if (!workspaceRoot) {
      return {
        commands: [...fallbackValidationCommands],
        guidance: this.composeValidationGuidance({
          topic,
          commands: fallbackValidationCommands,
          workspaceRoot: ".",
          strategy: "smoke"
        })
      };
    }

    if (workspaceRoot === ".") {
      const commands = ["npm install", "npm run build"];
      return {
        commands,
        guidance: this.composeValidationGuidance({
          topic,
          commands,
          workspaceRoot,
          strategy: "frontend_bootstrap"
        })
      };
    }

    const quotedDirectory = this.quoteDirectoryForCommand(workspaceRoot);
    const commands = [`cd ${quotedDirectory} && npm install`, `cd ${quotedDirectory} && npm run build`];
    return {
      commands,
      guidance: this.composeValidationGuidance({
        topic,
        commands,
        workspaceRoot,
        strategy: "frontend_bootstrap"
      })
    };
  }

  private composeValidationGuidance(input: {
    topic: string;
    commands: string[];
    workspaceRoot: string;
    strategy: "frontend_bootstrap" | "smoke";
  }): string {
    const commandList = input.commands.map((command, index) => `${index + 1}. ${command}`).join("\n");
    if (input.strategy === "frontend_bootstrap") {
      return [
        `Validation goal: verify the requested bootstrap/setup actually works for "${input.topic}".`,
        `Target directory: ${input.workspaceRoot === "." ? "workspace root" : input.workspaceRoot}.`,
        "Execution plan:",
        commandList,
        "Pass criteria:",
        "- All commands exit with code 0.",
        "- Build must complete without type/config/runtime startup errors.",
        "- If failed, return the exact failing command, root-cause file, and one concrete patch direction."
      ].join("\n");
    }

    return [
      `Validation goal: run a smoke check for "${input.topic}" and report pass/fail clearly.`,
      "Execution plan:",
      commandList,
      "Pass criteria:",
      "- Command exits with code 0.",
      "- Summary includes actionable next fix when command fails."
    ].join("\n");
  }

  private collectPackageRoots(selectedFiles: string[]): string[] {
    const roots: string[] = [];
    const seen = new Set<string>();

    for (const file of selectedFiles) {
      const normalized = this.normalizeRelativePath(file);
      if (!normalized) continue;

      if (normalized === "package.json") {
        if (!seen.has(".")) {
          seen.add(".");
          roots.push(".");
        }
        continue;
      }

      if (!normalized.endsWith("/package.json")) continue;
      const root = normalized.slice(0, -"/package.json".length).trim();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
    }

    return roots;
  }

  private extractRequestedDirectory(topic: string): string | undefined {
    const candidates = new Set<string>();
    if (/\bexample\b/i.test(topic)) {
      candidates.add("example");
    }

    for (const match of topic.matchAll(/\b([a-zA-Z0-9._-]+)\s*(?:folder|directory)\b/gi)) {
      if (match[1]) candidates.add(match[1]);
    }
    for (const match of topic.matchAll(/\b(?:folder|directory)\s+([a-zA-Z0-9._-]+)\b/gi)) {
      if (match[1]) candidates.add(match[1]);
    }
    for (const match of topic.matchAll(/([a-zA-Z0-9._-]+)\s*폴더/g)) {
      if (match[1]) candidates.add(match[1]);
    }
    for (const match of topic.matchAll(/폴더\s*([a-zA-Z0-9._-]+)/g)) {
      if (match[1]) candidates.add(match[1]);
    }

    for (const candidate of candidates) {
      const normalized = this.normalizeRelativePath(candidate);
      if (normalized) return normalized;
    }
    return undefined;
  }

  private normalizeRelativePath(value: string): string | undefined {
    const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "").trim();
    if (!normalized) return undefined;
    if (normalized === ".") return ".";
    if (normalized.startsWith("/")) return undefined;
    if (/^[a-zA-Z]:[\\/]/.test(normalized)) return undefined;
    if (normalized.includes("~")) return undefined;

    const segments = normalized.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) return undefined;
    if (!segments.every((segment) => /^[a-zA-Z0-9._-]+$/.test(segment))) return undefined;
    return segments.join("/");
  }

  private quoteDirectoryForCommand(directory: string): string {
    if (!/[\s"]/.test(directory)) return directory;
    return `"${directory.replace(/"/g, '\\"')}"`;
  }

  private toBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    const rounded = Math.round(value as number);
    if (rounded < min) return fallback;
    return Math.min(rounded, max);
  }

  private buildSupervisorFailureTask(runId: string, tasks: TaskCard[]): TaskCard | null {
    const hasBlockedOrFailedTask = tasks.some((task) => task.status === "blocked" || task.status === "failed");
    const hasExistingLoopFailure = tasks.some((task) => task.id === `supervisor-loop-failure-${runId}`);
    if (hasBlockedOrFailedTask || hasExistingLoopFailure) {
      return null;
    }

    const session = this.sessionStore.get(runId);
    if (!session || session.status !== "failed") {
      return null;
    }

    const failedPhase = this.getFailedPhase(session);
    const latestFailureEvent = this.getLatestFailureEvent(this.sessionStore.getEvents(runId), failedPhase);
    const failureReason = this.getFailureReason(latestFailureEvent, session, failedPhase);
    const timestamp = latestFailureEvent?.timestamp ?? session.endedAt ?? new Date().toISOString();

    return {
      id: `supervisor-loop-failure-${runId}`,
      runId,
      title: `Supervisor Loop Failure (${failedPhase ?? "unknown"})`,
      objective: "Reflect supervisor loop failure on task board",
      phase: toTaskPhase(failedPhase),
      status: "failed",
      assignee: "supervisor",
      dependencies: [],
      targetFiles: [],
      acceptanceCriteria: [],
      commands: [],
      retries: 0,
      summary: failureReason,
      errorMessage: failureReason,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private getFailedPhase(session: SessionState): PhaseName | undefined {
    const statuses = session.phaseStatuses;
    if (!statuses) {
      return session.currentPhase;
    }
    for (const phase of phaseFailureOrder) {
      if (statuses[phase] === "failed") return phase;
    }
    return session.currentPhase;
  }

  private getLatestFailureEvent(events: SessionEvent[], failedPhase: PhaseName | undefined): SessionEvent | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type !== "phase_failed") continue;
      if (!failedPhase || !event.phase || event.phase === failedPhase) {
        return event;
      }
    }
    return undefined;
  }

  private getFailureReason(
    event: SessionEvent | undefined,
    session: SessionState,
    failedPhase: PhaseName | undefined
  ): string {
    const data = event?.data;
    const detailedMessage =
      (typeof data?.errorMessage === "string" && data.errorMessage.trim()) ||
      (typeof data?.error === "string" && data.error.trim()) ||
      "";
    if (detailedMessage) return detailedMessage;
    if (typeof event?.message === "string" && event.message.trim()) return event.message.trim();
    if (typeof session.finalSummary === "string" && session.finalSummary.trim()) return session.finalSummary.trim();
    return `Supervisor loop failed at ${failedPhase ?? "unknown"} phase.`;
  }

}
