import { SessionStore } from "../services/sessionStore";
import { DevOutput, PhaseName, PhaseStatus, SessionInput, SessionState, TestResult } from "../types";

export interface DevAgentLike {
  propose(params: {
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<DevOutput>;
}

export interface TestAgentLike {
  evaluate(input: {
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

export class Supervisor {
  private readonly phaseExecutors: Record<PhaseName, PhaseExecutor>;

  constructor(
    private readonly store: SessionStore,
    private readonly workspace: WorkspaceLike,
    private readonly devAgent: DevAgentLike,
    private readonly testAgent: TestAgentLike,
    private readonly commandRunner: CommandRunnerLike
  ) {
    const noOpExecutor: PhaseExecutor = async () => ({ status: "completed" });

    this.phaseExecutors = {
      planning: noOpExecutor,
      architecture: noOpExecutor,
      design: noOpExecutor,
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
        iteration: latest?.iteration
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

    for (const phase of preLoopPhases) {
      await this.executePhase(session, phase, "");
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

      await this.executePhase(session, "implementation", feedback, iteration);
      const validation = await this.executePhase(session, "validation", feedback, iteration);

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

    const result = await this.phaseExecutors[phase]({
      sessionId: session.id,
      session,
      feedback,
      iteration
    });

    const status = result.status ?? "completed";
    this.store.setPhaseStatus(session.id, phase, status);

    const eventType = status === "failed" ? "phase_failed" : status === "skipped" ? "phase_skipped" : "phase_completed";
    const message = `${phase} phase ${status}.`;
    this.store.pushEvent(session.id, "supervisor", eventType, message, {
      phase,
      iteration
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

  private async runImplementationPhase(context: PhaseExecutionContext): Promise<PhaseExecutionResult> {
    const iteration = context.iteration;
    const files = await this.workspace.readFiles(context.session.input.filePaths);

    this.store.pushEvent(context.sessionId, "dev", "agent_started", "Dev agent is generating file changes.", {
      phase: "implementation",
      iteration
    });
    const devOutput = await this.devAgent.propose({
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
          changedPaths: devOutput.changes.map((change) => change.path)
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
