import { DevOutput } from "../types";
import { createEvent, printEvent } from "./common";

class LocalDevAgent {
  async propose(input: {
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<DevOutput> {
    const targetPath = "src/math.ts";
    const before = input.files[targetPath] ?? "";
    const fixLine = input.feedback.includes("return a + b;") ? "return a + b;" : "return a - b;";
    const after = before.includes("TODO_IMPLEMENT_ADD")
      ? before.replace("TODO_IMPLEMENT_ADD", fixLine)
      : before.replace(/return\s+[^;]+;/, fixLine);

    return {
      rationale: `${input.task} 처리. feedback 유무에 따라 수정안을 생성했습니다.`,
      changes: [{ path: targetPath, content: after }]
    };
  }
}

class LocalTestAgent {
  async evaluate(input: {
    task: string;
    exitCode: number;
    commandOutput: string;
  }): Promise<{ summary: string }> {
    if (input.exitCode === 0) {
      return { summary: `${input.task}\n성공: 모든 테스트 통과` };
    }
    return {
      summary: [
        `${input.task}`,
        "실패: add 함수 구현이 잘못됨",
        "다음 시도에서는 return a + b; 를 사용해야 함",
        `출력: ${input.commandOutput}`
      ].join("\n")
    };
  }
}

class LocalSupervisor {
  constructor(
    private readonly devAgent: LocalDevAgent,
    private readonly testAgent: LocalTestAgent,
    private readonly maxAttempts: number
  ) {}

  async run(task: string, files: Record<string, string>): Promise<void> {
    let feedback = "";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      printEvent(createEvent("supervisor", "attempt_started", `Attempt ${attempt}`));
      const devOutput = await this.devAgent.propose({ task, files, feedback });
      const change = devOutput.changes[0];
      files[change.path] = change.fallbackContent ?? change.content ?? files[change.path] ?? "";

      printEvent(
        createEvent("dev", "changes_applied", `Changed ${change.path}`, {
          rationale: devOutput.rationale
        })
      );

      const testResult = runFakeTest(files[change.path]);
      const evaluation = await this.testAgent.evaluate({
        task,
        exitCode: testResult.exitCode,
        commandOutput: testResult.output
      });

      if (testResult.exitCode === 0) {
        printEvent(createEvent("test", "tests_passed", "테스트 통과"));
        printEvent(createEvent("supervisor", "session_finished", "성공적으로 종료"));
        console.log("\n[FINAL FILE]\n" + files[change.path]);
        return;
      }

      printEvent(
        createEvent("test", "tests_failed", "테스트 실패", {
          output: testResult.output
        })
      );
      feedback = `${evaluation.summary}\n반드시 return a + b; 로 고쳐라.`;
    }

    printEvent(createEvent("supervisor", "session_finished", "최대 재시도 횟수 초과로 실패"));
  }
}

const runFakeTest = (fileContent: string): { exitCode: number; output: string } => {
  if (fileContent.includes("return a + b;")) {
    return { exitCode: 0, output: "ok: add(2, 3) === 5" };
  }
  return {
    exitCode: 1,
    output: "expected add(2, 3) === 5, received -1"
  };
};

const main = async (): Promise<void> => {
  const files: Record<string, string> = {
    "src/math.ts": "export const add = (a: number, b: number): number => {\n  TODO_IMPLEMENT_ADD\n};\n"
  };

  const supervisor = new LocalSupervisor(new LocalDevAgent(), new LocalTestAgent(), 3);
  await supervisor.run("add 함수를 요구사항대로 구현", files);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
