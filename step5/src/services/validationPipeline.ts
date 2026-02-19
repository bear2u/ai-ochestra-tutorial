import { FailureClassification, ValidationStage, ValidationStepResult } from "../types";

export interface ValidationCommandSpec {
  stage: ValidationStage;
  command: string;
}

export interface ValidationCommandRunnerLike {
  run(command: string): Promise<{ exitCode: number; output: string }>;
}

export interface ValidationTestAgentLike {
  evaluate(input: {
    sessionId: string;
    iteration?: number;
    task: string;
    command?: string;
    stage?: ValidationStage;
    exitCode: number;
    commandOutput: string;
  }): Promise<{ summary: string; commandOutput: string; exitCode: number }>;
  classifyFailure?(input: {
    task: string;
    stage: ValidationStage;
    command: string;
    commandOutput: string;
    summary: string;
  }): Promise<FailureClassification>;
}

export interface ValidationPipelineInput {
  sessionId: string;
  iteration: number;
  task: string;
  commands: ValidationCommandSpec[];
  timeoutMs?: number;
  onCommandStarted?: (input: ValidationCommandSpec) => void;
  onCommandCompleted?: (step: ValidationStepResult) => void;
  onCommandFailed?: (step: ValidationStepResult) => void;
}

export interface ValidationPipelineResult {
  passed: boolean;
  summary: string;
  steps: ValidationStepResult[];
  classification?: FailureClassification;
  feedback?: string;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Validation command timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const classifyByStage = (stage: ValidationStage): FailureClassification | undefined => {
  if (stage === "lint") return "lint";
  if (stage === "type") return "type";
  if (stage === "test") return "test";
  return undefined;
};

export class ValidationPipeline {
  constructor(
    private readonly commandRunner: ValidationCommandRunnerLike,
    private readonly testAgent: ValidationTestAgentLike
  ) {}

  async run(input: ValidationPipelineInput): Promise<ValidationPipelineResult> {
    const timeoutMs = input.timeoutMs ?? 120000;
    const steps: ValidationStepResult[] = [];

    for (const spec of input.commands) {
      input.onCommandStarted?.(spec);
      const startedAt = Date.now();

      try {
        const commandResult = await withTimeout(this.commandRunner.run(spec.command), timeoutMs);
        const evaluation = await this.testAgent.evaluate({
          sessionId: input.sessionId,
          iteration: input.iteration,
          task: input.task,
          command: spec.command,
          stage: spec.stage,
          exitCode: commandResult.exitCode,
          commandOutput: commandResult.output
        });

        const passed = commandResult.exitCode === 0;
        let classification: FailureClassification | undefined;
        if (!passed) {
          classification = classifyByStage(spec.stage);
          if (!classification && this.testAgent.classifyFailure) {
            classification = await this.testAgent.classifyFailure({
              task: input.task,
              stage: spec.stage,
              command: spec.command,
              commandOutput: commandResult.output,
              summary: evaluation.summary
            });
          }
          classification = classification ?? "unknown";
        }

        const step: ValidationStepResult = {
          stage: spec.stage,
          command: spec.command,
          passed,
          exitCode: commandResult.exitCode,
          output: commandResult.output,
          summary: evaluation.summary,
          durationMs: Date.now() - startedAt,
          classification
        };
        steps.push(step);

        if (passed) {
          input.onCommandCompleted?.(step);
          continue;
        }

        input.onCommandFailed?.(step);
        return {
          passed: false,
          summary: evaluation.summary,
          steps,
          classification,
          feedback: [
            `Validation failed at stage: ${spec.stage}`,
            `Command: ${spec.command}`,
            `Exit code: ${commandResult.exitCode}`,
            `Classification: ${classification ?? "unknown"}`,
            `Summary:\n${evaluation.summary}`,
            `Output:\n${commandResult.output}`
          ].join("\n\n")
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const output = `Runtime failure while running "${spec.command}": ${message}`;
        const evaluation = await this.testAgent.evaluate({
          sessionId: input.sessionId,
          iteration: input.iteration,
          task: input.task,
          command: spec.command,
          stage: spec.stage,
          exitCode: -1,
          commandOutput: output
        });

        const step: ValidationStepResult = {
          stage: spec.stage,
          command: spec.command,
          passed: false,
          exitCode: -1,
          output,
          summary: evaluation.summary,
          durationMs: Date.now() - startedAt,
          classification: "runtime"
        };
        steps.push(step);
        input.onCommandFailed?.(step);

        return {
          passed: false,
          summary: evaluation.summary,
          steps,
          classification: "runtime",
          feedback: [
            `Validation runtime failure at stage: ${spec.stage}`,
            `Command: ${spec.command}`,
            `Summary:\n${evaluation.summary}`,
            `Output:\n${output}`
          ].join("\n\n")
        };
      }
    }

    const finalSummary = steps.map((step) => `${step.stage}: ${step.summary}`).join("\n");
    return {
      passed: true,
      summary: finalSummary || "Validation pipeline passed.",
      steps
    };
  }
}
