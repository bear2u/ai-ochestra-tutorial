import { TestResult } from "../types";

export interface TestPromptTrace {
  sessionId: string;
  role: "test";
  phase: "validation";
  system: string;
  user: string;
  iteration?: number;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
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
};

const buildFallbackSummary = (input: { exitCode: number; commandOutput: string }): string => {
  const statusLine = input.exitCode === 0 ? "Validation command succeeded." : "Validation command failed.";
  const tail = (input.commandOutput || "(no output)").slice(-400);
  return [statusLine, `Exit code: ${input.exitCode}`, `Output tail:\n${tail}`].join("\n\n");
};

interface TextLlmLike {
  complete(system: string, user: string): Promise<string>;
}

export class TestAgent {
  constructor(
    private readonly llm: TextLlmLike,
    private readonly onPrompt?: (trace: TestPromptTrace) => void
  ) {}

  async evaluate(input: {
    sessionId: string;
    iteration?: number;
    task: string;
    exitCode: number;
    commandOutput: string;
  }): Promise<Omit<TestResult, "passed">> {
    const system = [
      "You are the test agent.",
      "Summarize test/build output for a developer in 3-6 lines.",
      "State likely root cause and the next concrete fix.",
      "Plain text only."
    ].join(" ");

    const user = [
      `Task:\n${input.task}`,
      `Exit code: ${input.exitCode}`,
      `Output:\n${input.commandOutput || "(no output)"}`
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "test",
      phase: "validation",
      system,
      user,
      iteration: input.iteration
    });

    let summary: string;
    try {
      const output = await withTimeout(this.llm.complete(system, user), 45000, "test llm call");
      summary = output.trim() || buildFallbackSummary(input);
    } catch {
      summary = buildFallbackSummary(input);
    }

    return {
      summary,
      commandOutput: input.commandOutput,
      exitCode: input.exitCode
    };
  }
}
