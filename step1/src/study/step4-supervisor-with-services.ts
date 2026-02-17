import { Supervisor, DevAgentLike, TestAgentLike } from "../orchestrator/supervisor";
import { CommandRunner } from "../services/commandRunner";
import { SessionStore } from "../services/sessionStore";
import { WorkspaceService } from "../services/workspace";
import { DevOutput, TestResult } from "../types";
import { printEvent } from "./common";

class MockDevAgent implements DevAgentLike {
  async propose(params: {
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<DevOutput> {
    const targetPath = "study-lab/add.cjs";
    const before = params.files[targetPath] ?? "";
    const nextReturn = params.feedback.includes("Expected 5") ? "return a + b;" : "return a - b;";
    const after = before.replace(/return\s+[^;]+;/, nextReturn);

    return {
      rationale: `${params.task} 처리. feedback 기준으로 다음 구현을 선택했습니다.`,
      changes: [{ path: targetPath, content: after }]
    };
  }
}

class MockTestAgent implements TestAgentLike {
  async evaluate(input: {
    task: string;
    exitCode: number;
    commandOutput: string;
  }): Promise<Omit<TestResult, "passed">> {
    const summary =
      input.exitCode === 0
        ? `${input.task}\n통과: 테스트 성공`
        : `${input.task}\n실패: ${input.commandOutput}\n수정: add 함수를 덧셈으로 바꾸세요.`;

    return {
      summary,
      commandOutput: input.commandOutput,
      exitCode: input.exitCode
    };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const store = new SessionStore();
  const workspace = new WorkspaceService();
  const supervisor = new Supervisor(store, workspace, new MockDevAgent(), new MockTestAgent(), new CommandRunner());

  const targetPath = "study-lab/add.cjs";
  await workspace.applyChanges([
    {
      path: targetPath,
      content: "exports.add = (a, b) => {\n  return 0;\n};\n"
    }
  ]);

  const testCommand =
    "node -e \"const { add } = require('./study-lab/add.cjs'); const v = add(2,3); if (v !== 5) { console.error('Expected 5, got ' + v); process.exit(1); } console.log('ok');\"";

  const sessionId = await supervisor.start({
    task: "add(2,3) === 5가 되도록 수정",
    filePaths: [targetPath],
    testCommand,
    maxAttempts: 3
  });

  const unsubscribe = store.subscribe(sessionId, (event) => printEvent(event));

  while (true) {
    const session = store.get(sessionId);
    if (!session) {
      break;
    }

    if (session.status === "success" || session.status === "failed") {
      unsubscribe();
      console.log(`\nFinal status: ${session.status}`);
      if (session.finalSummary) {
        console.log(session.finalSummary);
      }
      break;
    }

    await sleep(250);
  }

  const finalFile = await workspace.readFiles([targetPath]);
  console.log("\n[FINAL FILE CONTENT]");
  console.log(finalFile[targetPath]);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

