import { OpenAiClient } from "../llm/openaiClient";
import { TestResult } from "../types";

export class TestAgent {
  constructor(private readonly llm: OpenAiClient) {}

  async evaluate(input: {
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

    const summary = await this.llm.complete(system, user);
    return {
      summary,
      commandOutput: input.commandOutput,
      exitCode: input.exitCode
    };
  }
}
