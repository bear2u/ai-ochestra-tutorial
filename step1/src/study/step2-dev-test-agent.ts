import { DevOutput } from "../types";
import { createEvent, printEvent } from "./common";

class LocalDevAgent {
  async propose(input: { task: string; files: Record<string, string> }): Promise<DevOutput> {
    const targetPath = "src/math.ts";
    const before = input.files[targetPath] ?? "";
    const after = before.replace("TODO_IMPLEMENT_ADD", "return a - b;");

    return {
      rationale: `${input.task}를 처리했지만 현재 제안은 잘못된 구현입니다.`,
      changes: [{ path: targetPath, content: after }]
    };
  }
}

class LocalTestAgent {
  async evaluate(input: { exitCode: number; commandOutput: string }): Promise<{ summary: string }> {
    if (input.exitCode === 0) {
      return { summary: "테스트 통과: 현재 구현은 요구사항을 만족합니다." };
    }
    return {
      summary: [
        "테스트 실패: add 함수 결과가 기대값과 다릅니다.",
        "원인: 덧셈 대신 뺄셈이 구현되었습니다.",
        "다음 액션: return a + b; 로 수정하세요."
      ].join("\n")
    };
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
  const task = "add 함수를 구현해서 2 + 3 = 5가 되게 만들기";
  const files: Record<string, string> = {
    "src/math.ts": "export const add = (a: number, b: number): number => {\n  TODO_IMPLEMENT_ADD\n};\n"
  };

  const devAgent = new LocalDevAgent();
  const testAgent = new LocalTestAgent();

  printEvent(createEvent("dev", "agent_started", "Step 2: dev 에이전트 실행"));
  const devOutput = await devAgent.propose({ task, files });
  const changedFile = devOutput.changes[0];

  printEvent(createEvent("dev", "changes_proposed", "dev 에이전트가 변경안을 제출했습니다."));

  printEvent(createEvent("test", "agent_started", "test 에이전트가 결과를 검증합니다."));
  const testResult = runFakeTest(changedFile.content);
  const evaluation = await testAgent.evaluate({
    exitCode: testResult.exitCode,
    commandOutput: testResult.output
  });

  printEvent(
    createEvent(
      "test",
      testResult.exitCode === 0 ? "tests_passed" : "tests_failed",
      testResult.exitCode === 0 ? "테스트 통과" : "테스트 실패",
      { output: testResult.output }
    )
  );

  console.log("\n[TEST AGENT SUMMARY]");
  console.log(evaluation.summary);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

