import { ArtifactStore } from "../services/artifactStore";
import { SessionStore } from "../services/sessionStore";
import {
  ArchitectureArtifact,
  DesignArtifact,
  DevOutput,
  PhaseName,
  PhaseStatus,
  PlanArtifact,
  SessionInput,
  SessionState,
  TestResult
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
    exitCode: number;
    commandOutput: string;
  }): Promise<Omit<TestResult, "passed">>;
}

export interface WorkspaceLike {
  readFiles(filePaths: string[]): Promise<Record<string, string>>;
  applyChanges(changes: DevOutput["changes"]): Promise<void>;
}

export interface CommandRunnerLike {
  run(command: string): Promise<{ exitCode: number; output: string }>;
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
  data?: Record<string, unknown>;
}

export type PhaseExecutor = (context: PhaseExecutionContext) => Promise<PhaseExecutionResult>;

const phaseOrder: PhaseName[] = [
  "planning",
  "architecture",
  "design",
  "implementation",
  "validation",
  "review",
  "packaging"
];

const preLoopPhases: PhaseName[] = ["planning", "architecture", "design"];
const postLoopPhases: PhaseName[] = ["review", "packaging"];

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

export class Supervisor {
  private readonly phaseExecutors: Record<PhaseName, PhaseExecutor>;

  constructor(
    private readonly store: SessionStore,
    private readonly artifactStore: ArtifactStore,
    private readonly workspace: WorkspaceLike,
    private readonly plannerAgent: PlannerAgentLike,
    private readonly architectAgent: ArchitectAgentLike,
    private readonly designerAgent: DesignerAgentLike,
    private readonly devAgent: DevAgentLike,
    private readonly testAgent: TestAgentLike,
    private readonly commandRunner: CommandRunnerLike
  ) {
    const noOpExecutor: PhaseExecutor = async () => ({ status: "completed" });

    this.phaseExecutors = {
      planning: this.runPlanningPhase.bind(this),
      architecture: this.runArchitecturePhase.bind(this),
      design: this.runDesignPhase.bind(this),
      review: noOpExecutor,
      packaging: noOpExecutor,
      implementation: this.runImplementationPhase.bind(this),
      validation: this.runValidationPhase.bind(this)
    };
  }

  async start(input: SessionInput): Promise<string> {
    const session = this.store.create(input);
    this.run(session.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const latest = this.store.get(session.id);
      if (latest?.currentPhase) {
        this.store.setPhaseStatus(session.id, latest.currentPhase, "failed");
      }
      this.store.pushEvent(session.id, "supervisor", "error", message, {
        phase: latest?.currentPhase,
        iteration: latest?.iteration,
        data: { errorType: "unhandled_error" }
      });
      this.store.updateStatus(session.id, "failed", message);
    });
    return session.id;
  }

  private async run(sessionId: string): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.store.updateStatus(sessionId, "running");
    this.store.pushEvent(sessionId, "supervisor", "session_started", "Phase-based supervisor started.", {
      data: {
        maxAttempts: session.input.maxAttempts,
        phaseOrder
      }
    });

    try {
      for (const phase of preLoopPhases) {
        const result = await this.executePhase(session, phase, "");
        if (result.status === "failed") {
          throw new PhaseExecutionFailure(phase, undefined, result.artifactId, "phase_result_failed", `${phase} phase failed.`);
        }
      }

      let feedback = "";
      let successSummary: string | undefined;
      let successIteration = 0;

      for (let iteration = 1; iteration <= session.input.maxAttempts; iteration += 1) {
        this.store.setIteration(sessionId, iteration);
        this.store.pushEvent(sessionId, "supervisor", "attempt_started", `Iteration ${iteration} started.`, {
          phase: "implementation",
          iteration
        });

        const implementationFeedback = this.composeImplementationFeedback(sessionId, feedback);
        await this.executePhase(session, "implementation", implementationFeedback, iteration);
        const validation = await this.executePhase(session, "validation", implementationFeedback, iteration);

        if (validation.passed) {
          successSummary = validation.summary;
          successIteration = iteration;
          break;
        }

        feedback = validation.feedback ?? feedback;
      }

      if (!successSummary) {
        for (const phase of postLoopPhases) {
          this.markPhaseSkipped(sessionId, phase, "Skipped because validation did not pass.");
        }
        const failedSummary = `Failed after ${session.input.maxAttempts} attempts.`;
        this.store.updateStatus(sessionId, "failed", failedSummary);
        this.store.pushEvent(sessionId, "supervisor", "session_finished", failedSummary, {
          phase: "validation",
          iteration: session.input.maxAttempts
        });
        return;
      }

      for (const phase of postLoopPhases) {
        await this.executePhase(session, phase, feedback, successIteration);
      }

      this.store.updateStatus(sessionId, "success", successSummary);
      this.store.pushEvent(sessionId, "supervisor", "session_finished", "Session completed successfully.", {
        phase: "packaging",
        iteration: successIteration
      });
    } catch (error: unknown) {
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

  private async executePhase(
    session: SessionState,
    phase: PhaseName,
    feedback: string,
    iteration?: number
  ): Promise<PhaseExecutionResult> {
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

  private composeImplementationFeedback(sessionId: string, feedback: string): string {
    const plan = this.artifactStore.get<PlanArtifact>(sessionId, "planning");
    const architecture = this.artifactStore.get<ArchitectureArtifact>(sessionId, "architecture");
    const design = this.artifactStore.get<DesignArtifact>(sessionId, "design");

    if (!plan && !architecture && !design) {
      return feedback;
    }

    const context = {
      refs: this.artifactStore.getRefs(sessionId),
      plan: plan
        ? {
            topic: plan.topic,
            goals: plan.goals,
            doneCriteria: plan.doneCriteria
          }
        : undefined,
      architecture: architecture
        ? {
            overview: architecture.overview,
            modules: architecture.modules.map((module) => ({
              name: module.name,
              files: module.files
            }))
          }
        : undefined,
      design: design
        ? {
            components: design.components.map((component) => component.name),
            apis: design.apis.map((api) => api.name),
            implementationChecklist: design.implementationChecklist
          }
        : undefined
    };

    return [`Artifact context:\n${JSON.stringify(context, null, 2)}`, feedback].filter(Boolean).join("\n\n");
  }

  private async runPlanningPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    this.store.pushEvent(context.sessionId, "planner", "agent_started", "Planner agent is generating plan artifact.", {
      phase: "planning"
    });

    const artifact = await this.plannerAgent.createPlan({
      sessionId: context.sessionId,
      topic: context.session.input.task,
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
    const plan = this.artifactStore.get<PlanArtifact>(context.sessionId, "planning");
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
    const plan = this.artifactStore.get<PlanArtifact>(context.sessionId, "planning");
    const architecture = this.artifactStore.get<ArchitectureArtifact>(context.sessionId, "architecture");
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
    const iteration = context.iteration;
    const files = await this.workspace.readFiles(context.session.input.filePaths);

    this.store.pushEvent(context.sessionId, "dev", "agent_started", "Dev agent is generating file changes.", {
      phase: "implementation",
      iteration
    });
    const devOutput = await this.devAgent.propose({
      sessionId: context.sessionId,
      iteration,
      task: context.session.input.task,
      files,
      feedback: context.feedback
    });

    await this.workspace.applyChanges(devOutput.changes);
    this.store.pushEvent(
      context.sessionId,
      "dev",
      "changes_applied",
      `Applied ${devOutput.changes.length} file change(s).`,
      {
        phase: "implementation",
        iteration,
        data: {
          rationale: devOutput.rationale,
          changedPaths: devOutput.changes.map((change) => change.path),
          artifactRefs: this.artifactStore.getRefs(context.sessionId)
        }
      }
    );

    return { status: "completed" };
  }

  private async runValidationPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const iteration = context.iteration;
    this.store.pushEvent(
      context.sessionId,
      "test",
      "agent_started",
      `Running test command: ${context.session.input.testCommand}`,
      {
        phase: "validation",
        iteration
      }
    );
    const commandResult = await this.commandRunner.run(context.session.input.testCommand);

    const evaluation = await this.testAgent.evaluate({
      sessionId: context.sessionId,
      iteration,
      task: context.session.input.task,
      exitCode: commandResult.exitCode,
      commandOutput: commandResult.output
    });

    const passed = commandResult.exitCode === 0;
    this.store.pushEvent(
      context.sessionId,
      "test",
      passed ? "tests_passed" : "tests_failed",
      passed ? `Iteration ${iteration} passed.` : `Iteration ${iteration} failed.`,
      {
        phase: "validation",
        iteration,
        data: {
          exitCode: commandResult.exitCode,
          summary: evaluation.summary,
          outputTail: commandResult.output.slice(-1000)
        }
      }
    );

    if (passed) {
      return {
        status: "completed",
        passed: true,
        summary: `Success on iteration ${iteration}.\n\n${evaluation.summary}`
      };
    }

    const feedback = [
      `Iteration ${iteration} failed.`,
      `Exit code: ${evaluation.exitCode}`,
      `Summary:\n${evaluation.summary}`,
      `Output:\n${evaluation.commandOutput}`
    ].join("\n\n");

    return {
      status: "failed",
      passed: false,
      feedback,
      summary: evaluation.summary
    };
  }
}
