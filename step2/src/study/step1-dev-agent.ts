import { DevOutput } from "../types";
import { createEvent, printEvent } from "./common";

class LocalDevAgent {
  async propose(input: { task: string; files: Record<string, string> }): Promise<DevOutput> {
    const targetPath = "src/math.ts";
    const before = input.files[targetPath] ?? "";
    const after = before.replace("TODO_IMPLEMENT_ADD", "return a + b;");

    return {
      rationale: `Task 기반으로 ${targetPath}의 TODO를 구현했습니다.`,
      changes: [{ path: targetPath, content: after }]
    };
  }
}

const main = async (): Promise<void> => {
  const task = "add 함수를 구현해서 2 + 3 = 5가 되게 만들기";
  const files: Record<string, string> = {
    "src/math.ts": "export const add = (a: number, b: number): number => {\n  TODO_IMPLEMENT_ADD\n};\n"
  };

  printEvent(createEvent("dev", "agent_started", "Step 1: dev 에이전트 단독 실행"));
  const devAgent = new LocalDevAgent();
  const result = await devAgent.propose({ task, files });

  printEvent(
    createEvent("dev", "proposal_created", "파일 변경 제안을 생성했습니다.", {
      rationale: result.rationale,
      changedPaths: result.changes.map((change) => change.path)
    })
  );

  const updated = result.changes[0];
  console.log("\n[BEFORE]\n" + files[updated.path]);
  console.log("[AFTER]\n" + updated.content);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

