import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "../config";
import { GoalValidatorAgent } from "../agents/goalValidatorAgent";
import { prPackageDraftSchema } from "../schemas/step6Artifacts";
import { validationArtifactDraftSchema } from "../schemas/step4Artifacts";
import { reviewArtifactDraftSchema } from "../schemas/step5Artifacts";
import { goalValidationArtifactDraftSchema } from "../schemas/step7GoalValidation";
import { ArtifactStore } from "../services/artifactStore";
import { BudgetTracker } from "../services/budgetTracker";
import { SessionStore } from "../services/sessionStore";
import { ValidationCommandSpec, ValidationPipeline } from "../services/validationPipeline";
import {
  AppliedChangeResult,
  ArchitectureArtifact,
  BudgetExhaustedReason,
  DesignArtifact,
  DevOutput,
  FailureClassification,
  GoalValidationArtifact,
  PhaseName,
  PhaseStatus,
  PlanArtifact,
  PrPackageArtifact,
  ReviewArtifact,
  SessionInput,
  SessionState,
  SupervisorAdvice,
  TestResult,
  ValidationArtifact
} from "../types";

export interface PlannerAgentLike {
  createPlan(input: {
    sessionId: string;
    topic: string;
    filePaths: string[];
  }): Promise<PlanArtifact>;
}

export interface ArchitectAgentLike {
  createArchitecture(input: {
    sessionId: string;
    plan: PlanArtifact;
  }): Promise<ArchitectureArtifact>;
}

export interface DesignerAgentLike {
  createDesign(input: {
    sessionId: string;
    plan: PlanArtifact;
    architecture: ArchitectureArtifact;
  }): Promise<DesignArtifact>;
}

export interface ReviewerAgentLike {
  createReview(input: {
    sessionId: string;
    iteration: number;
    task: string;
    feedback: string;
    plan?: PlanArtifact;
    architecture?: ArchitectureArtifact;
    design?: DesignArtifact;
    validationSummary: string;
    validationClassification?: FailureClassification;
  }): Promise<ReviewArtifact>;
}

export interface SupervisorAdvisorLike {
  createAdvice(input: {
    sessionId: string;
    iteration: number;
    topic: string;
    feedback: string;
    validationSummary?: string;
    validationClassification?: FailureClassification;
    reviewSummary?: string;
    budget?: SessionState["budget"];
    artifactRefs?: Record<string, string | undefined>;
  }): Promise<SupervisorAdvice>;
}

export interface PackagerAgentLike {
  createPrPackage(input: {
    sessionId: string;
    iteration: number;
    topic: string;
    changedFiles: string[];
    testSummary: string;
    reviewSummary: string;
    riskNotes: string[];
    advisorNotes: string[];
    timeline: string[];
  }): Promise<Omit<PrPackageArtifact, "id" | "sessionId" | "phase" | "outputPath" | "createdAt">>;
}

export interface PrPackageWriterLike {
  write(sessionId: string, payload: unknown): Promise<{ outputPath: string }>;
}

export interface DevAgentLike {
  propose(params: {
    sessionId: string;
    iteration?: number;
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<DevOutput>;
}

export interface TestAgentLike {
  evaluate(input: {
    sessionId: string;
    iteration?: number;
    task: string;
    command?: string;
    stage?: "lint" | "type" | "test" | "custom";
    exitCode: number;
    commandOutput: string;
  }): Promise<Omit<TestResult, "passed">>;
  classifyFailure?(input: {
    task: string;
    stage: "lint" | "type" | "test" | "custom";
    command: string;
    commandOutput: string;
    summary: string;
  }): Promise<FailureClassification>;
}

export interface GoalValidatorLike {
  validate(input: {
    sessionId: string;
    iteration: number;
    topic: string;
    workspaceRoot?: string;
    changedFiles: string[];
    filePaths: string[];
  }): Promise<Omit<GoalValidationArtifact, "id" | "sessionId" | "phase" | "createdAt">>;
}

export interface WorkspaceLike {
  readFiles(filePaths: string[], workspaceRoot?: string): Promise<Record<string, string>>;
  ensureDirectory?(relativePath: string, workspaceRoot?: string): Promise<void>;
  applyChanges(changes: DevOutput["changes"], workspaceRoot?: string): Promise<AppliedChangeResult[]>;
}

export interface CommandRunnerLike {
  run(command: string, options?: { workspaceRoot?: string }): Promise<{ exitCode: number; output: string }>;
}

export interface PhaseExecutionContext {
  sessionId: string;
  session: SessionState;
  feedback: string;
  iteration?: number;
}

export interface PhaseExecutionResult {
  status?: Exclude<PhaseStatus, "pending" | "running">;
  passed?: boolean;
  summary?: string;
  feedback?: string;
  artifactId?: string;
  classification?: FailureClassification;
  data?: Record<string, unknown>;
}

export type PhaseExecutor = (context: PhaseExecutionContext) => Promise<PhaseExecutionResult>;

const phaseOrder: PhaseName[] = [
  "planning",
  "architecture",
  "design",
  "implementation",
  "goal_validation",
  "validation",
  "review",
  "packaging"
];

const preLoopPhases: PhaseName[] = ["planning", "architecture", "design"];
const finalPhases: PhaseName[] = ["packaging"];

class PhaseExecutionFailure extends Error {
  constructor(
    readonly phase: PhaseName,
    readonly iteration: number | undefined,
    readonly artifactId: string | undefined,
    readonly errorType: string,
    message: string
  ) {
    super(message);
    this.name = "PhaseExecutionFailure";
  }
}

class SessionCancelledError extends Error {
  constructor(
    message: string,
    readonly phase?: PhaseName,
    readonly iteration?: number
  ) {
    super(message);
    this.name = "SessionCancelledError";
  }
}

const asPositiveInt = (value: unknown, fallback: number, max = 180): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1) return fallback;
  return Math.min(rounded, max);
};

const dedupeStrings = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];
const implementationCommandLimit = 5;
const hasUnsafeShellChars = (command: string): boolean => /[;&|><`$]/.test(command);
const isImplementationCommandAllowed = (command: string): boolean =>
  /^(pnpm|npm)\s+/i.test(command.trim()) && !hasUnsafeShellChars(command);
const isWindowsAbsolutePath = (value: string): boolean => /^[a-zA-Z]:[\\/]/.test(value);
const hasParentTraversal = (value: string): boolean =>
  value
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .some((segment) => segment === "..");
const parseScopedImplementationCommand = (
  command: string
): { directory: string; innerCommand: string } | undefined => {
  const match = command.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|><`$]+))\s*&&\s*(.+)$/i);
  if (!match) return undefined;
  const directory = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const innerCommand = (match[4] ?? "").trim();
  if (!directory || !innerCommand) return undefined;
  return {
    directory,
    innerCommand
  };
};
const isSafeScopedDirectory = (directory: string): boolean => {
  if (!directory) return false;
  if (directory.includes("~")) return false;
  if (path.isAbsolute(directory)) return false;
  if (isWindowsAbsolutePath(directory)) return false;
  if (hasParentTraversal(directory)) return false;
  if (!/^[a-zA-Z0-9._/-]+$/.test(directory)) return false;
  return true;
};

interface NormalizedImplementationCommand {
  original: string;
  policyCommand: string;
  runCommand: string;
  workspaceRoot?: string;
  scopedDirectory?: string;
}

const formatIso = (value: string): string => {
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
};

export class Supervisor {
  private readonly phaseExecutors: Record<PhaseName, PhaseExecutor>;
  private readonly validationPipeline: ValidationPipeline;
  private readonly changedFilesBySession = new Map<string, Set<string>>();
  private readonly advisorRiskNotesBySession = new Map<string, string[]>();
  private readonly advisorNotesBySession = new Map<string, string[]>();
  private readonly activeRuns = new Set<string>();
  private readonly cancelledRuns = new Map<string, string>();

  constructor(
    private readonly store: SessionStore,
    private readonly artifactStore: ArtifactStore,
    private readonly workspace: WorkspaceLike,
    private readonly plannerAgent: PlannerAgentLike,
    private readonly architectAgent: ArchitectAgentLike,
    private readonly designerAgent: DesignerAgentLike,
    private readonly reviewerAgent: ReviewerAgentLike,
    private readonly devAgent: DevAgentLike,
    private readonly testAgent: TestAgentLike,
    private readonly commandRunner: CommandRunnerLike,
    private readonly advisorAgent?: SupervisorAdvisorLike,
    private readonly packagerAgent?: PackagerAgentLike,
    private readonly prPackageWriter?: PrPackageWriterLike,
    private readonly goalValidatorAgent: GoalValidatorLike = new GoalValidatorAgent()
  ) {
    this.phaseExecutors = {
      planning: this.runPlanningPhase.bind(this),
      architecture: this.runArchitecturePhase.bind(this),
      design: this.runDesignPhase.bind(this),
      goal_validation: this.runGoalValidationPhase.bind(this),
      review: this.runReviewPhase.bind(this),
      packaging: this.runPackagingPhase.bind(this),
      implementation: this.runImplementationPhase.bind(this),
      validation: this.runValidationPhase.bind(this)
    };

    this.validationPipeline = new ValidationPipeline(this.commandRunner, this.testAgent);
  }

  async start(input: SessionInput): Promise<string> {
    const sessionId = this.createSession(input);
    this.resume(sessionId);
    return sessionId;
  }

  createSession(input: SessionInput): string {
    const normalizedInput = this.normalizeInput(input);
    const session = this.store.create(normalizedInput);
    return session.id;
  }

  resume(sessionId: string): void {
    const current = this.store.get(sessionId);
    if (!current) return;
    if (current.status === "success" || current.status === "failed") return;
    if (this.activeRuns.has(sessionId)) return;

    this.activeRuns.add(sessionId);
    this.run(sessionId)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const latest = this.store.get(sessionId);
        if (latest?.currentPhase) {
          this.store.setPhaseStatus(sessionId, latest.currentPhase, "failed");
        }
        this.store.pushEvent(sessionId, "supervisor", "error", message, {
          phase: latest?.currentPhase,
          iteration: latest?.iteration,
          data: { errorType: "unhandled_error" }
        });
        this.store.updateStatus(sessionId, "failed", message);
      })
      .finally(() => {
        this.activeRuns.delete(sessionId);
        this.cancelledRuns.delete(sessionId);
      });
  }

  cancel(sessionId: string, reason = "Cancelled due to a newer request."): boolean {
    const current = this.store.get(sessionId);
    if (!current) return false;
    if (current.status === "success" || current.status === "failed") return false;

    this.cancelledRuns.set(sessionId, reason);
    this.store.pushEvent(sessionId, "supervisor", "session_cancel_requested", reason, {
      phase: current.currentPhase,
      iteration: current.iteration,
      data: {
        reason
      }
    });
    return true;
  }

  private normalizeInput(input: SessionInput): SessionInput {
    const maxIterations = asPositiveInt(input.maxIterations ?? input.maxAttempts, 6, 20);
    const maxMinutes = asPositiveInt(input.maxMinutes, 45, 180);
    const topic = (input.topic ?? input.task ?? "").trim();
    const workspaceRoot = input.workspaceRoot?.trim() || ".";
    if (!topic) {
      throw new Error("Session requires topic or task.");
    }

    return {
      ...input,
      topic,
      task: topic,
      workspaceRoot,
      autonomous: input.autonomous ?? true,
      maxIterations,
      maxMinutes,
      maxAttempts: maxIterations
    };
  }

  private async run(sessionId: string): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.assertNotCancelled(sessionId);

    const maxIterations = asPositiveInt(session.input.maxIterations ?? session.input.maxAttempts, 6, 20);
    const maxMinutes = asPositiveInt(session.input.maxMinutes, 45, 180);
    const budget = new BudgetTracker(maxIterations, maxMinutes, session.startedAt);

    this.store.updateStatus(sessionId, "running");
    this.store.updateBudget(sessionId, budget.snapshot({ iteration: 1 }));
    this.store.pushEvent(sessionId, "supervisor", "session_started", "Phase-based supervisor started.", {
      data: {
        topic: session.input.topic,
        workspaceRoot: session.input.workspaceRoot ?? ".",
        autonomous: session.input.autonomous,
        maxIterations,
        maxMinutes,
        phaseOrder
      }
    });

    try {
      for (const phase of preLoopPhases) {
        this.assertNotCancelled(sessionId, phase);
        const result = await this.executePhase(session, phase, "");
        if (result.status === "failed") {
          throw new PhaseExecutionFailure(phase, undefined, result.artifactId, "phase_result_failed", `${phase} phase failed.`);
        }
      }

      let feedback = "";
      let successSummary: string | undefined;
      let successIteration = 0;

      for (let iteration = 1; ; iteration += 1) {
        this.assertNotCancelled(sessionId, "implementation", iteration);
        const gate = budget.canStartIteration(iteration);
        this.store.updateBudget(sessionId, gate.snapshot);
        if (!gate.ok) {
          this.finishWithBudgetExhausted(sessionId, gate.reason ?? "iterations", iteration, gate.snapshot);
          return;
        }

        this.store.setIteration(sessionId, iteration);
        this.store.pushEvent(sessionId, "supervisor", "attempt_started", `Iteration ${iteration} started.`, {
          phase: "implementation",
          iteration,
          data: {
            budget: gate.snapshot
          }
        });

        const advice = await this.collectAdvisorAdvice(session, iteration, feedback, gate.snapshot);
        const implementationFeedback = this.composeImplementationFeedback(sessionId, feedback, advice?.feedbackPatch ?? []);

        const implementation = await this.executePhase(session, "implementation", implementationFeedback, iteration);
        this.captureChangedFiles(sessionId, implementation.data?.changedPaths);

        const goalValidation = await this.executePhase(session, "goal_validation", implementationFeedback, iteration);
        if (!goalValidation.passed) {
          feedback = [feedback, goalValidation.feedback].filter(Boolean).join("\n\n");
          continue;
        }

        const validation = await this.executePhase(session, "validation", implementationFeedback, iteration);
        if (!validation.passed) {
          feedback = [feedback, validation.feedback].filter(Boolean).join("\n\n");
          continue;
        }

        const reviewInputFeedback = [feedback, goalValidation.summary, validation.summary].filter(Boolean).join("\n\n");
        const review = await this.executePhase(session, "review", reviewInputFeedback, iteration);

        if (!review.passed) {
          feedback = [feedback, goalValidation.feedback, validation.feedback, review.feedback].filter(Boolean).join("\n\n");
          continue;
        }

        successSummary = [
          `Goal validation:\n${goalValidation.summary ?? "(none)"}`,
          `Validation:\n${validation.summary ?? "(none)"}`,
          `Review:\n${review.summary ?? "(none)"}`
        ].join("\n\n");
        successIteration = iteration;
        break;
      }

      if (!successSummary) {
        this.finishWithBudgetExhausted(sessionId, "iterations", maxIterations + 1, budget.snapshot({ iteration: maxIterations + 1 }));
        return;
      }

      for (const phase of finalPhases) {
        this.assertNotCancelled(sessionId, phase, successIteration);
        await this.executePhase(session, phase, feedback, successIteration);
      }

      this.store.updateStatus(sessionId, "success", successSummary);
      this.store.pushEvent(sessionId, "supervisor", "session_finished", "Session completed successfully.", {
        phase: "packaging",
        iteration: successIteration
      });
    } catch (error: unknown) {
      if (error instanceof SessionCancelledError) {
        const current = this.store.get(sessionId);
        const currentPhase = current?.currentPhase;
        if (currentPhase) {
          this.store.setPhaseStatus(sessionId, currentPhase, "failed");
        }
        this.markPendingPhasesSkipped(sessionId, "Skipped because session was cancelled.");
        this.store.updateStatus(sessionId, "failed", error.message);
        this.store.pushEvent(sessionId, "supervisor", "session_cancelled", error.message, {
          phase: currentPhase,
          iteration: current?.iteration,
          data: {
            reason: error.message
          }
        });
        this.store.pushEvent(sessionId, "supervisor", "session_finished", error.message, {
          phase: currentPhase,
          iteration: current?.iteration,
          data: {
            reason: "cancelled_by_new_request"
          }
        });
        return;
      }

      if (error instanceof PhaseExecutionFailure) {
        this.markRemainingPhasesSkipped(sessionId, error.phase);
        const failedSummary = `Phase ${error.phase} failed: ${error.message}`;
        this.store.updateStatus(sessionId, "failed", failedSummary);
        this.store.pushEvent(sessionId, "supervisor", "session_finished", failedSummary, {
          phase: error.phase,
          iteration: error.iteration,
          artifactId: error.artifactId,
          data: {
            errorType: error.errorType,
            errorMessage: error.message
          }
        });
        return;
      }
      throw error;
    }
  }

  private async collectAdvisorAdvice(
    session: SessionState,
    iteration: number,
    feedback: string,
    budgetSnapshot?: SessionState["budget"]
  ): Promise<SupervisorAdvice | undefined> {
    if (session.input.autonomous === false) {
      this.store.pushEvent(session.id, "advisor", "advisor_skipped", "Advisor skipped because autonomous is false.", {
        phase: "implementation",
        iteration
      });
      return undefined;
    }

    if (!this.advisorAgent) {
      this.store.pushEvent(session.id, "advisor", "advisor_skipped", "Advisor agent is not configured.", {
        phase: "implementation",
        iteration
      });
      return undefined;
    }

    const validation = this.artifactStore.get(session.id, "validation");
    const review = this.artifactStore.get(session.id, "review");

    this.store.pushEvent(session.id, "advisor", "advisor_started", "Advisor is analyzing current loop context.", {
      phase: "implementation",
      iteration,
      data: {
        artifactRefs: this.artifactStore.getRefs(session.id)
      }
    });

    try {
      const advice = await this.advisorAgent.createAdvice({
        sessionId: session.id,
        iteration,
        topic: session.input.topic ?? session.input.task ?? "",
        feedback,
        validationSummary: validation?.summary,
        validationClassification: validation?.classification,
        reviewSummary: review ? this.summarizeReview(review) : undefined,
        budget: budgetSnapshot,
        artifactRefs: this.artifactStore.getRefs(session.id)
      });

      this.store.pushEvent(session.id, "advisor", "advisor_suggested", "Advisor generated guidance.", {
        phase: "implementation",
        iteration,
        data: {
          focusSummary: advice.focusSummary,
          recommendedAction: advice.recommendedAction,
          confidence: advice.confidence,
          feedbackPatchCount: advice.feedbackPatch.length,
          riskCount: advice.riskNotes.length
        }
      });

      if (advice.feedbackPatch.length > 0) {
        this.store.pushEvent(session.id, "advisor", "advisor_applied", "Advisor feedback patch appended to implementation feedback.", {
          phase: "implementation",
          iteration,
          data: {
            feedbackPatch: advice.feedbackPatch
          }
        });
      }

      this.appendAdvisorNotes(session.id, advice);
      return advice;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.pushEvent(session.id, "advisor", "advisor_error", "Advisor failed. Continuing with existing supervisor rules.", {
        phase: "implementation",
        iteration,
        data: {
          errorMessage: message
        }
      });
      return undefined;
    }
  }

  private appendAdvisorNotes(sessionId: string, advice: SupervisorAdvice): void {
    const notes = this.advisorNotesBySession.get(sessionId) ?? [];
    this.advisorNotesBySession.set(sessionId, dedupeStrings([...notes, advice.focusSummary]).slice(0, 50));

    const risks = this.advisorRiskNotesBySession.get(sessionId) ?? [];
    this.advisorRiskNotesBySession.set(sessionId, dedupeStrings([...risks, ...advice.riskNotes]).slice(0, 50));
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runImplementationCommands(
    sessionId: string,
    iteration: number,
    commands: string[],
    workspaceRoot?: string
  ): Promise<string[]> {
    const normalized = dedupeStrings(commands);
    if (normalized.length === 0) {
      return [];
    }
    if (normalized.length > implementationCommandLimit) {
      throw new Error(
        `Implementation command action rejected: received ${normalized.length}, max allowed is ${implementationCommandLimit}.`
      );
    }

    this.store.pushEvent(sessionId, "dev", "implementation_commands_requested", `Requested ${normalized.length} command action(s).`, {
      phase: "implementation",
      iteration,
      data: {
        commands: normalized
      }
    });

    for (let index = 0; index < normalized.length; index += 1) {
      const command = normalized[index];
      const seq = `${index + 1}/${normalized.length}`;
      let normalizedCommand: NormalizedImplementationCommand;
      try {
        normalizedCommand = this.normalizeImplementationCommand(command, workspaceRoot);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.pushEvent(
          sessionId,
          "dev",
          "implementation_command_blocked",
          `Blocked unsafe implementation command (${seq}).`,
          {
            phase: "implementation",
            iteration,
            data: {
              command,
              reason: message
            }
          }
        );
        throw new Error(`Unsafe implementation command rejected: ${command} (${message})`);
      }

      if (!isImplementationCommandAllowed(normalizedCommand.policyCommand)) {
        this.store.pushEvent(
          sessionId,
          "dev",
          "implementation_command_blocked",
          `Blocked unsafe implementation command (${seq}).`,
          {
            phase: "implementation",
            iteration,
            data: {
              command
            }
          }
        );
        throw new Error(`Unsafe implementation command rejected: ${command}`);
      }

      if (normalizedCommand.scopedDirectory && typeof this.workspace.ensureDirectory === "function") {
        await this.workspace.ensureDirectory(normalizedCommand.scopedDirectory, workspaceRoot);
      }

      this.store.pushEvent(sessionId, "dev", "implementation_command_started", `Running implementation command (${seq}).`, {
        phase: "implementation",
        iteration,
        data: {
          command
        }
      });

      let commandResult: { exitCode: number; output: string };
      try {
        commandResult = await this.withTimeout(
          this.commandRunner.run(normalizedCommand.runCommand, { workspaceRoot: normalizedCommand.workspaceRoot }),
          config.maxCommandRuntimeMs,
          `implementation command "${command}"`
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.pushEvent(sessionId, "dev", "implementation_command_failed", `Implementation command runtime failed (${seq}).`, {
          phase: "implementation",
          iteration,
          data: {
            command,
            errorMessage: message
          }
        });
        throw new Error(`Implementation command failed: ${command} (${message})`);
      }

      if (commandResult.exitCode !== 0) {
        this.store.pushEvent(sessionId, "dev", "implementation_command_failed", `Implementation command exited non-zero (${seq}).`, {
          phase: "implementation",
          iteration,
          data: {
            command,
            exitCode: commandResult.exitCode,
            outputTail: commandResult.output.slice(-1000)
          }
        });
        throw new Error(`Implementation command failed with exit code ${commandResult.exitCode}: ${command}`);
      }

      this.store.pushEvent(sessionId, "dev", "implementation_command_completed", `Implementation command completed (${seq}).`, {
        phase: "implementation",
        iteration,
        data: {
          command,
          outputTail: commandResult.output.slice(-1000)
        }
      });
    }

    this.store.pushEvent(
      sessionId,
      "dev",
      "implementation_commands_completed",
      `Completed ${normalized.length} implementation command action(s).`,
      {
        phase: "implementation",
        iteration,
        data: {
          commands: normalized
        }
      }
    );

    return normalized;
  }

  private captureChangedFiles(sessionId: string, changedPaths: unknown): void {
    if (!Array.isArray(changedPaths)) {
      return;
    }

    const set = this.changedFilesBySession.get(sessionId) ?? new Set<string>();
    for (const path of changedPaths) {
      if (typeof path === "string" && path.trim()) {
        set.add(path.trim());
      }
    }
    this.changedFilesBySession.set(sessionId, set);
  }

  private normalizeImplementationCommand(command: string, workspaceRoot?: string): NormalizedImplementationCommand {
    const original = command.trim();
    const scoped = parseScopedImplementationCommand(original);
    if (!scoped) {
      return {
        original,
        policyCommand: original,
        runCommand: original,
        workspaceRoot
      };
    }

    const scopedDirectory = scoped.directory;
    if (!isSafeScopedDirectory(scopedDirectory)) {
      throw new Error(`Unsafe scoped command path: ${scopedDirectory}`);
    }

    const scopedWorkspaceRoot = workspaceRoot?.trim()
      ? path.join(workspaceRoot, scopedDirectory)
      : scopedDirectory;

    return {
      original,
      policyCommand: scoped.innerCommand,
      runCommand: scoped.innerCommand,
      workspaceRoot: scopedWorkspaceRoot,
      scopedDirectory
    };
  }

  private finishWithBudgetExhausted(
    sessionId: string,
    reason: BudgetExhaustedReason,
    iteration: number,
    snapshot: SessionState["budget"]
  ): void {
    const summary = "failed_budget_exhausted";
    if (snapshot) {
      this.store.updateBudget(sessionId, {
        ...snapshot,
        exhaustedReason: reason
      });
    }

    this.store.pushEvent(sessionId, "supervisor", "budget_exhausted", `Budget exhausted by ${reason}.`, {
      phase: "review",
      iteration,
      data: {
        reason,
        budget: snapshot
      }
    });

    this.markPendingPhasesSkipped(sessionId, "Skipped because budget was exhausted.");
    this.store.updateStatus(sessionId, "failed", summary);
    this.store.pushEvent(sessionId, "supervisor", "session_finished", summary, {
      phase: "review",
      iteration,
      data: {
        reason,
        budget: snapshot
      }
    });
  }

  private async executePhase(
    session: SessionState,
    phase: PhaseName,
    feedback: string,
    iteration?: number
  ): Promise<PhaseExecutionResult> {
    this.assertNotCancelled(session.id, phase, iteration);
    this.store.setCurrentPhase(session.id, phase);
    this.store.setPhaseStatus(session.id, phase, "running");
    this.store.pushEvent(session.id, "supervisor", "phase_started", `${phase} phase started.`, {
      phase,
      iteration
    });

    let result: PhaseExecutionResult;
    try {
      result = await this.phaseExecutors[phase]({
        sessionId: session.id,
        session,
        feedback,
        iteration
      });
      this.assertNotCancelled(session.id, phase, iteration);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = new PhaseExecutionFailure(phase, iteration, undefined, "runtime_error", message);
      this.store.setPhaseStatus(session.id, phase, "failed");
      this.store.pushEvent(session.id, "supervisor", "phase_failed", `${phase} phase failed.`, {
        phase,
        iteration,
        data: {
          errorType: failed.errorType,
          errorMessage: message
        }
      });
      throw failed;
    }

    const status = result.status ?? "completed";
    this.store.setPhaseStatus(session.id, phase, status);

    const eventType = status === "failed" ? "phase_failed" : status === "skipped" ? "phase_skipped" : "phase_completed";
    const message = `${phase} phase ${status}.`;
    this.store.pushEvent(session.id, "supervisor", eventType, message, {
      phase,
      iteration,
      artifactId: result.artifactId,
      classification: result.classification,
      data: result.data
    });

    return {
      ...result,
      status
    };
  }

  private markPhaseSkipped(sessionId: string, phase: PhaseName, message: string): void {
    this.store.setCurrentPhase(sessionId, phase);
    this.store.setPhaseStatus(sessionId, phase, "skipped");
    this.store.pushEvent(sessionId, "supervisor", "phase_skipped", message, {
      phase
    });
  }

  private markPendingPhasesSkipped(sessionId: string, message: string): void {
    const session = this.store.get(sessionId);
    if (!session?.phaseStatuses) return;
    for (const phase of phaseOrder) {
      if (session.phaseStatuses[phase] === "pending") {
        this.markPhaseSkipped(sessionId, phase, message);
      }
    }
  }

  private markRemainingPhasesSkipped(sessionId: string, failedPhase: PhaseName): void {
    const failedIndex = phaseOrder.indexOf(failedPhase);
    if (failedIndex === -1) return;

    const session = this.store.get(sessionId);
    for (const phase of phaseOrder.slice(failedIndex + 1)) {
      const status = session?.phaseStatuses?.[phase];
      if (status === "pending") {
        this.markPhaseSkipped(sessionId, phase, "Skipped because a previous phase failed.");
      }
    }
  }

  private mergeFeedback(baseFeedback: string, feedbackPatch: string[]): string {
    const mergedLines = dedupeStrings([
      ...baseFeedback.split(/\r?\n/g),
      ...feedbackPatch.flatMap((line) => line.split(/\r?\n/g))
    ]);

    return mergedLines.slice(0, 20).join("\n");
  }

  private composeImplementationFeedback(sessionId: string, feedback: string, advisorPatch: string[]): string {
    const plan = this.artifactStore.get(sessionId, "planning");
    const architecture = this.artifactStore.get(sessionId, "architecture");
    const design = this.artifactStore.get(sessionId, "design");
    const goalValidation = this.artifactStore.get(sessionId, "goal_validation");
    const review = this.artifactStore.get(sessionId, "review");

    if (!plan && !architecture && !design && !goalValidation && !review) {
      return this.mergeFeedback(feedback, advisorPatch);
    }

    const contextSummary = {
      refs: this.artifactStore.getRefs(sessionId),
      plan: plan
        ? {
            topic: plan.topic,
            goals: plan.goals.slice(0, 3),
            doneCriteria: plan.doneCriteria.slice(0, 3)
          }
        : undefined,
      architecture: architecture
        ? {
            moduleCount: architecture.modules.length,
            modules: architecture.modules.slice(0, 3).map((module) => ({
              name: module.name,
              files: module.files.slice(0, 3)
            }))
          }
        : undefined,
      design: design
        ? {
            components: design.components.slice(0, 5).map((component) => component.name),
            apis: design.apis.slice(0, 5).map((api) => api.name),
            checklist: design.implementationChecklist.slice(0, 5)
          }
        : undefined,
      goalValidation: goalValidation
        ? {
            passed: goalValidation.passed,
            failedChecks: goalValidation.checks.filter((check) => !check.passed).map((check) => check.label),
            missingTargets: goalValidation.missingTargets
          }
        : undefined,
      review: review
        ? {
            score: review.score,
            blockingIssueCount: review.blockingIssues.length,
            fixPlanCount: review.fixPlan.length
          }
        : undefined
    };

    const baseFeedback = [`Artifact context: ${JSON.stringify(contextSummary)}`, feedback].filter(Boolean).join("\n\n");
    return this.mergeFeedback(baseFeedback, advisorPatch);
  }

  private classifyValidationStage(command: string): "lint" | "type" | "test" | "custom" {
    const normalized = command.toLowerCase();
    if (normalized.includes("lint")) return "lint";
    if (normalized.includes("typecheck") || normalized.includes("tsc")) return "type";
    if (normalized.includes(" test") || normalized.endsWith("test") || normalized.includes("vitest") || normalized.includes("jest")) {
      return "test";
    }
    return "custom";
  }

  private resolveValidationCommands(input: SessionInput): ValidationCommandSpec[] {
    const explicit = (input.validationCommands ?? []).map((command) => command.trim()).filter(Boolean);
    if (explicit.length > 0) {
      return explicit.map((command) => ({
        command,
        stage: this.classifyValidationStage(command)
      }));
    }

    const testCommand = input.testCommand?.trim();
    if (!testCommand) {
      throw new Error("Session requires testCommand or validationCommands.");
    }

    return [
      { stage: "lint", command: "pnpm lint" },
      { stage: "type", command: "pnpm typecheck" },
      { stage: "test", command: testCommand }
    ];
  }

  private composeValidationTask(input: SessionInput, commands: ValidationCommandSpec[]): string {
    const topic = (input.task ?? input.topic ?? "").trim();
    const guidance = input.validationGuidance?.trim();
    const commandPlan = commands.map((spec, index) => `${index + 1}. [${spec.stage}] ${spec.command}`).join("\n");

    return [
      `Goal:\n${topic || "(no topic provided)"}`,
      guidance ? `Validation guidance from supervisor:\n${guidance}` : undefined,
      commandPlan ? `Validation command plan:\n${commandPlan}` : undefined
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private assertNotCancelled(sessionId: string, phase?: PhaseName, iteration?: number): void {
    const reason = this.cancelledRuns.get(sessionId);
    if (!reason) return;
    throw new SessionCancelledError(reason, phase, iteration);
  }

  private createValidationArtifact(input: {
    sessionId: string;
    iteration: number;
    passed: boolean;
    summary: string;
    classification?: FailureClassification;
    steps: ValidationArtifact["steps"];
  }): ValidationArtifact {
    const draft = validationArtifactDraftSchema.parse({
      iteration: input.iteration,
      passed: input.passed,
      summary: input.summary,
      classification: input.classification,
      steps: input.steps
    });

    return {
      id: randomUUID(),
      sessionId: input.sessionId,
      phase: "validation",
      ...draft,
      createdAt: new Date().toISOString()
    };
  }

  private createGoalValidationArtifact(input: {
    sessionId: string;
    iteration: number;
    passed: boolean;
    summary: string;
    checks: GoalValidationArtifact["checks"];
    missingTargets: string[];
    suggestions: string[];
  }): GoalValidationArtifact {
    const draft = goalValidationArtifactDraftSchema.parse({
      iteration: input.iteration,
      passed: input.passed,
      summary: input.summary,
      checks: input.checks,
      missingTargets: input.missingTargets,
      suggestions: input.suggestions
    });

    return {
      id: randomUUID(),
      sessionId: input.sessionId,
      phase: "goal_validation",
      ...draft,
      createdAt: new Date().toISOString()
    };
  }

  private createReviewFeedback(artifact: ReviewArtifact): string {
    const issueLines = artifact.blockingIssues.map((issue, index) => `${index + 1}. ${issue.title}\n${issue.detail}`).join("\n\n");
    const planLines = artifact.fixPlan.map((step, index) => `${index + 1}. ${step}`).join("\n");

    return [`Review blocked at iteration ${artifact.iteration}.`, `Blocking issues:\n${issueLines}`, `Fix plan:\n${planLines}`].join("\n\n");
  }

  private summarizeReview(artifact: ReviewArtifact): string {
    return [
      `score=${artifact.score}`,
      `blocking=${artifact.blockingIssues.length}`,
      `nonBlocking=${artifact.nonBlockingIssues.length}`,
      artifact.blockingIssues.length > 0 ? `fixPlan=${artifact.fixPlan.join(" | ")}` : "approved"
    ].join("; ");
  }

  private summarizeTimeline(sessionId: string): string[] {
    return this.store
      .getEvents(sessionId)
      .slice(-30)
      .map((event) => {
        const phaseText = event.phase ? `[${event.phase}${typeof event.iteration === "number" ? `#${event.iteration}` : ""}] ` : "";
        return `${formatIso(event.timestamp)} [${event.role}] ${phaseText}${event.type}: ${event.message}`;
      });
  }

  private async runPlanningPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    this.store.pushEvent(context.sessionId, "planner", "agent_started", "Planner agent is generating plan artifact.", {
      phase: "planning"
    });

    const artifact = await this.plannerAgent.createPlan({
      sessionId: context.sessionId,
      topic: context.session.input.topic ?? context.session.input.task ?? "",
      filePaths: context.session.input.filePaths
    });

    this.artifactStore.save(context.sessionId, artifact);
    this.store.setArtifactRef(context.sessionId, "planning", artifact.id);
    this.store.pushEvent(context.sessionId, "planner", "artifact_created", "Plan artifact created.", {
      phase: "planning",
      artifactId: artifact.id,
      data: {
        topic: artifact.topic,
        goals: artifact.goals
      }
    });

    return {
      status: "completed",
      artifactId: artifact.id,
      data: {
        goals: artifact.goals.length
      }
    };
  }

  private async runArchitecturePhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const plan = this.artifactStore.get(context.sessionId, "planning");
    if (!plan) {
      throw new Error("Missing planning artifact for architecture phase.");
    }

    this.store.pushEvent(context.sessionId, "architect", "agent_started", "Architect agent is generating architecture artifact.", {
      phase: "architecture",
      artifactId: plan.id
    });

    const artifact = await this.architectAgent.createArchitecture({
      sessionId: context.sessionId,
      plan
    });

    this.artifactStore.save(context.sessionId, artifact);
    this.store.setArtifactRef(context.sessionId, "architecture", artifact.id);
    this.store.pushEvent(context.sessionId, "architect", "artifact_created", "Architecture artifact created.", {
      phase: "architecture",
      artifactId: artifact.id,
      data: {
        overview: artifact.overview,
        moduleCount: artifact.modules.length
      }
    });

    return {
      status: "completed",
      artifactId: artifact.id,
      data: {
        moduleCount: artifact.modules.length
      }
    };
  }

  private async runDesignPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const plan = this.artifactStore.get(context.sessionId, "planning");
    const architecture = this.artifactStore.get(context.sessionId, "architecture");
    if (!plan || !architecture) {
      throw new Error("Missing planning/architecture artifact for design phase.");
    }

    this.store.pushEvent(context.sessionId, "designer", "agent_started", "Designer agent is generating design artifact.", {
      phase: "design",
      artifactId: architecture.id
    });

    const artifact = await this.designerAgent.createDesign({
      sessionId: context.sessionId,
      plan,
      architecture
    });

    this.artifactStore.save(context.sessionId, artifact);
    this.store.setArtifactRef(context.sessionId, "design", artifact.id);
    this.store.pushEvent(context.sessionId, "designer", "artifact_created", "Design artifact created.", {
      phase: "design",
      artifactId: artifact.id,
      data: {
        componentCount: artifact.components.length,
        apiCount: artifact.apis.length
      }
    });

    return {
      status: "completed",
      artifactId: artifact.id,
      data: {
        componentCount: artifact.components.length,
        apiCount: artifact.apis.length
      }
    };
  }

  private async runImplementationPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const iteration = context.iteration ?? 1;
    const workspaceRoot = context.session.input.workspaceRoot;
    const files = await this.workspace.readFiles(context.session.input.filePaths, workspaceRoot);

    this.store.pushEvent(context.sessionId, "dev", "agent_started", "Dev agent is generating file changes.", {
      phase: "implementation",
      iteration
    });
    const devOutput = await this.devAgent.propose({
      sessionId: context.sessionId,
      iteration,
      task: context.session.input.task ?? context.session.input.topic ?? "",
      files,
      feedback: context.feedback
    });

    const executedCommands = await this.runImplementationCommands(
      context.sessionId,
      iteration,
      devOutput.commands ?? [],
      workspaceRoot
    );

    const applyResults = await this.workspace.applyChanges(devOutput.changes, workspaceRoot);
    const changedPaths = dedupeStrings(devOutput.changes.map((change) => change.path));
    this.store.pushEvent(context.sessionId, "dev", "changes_applied", `Applied ${devOutput.changes.length} file change(s).`, {
      phase: "implementation",
      iteration,
      data: {
        rationale: devOutput.rationale,
        commands: executedCommands,
        changedPaths,
        appliedModes: applyResults.map((result) => ({ path: result.path, mode: result.mode })),
        artifactRefs: this.artifactStore.getRefs(context.sessionId)
      }
    });

    const fallbackApplied = applyResults.filter((result) => result.mode === "fallbackContent" || result.mode === "content");
    if (fallbackApplied.length > 0) {
      this.store.pushEvent(
        context.sessionId,
        "dev",
        "patch_fallback_applied",
        `Fallback content applied for ${fallbackApplied.length} file(s).`,
        {
          phase: "implementation",
          iteration,
          data: {
            paths: fallbackApplied.map((result) => result.path),
            modes: fallbackApplied.map((result) => result.mode)
          }
        }
      );
    }

    return {
      status: "completed",
      data: {
        changedPaths
      }
    };
  }

  private async runGoalValidationPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const iteration = context.iteration ?? 1;
    const topic = context.session.input.topic ?? context.session.input.task ?? "";
    const changedFiles = Array.from(this.changedFilesBySession.get(context.sessionId) ?? new Set<string>());

    this.store.pushEvent(context.sessionId, "validator", "agent_started", "Goal validator is checking requested outcomes.", {
      phase: "goal_validation",
      iteration,
      data: {
        topic,
        changedFileCount: changedFiles.length
      }
    });

    const draft = await this.goalValidatorAgent.validate({
      sessionId: context.sessionId,
      iteration,
      topic,
      workspaceRoot: context.session.input.workspaceRoot,
      changedFiles,
      filePaths: context.session.input.filePaths
    });

    const artifact = this.createGoalValidationArtifact({
      sessionId: context.sessionId,
      iteration,
      passed: draft.passed,
      summary: draft.summary,
      checks: draft.checks,
      missingTargets: draft.missingTargets,
      suggestions: draft.suggestions
    });

    this.artifactStore.save(context.sessionId, artifact);
    this.store.setArtifactRef(context.sessionId, "goal_validation", artifact.id);
    this.store.pushEvent(context.sessionId, "validator", "artifact_created", "Goal validation artifact created.", {
      phase: "goal_validation",
      iteration,
      artifactId: artifact.id,
      data: {
        passed: artifact.passed,
        checkCount: artifact.checks.length,
        missingTargets: artifact.missingTargets
      }
    });

    if (artifact.passed) {
      this.store.pushEvent(context.sessionId, "validator", "goal_validation_passed", "Requested goals are satisfied.", {
        phase: "goal_validation",
        iteration,
        artifactId: artifact.id,
        data: {
          summary: artifact.summary
        }
      });
      return {
        status: "completed",
        passed: true,
        summary: artifact.summary,
        artifactId: artifact.id,
        data: {
          checkCount: artifact.checks.length
        }
      };
    }

    const failedChecks = artifact.checks
      .filter((check) => !check.passed)
      .map((check) => `- ${check.label}: ${check.detail}`)
      .join("\n");
    const suggestions = artifact.suggestions.map((item, index) => `${index + 1}. ${item}`).join("\n");
    const feedback = [
      `Goal validation failed at iteration ${iteration}.`,
      failedChecks ? `Failed checks:\n${failedChecks}` : "",
      suggestions ? `Suggested fixes:\n${suggestions}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    this.store.pushEvent(context.sessionId, "validator", "goal_validation_failed", "Requested goals are not satisfied.", {
      phase: "goal_validation",
      iteration,
      artifactId: artifact.id,
      data: {
        summary: artifact.summary,
        missingTargets: artifact.missingTargets
      }
    });

    return {
      status: "failed",
      passed: false,
      summary: artifact.summary,
      feedback,
      artifactId: artifact.id,
      data: {
        missingTargets: artifact.missingTargets
      }
    };
  }

  private async runValidationPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const iteration = context.iteration ?? 1;
    const commands = this.resolveValidationCommands(context.session.input);
    const validationTask = this.composeValidationTask(context.session.input, commands);

    this.store.pushEvent(context.sessionId, "test", "agent_started", `Running validation pipeline with ${commands.length} command(s).`, {
      phase: "validation",
      iteration,
      data: {
        commands,
        guidance: context.session.input.validationGuidance
      }
    });

    const pipeline = await this.validationPipeline.run({
      sessionId: context.sessionId,
      iteration,
      task: validationTask,
      workspaceRoot: context.session.input.workspaceRoot,
      commands,
      timeoutMs: config.maxCommandRuntimeMs,
      onCommandStarted: (spec) => {
        this.store.pushEvent(context.sessionId, "test", "validation_command_started", `[${spec.stage}] ${spec.command}`, {
          phase: "validation",
          iteration,
          data: {
            stage: spec.stage,
            command: spec.command
          }
        });
      },
      onCommandCompleted: (step) => {
        this.store.pushEvent(context.sessionId, "test", "validation_command_completed", `[${step.stage}] command passed.`, {
          phase: "validation",
          iteration,
          data: {
            stage: step.stage,
            command: step.command,
            exitCode: step.exitCode,
            durationMs: step.durationMs,
            summary: step.summary,
            outputTail: step.output.slice(-1000)
          }
        });
      },
      onCommandFailed: (step) => {
        this.store.pushEvent(context.sessionId, "test", "validation_command_failed", `[${step.stage}] command failed.`, {
          phase: "validation",
          iteration,
          classification: step.classification,
          data: {
            stage: step.stage,
            command: step.command,
            exitCode: step.exitCode,
            durationMs: step.durationMs,
            summary: step.summary,
            outputTail: step.output.slice(-1000)
          }
        });
      }
    });

    const artifact = this.createValidationArtifact({
      sessionId: context.sessionId,
      iteration,
      passed: pipeline.passed,
      summary: pipeline.summary,
      classification: pipeline.classification,
      steps: pipeline.steps
    });
    this.artifactStore.save(context.sessionId, artifact);
    this.store.setArtifactRef(context.sessionId, "validation", artifact.id);
    this.store.pushEvent(context.sessionId, "test", "artifact_created", "Validation artifact created.", {
      phase: "validation",
      iteration,
      artifactId: artifact.id,
      classification: artifact.classification,
      data: {
        passed: artifact.passed,
        stepCount: artifact.steps.length,
        classification: artifact.classification
      }
    });

    if (pipeline.passed) {
      this.store.pushEvent(context.sessionId, "test", "tests_passed", `Iteration ${iteration} passed.`, {
        phase: "validation",
        iteration,
        artifactId: artifact.id,
        data: {
          summary: pipeline.summary
        }
      });

      return {
        status: "completed",
        passed: true,
        summary: `Success on iteration ${iteration}.\n\n${pipeline.summary}`,
        artifactId: artifact.id,
        classification: artifact.classification,
        data: {
          classification: artifact.classification
        }
      };
    }

    this.store.pushEvent(context.sessionId, "test", "tests_failed", `Iteration ${iteration} failed.`, {
      phase: "validation",
      iteration,
      artifactId: artifact.id,
      classification: pipeline.classification,
      data: {
        summary: pipeline.summary,
        classification: pipeline.classification
      }
    });

    return {
      status: "failed",
      passed: false,
      feedback: pipeline.feedback,
      summary: pipeline.summary,
      artifactId: artifact.id,
      classification: pipeline.classification,
      data: {
        classification: pipeline.classification
      }
    };
  }

  private async runReviewPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const iteration = context.iteration ?? 1;
    const plan = this.artifactStore.get(context.sessionId, "planning");
    const architecture = this.artifactStore.get(context.sessionId, "architecture");
    const design = this.artifactStore.get(context.sessionId, "design");
    const validation = this.artifactStore.get(context.sessionId, "validation");

    if (!validation) {
      throw new Error("Missing validation artifact for review phase.");
    }

    this.store.pushEvent(context.sessionId, "reviewer", "agent_started", "Reviewer agent is generating review artifact.", {
      phase: "review",
      iteration,
      artifactId: validation.id
    });

    const artifact = await this.reviewerAgent.createReview({
      sessionId: context.sessionId,
      iteration,
      task: context.session.input.task ?? context.session.input.topic ?? "",
      feedback: context.feedback,
      plan,
      architecture,
      design,
      validationSummary: validation.summary,
      validationClassification: validation.classification
    });

    const draft = reviewArtifactDraftSchema.parse({
      iteration,
      blockingIssues: artifact.blockingIssues,
      nonBlockingIssues: artifact.nonBlockingIssues,
      score: artifact.score,
      fixPlan: artifact.fixPlan
    });

    const strictArtifact: ReviewArtifact = {
      ...artifact,
      ...draft,
      phase: "review",
      iteration
    };

    this.artifactStore.save(context.sessionId, strictArtifact);
    this.store.setArtifactRef(context.sessionId, "review", strictArtifact.id);
    this.store.pushEvent(context.sessionId, "reviewer", "artifact_created", "Review artifact created.", {
      phase: "review",
      iteration,
      artifactId: strictArtifact.id,
      data: {
        score: strictArtifact.score,
        blockingCount: strictArtifact.blockingIssues.length,
        nonBlockingCount: strictArtifact.nonBlockingIssues.length
      }
    });

    if (strictArtifact.blockingIssues.length > 0) {
      this.store.pushEvent(context.sessionId, "reviewer", "review_blocking_detected", "Review found blocking issues.", {
        phase: "review",
        iteration,
        artifactId: strictArtifact.id,
        data: {
          score: strictArtifact.score,
          blockingIssues: strictArtifact.blockingIssues,
          fixPlan: strictArtifact.fixPlan
        }
      });

      return {
        status: "completed",
        passed: false,
        summary: `Review blocked with ${strictArtifact.blockingIssues.length} issue(s).`,
        feedback: this.createReviewFeedback(strictArtifact),
        artifactId: strictArtifact.id,
        data: {
          score: strictArtifact.score,
          blockingCount: strictArtifact.blockingIssues.length,
          nonBlockingCount: strictArtifact.nonBlockingIssues.length
        }
      };
    }

    this.store.pushEvent(context.sessionId, "reviewer", "review_approved", "Review approved for packaging.", {
      phase: "review",
      iteration,
      artifactId: strictArtifact.id,
      data: {
        score: strictArtifact.score,
        nonBlockingIssues: strictArtifact.nonBlockingIssues,
        fixPlan: strictArtifact.fixPlan
      }
    });

    return {
      status: "completed",
      passed: true,
      summary: `Review approved (score ${strictArtifact.score}).`,
      artifactId: strictArtifact.id,
      data: {
        score: strictArtifact.score,
        blockingCount: 0,
        nonBlockingCount: strictArtifact.nonBlockingIssues.length
      }
    };
  }

  private async runPackagingPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    if (!this.packagerAgent || !this.prPackageWriter) {
      throw new Error("Packaging dependencies are not configured.");
    }

    const iteration = context.iteration ?? Math.max(1, context.session.iteration);
    const topic = context.session.input.topic ?? context.session.input.task ?? "";
    if (/\[force_packaging_fail\]/i.test(topic)) {
      throw new Error("Forced packaging failure requested by topic token.");
    }
    const validation = this.artifactStore.get(context.sessionId, "validation");
    const review = this.artifactStore.get(context.sessionId, "review");

    if (!validation || !review) {
      throw new Error("Packaging requires latest validation and review artifacts.");
    }

    const trackedChangedFiles = Array.from(this.changedFilesBySession.get(context.sessionId) ?? new Set<string>());
    const changedFiles = dedupeStrings(trackedChangedFiles.length > 0 ? trackedChangedFiles : context.session.input.filePaths);

    const advisorRiskNotes = this.advisorRiskNotesBySession.get(context.sessionId) ?? [];
    const advisorNotes = this.advisorNotesBySession.get(context.sessionId) ?? [];
    const reviewRiskNotes = review.nonBlockingIssues.map((issue) => `${issue.title}: ${issue.detail}`);
    const riskNotes = dedupeStrings([...advisorRiskNotes, ...reviewRiskNotes]);

    this.store.pushEvent(context.sessionId, "packager", "agent_started", "Packager agent is building PR package.", {
      phase: "packaging",
      iteration,
      artifactId: review.id,
      data: {
        changedFiles: changedFiles.length,
        timelineEvents: this.store.getEvents(context.sessionId).length
      }
    });

    const draft = await this.packagerAgent.createPrPackage({
      sessionId: context.sessionId,
      iteration,
      topic,
      changedFiles,
      testSummary: validation.summary,
      reviewSummary: this.summarizeReview(review),
      riskNotes,
      advisorNotes,
      timeline: this.summarizeTimeline(context.sessionId)
    });

    const strictDraft = prPackageDraftSchema.parse({
      ...draft,
      iteration,
      topic,
      changedFiles: draft.changedFiles.length > 0 ? draft.changedFiles : changedFiles,
      riskNotes: dedupeStrings(draft.riskNotes),
      advisorNotes: dedupeStrings(draft.advisorNotes)
    });

    const outputPath = `.orchestra/sessions/${context.sessionId}/pr-package.json`;
    let artifact: PrPackageArtifact = {
      id: randomUUID(),
      sessionId: context.sessionId,
      phase: "packaging",
      ...strictDraft,
      outputPath,
      createdAt: new Date().toISOString()
    };

    this.store.pushEvent(context.sessionId, "packager", "pr_package_created", "PR package artifact created.", {
      phase: "packaging",
      iteration,
      artifactId: artifact.id,
      data: {
        title: artifact.title,
        changedFiles: artifact.changedFiles.length
      }
    });

    const writeResult = await this.prPackageWriter.write(context.sessionId, artifact);
    if (writeResult.outputPath !== artifact.outputPath) {
      artifact = {
        ...artifact,
        outputPath: writeResult.outputPath
      };
    }

    this.artifactStore.save(context.sessionId, artifact);
    this.store.setArtifactRef(context.sessionId, "packaging", artifact.id);

    this.store.pushEvent(context.sessionId, "packager", "pr_package_written", "PR package JSON written.", {
      phase: "packaging",
      iteration,
      artifactId: artifact.id,
      data: {
        outputPath: artifact.outputPath
      }
    });

    this.store.pushEvent(context.sessionId, "packager", "artifact_created", "Packaging artifact created.", {
      phase: "packaging",
      iteration,
      artifactId: artifact.id,
      data: {
        outputPath: artifact.outputPath,
        title: artifact.title
      }
    });

    return {
      status: "completed",
      passed: true,
      artifactId: artifact.id,
      summary: `PR package ready: ${artifact.title}`,
      data: {
        outputPath: artifact.outputPath,
        title: artifact.title,
        changedFiles: artifact.changedFiles.length
      }
    };
  }
}
