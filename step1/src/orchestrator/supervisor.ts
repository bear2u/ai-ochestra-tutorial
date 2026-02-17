import { CommandRunner } from "../services/commandRunner";
import { SessionStore } from "../services/sessionStore";
import { WorkspaceService } from "../services/workspace";
import { DevOutput, SessionInput, TestResult } from "../types";

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

export class Supervisor {
  constructor(
    private readonly store: SessionStore,
    private readonly workspace: WorkspaceService,
    private readonly devAgent: DevAgentLike,
    private readonly testAgent: TestAgentLike,
    private readonly commandRunner: CommandRunner
  ) {}

  async start(input: SessionInput): Promise<string> {
    const session = this.store.create(input);
    this.run(session.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.store.pushEvent(session.id, "supervisor", "error", message);
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
    this.store.pushEvent(sessionId, "supervisor", "session_started", "Supervisor loop started.", {
      maxAttempts: session.input.maxAttempts
    });

    let feedback = "";

    for (let attempt = 1; attempt <= session.input.maxAttempts; attempt += 1) {
      this.store.setAttempt(sessionId, attempt);
      this.store.pushEvent(sessionId, "supervisor", "attempt_started", `Attempt ${attempt} started.`);

      const files = await this.workspace.readFiles(session.input.filePaths);

      this.store.pushEvent(sessionId, "dev", "agent_started", "Dev agent is generating file changes.");
      const devOutput = await this.devAgent.propose({
        task: session.input.task,
        files,
        feedback
      });

      await this.workspace.applyChanges(devOutput.changes);
      this.store.pushEvent(sessionId, "dev", "changes_applied", `Applied ${devOutput.changes.length} file change(s).`, {
        rationale: devOutput.rationale,
        changedPaths: devOutput.changes.map((change) => change.path)
      });

      this.store.pushEvent(sessionId, "test", "agent_started", `Running test command: ${session.input.testCommand}`);
      const commandResult = await this.commandRunner.run(session.input.testCommand);

      const evaluation = await this.testAgent.evaluate({
        task: session.input.task,
        exitCode: commandResult.exitCode,
        commandOutput: commandResult.output
      });

      const passed = commandResult.exitCode === 0;

      this.store.pushEvent(
        sessionId,
        "test",
        passed ? "tests_passed" : "tests_failed",
        passed ? `Attempt ${attempt} passed.` : `Attempt ${attempt} failed.`,
        {
          exitCode: commandResult.exitCode,
          summary: evaluation.summary,
          outputTail: commandResult.output.slice(-1000)
        }
      );

      if (passed) {
        const finalSummary = `Success on attempt ${attempt}.\n\n${evaluation.summary}`;
        this.store.updateStatus(sessionId, "success", finalSummary);
        this.store.pushEvent(sessionId, "supervisor", "session_finished", "Session completed successfully.");
        return;
      }

      feedback = [
        `Attempt ${attempt} failed.`,
        `Exit code: ${evaluation.exitCode}`,
        `Summary:\n${evaluation.summary}`,
        `Output:\n${evaluation.commandOutput}`
      ].join("\n\n");
    }

    const failedSummary = `Failed after ${session.input.maxAttempts} attempts.`;
    this.store.updateStatus(sessionId, "failed", failedSummary);
    this.store.pushEvent(sessionId, "supervisor", "session_finished", failedSummary);
  }
}
