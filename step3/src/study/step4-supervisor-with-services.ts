import { Supervisor, ArchitectAgentLike, DesignerAgentLike, DevAgentLike, PlannerAgentLike, TestAgentLike } from "../orchestrator/supervisor";
import { ArtifactStore } from "../services/artifactStore";
import { CommandRunner } from "../services/commandRunner";
import { SessionStore } from "../services/sessionStore";
import { WorkspaceService } from "../services/workspace";
import { ArchitectureArtifact, DesignArtifact, DevOutput, PlanArtifact, TestResult } from "../types";
import { printEvent } from "./common";

class MockPlannerAgent implements PlannerAgentLike {
  async createPlan(input: { sessionId: string; topic: string; filePaths: string[] }): Promise<PlanArtifact> {
    return {
      id: `plan-${input.sessionId}`,
      sessionId: input.sessionId,
      phase: "planning",
      topic: input.topic,
      goals: ["테스트 통과"],
      requirements: [{ id: "REQ-1", description: "add(2,3)은 5를 반환", priority: "must" }],
      constraints: [],
      assumptions: [],
      doneCriteria: ["테스트가 성공한다"],
      createdAt: new Date().toISOString()
    };
  }
}

class MockArchitectAgent implements ArchitectAgentLike {
  async createArchitecture(input: { sessionId: string; plan: PlanArtifact }): Promise<ArchitectureArtifact> {
    return {
      id: `arch-${input.sessionId}`,
      sessionId: input.sessionId,
      phase: "architecture",
      overview: `${input.plan.topic}를 만족하도록 단일 파일 수정`,
      modules: [{ name: "add", responsibility: "덧셈 수행", files: ["study-lab/add.cjs"] }],
      decisions: [{ title: "간단 구현", rationale: "학습 시나리오", tradeoffs: ["확장성 낮음"] }],
      risks: [{ risk: "초기값 오류", mitigation: "테스트로 검증" }],
      createdAt: new Date().toISOString()
    };
  }
}

class MockDesignerAgent implements DesignerAgentLike {
  async createDesign(input: { sessionId: string; plan: PlanArtifact; architecture: ArchitectureArtifact }): Promise<DesignArtifact> {
    return {
      id: `design-${input.sessionId}`,
      sessionId: input.sessionId,
      phase: "design",
      components: [{ name: "add function", purpose: input.plan.topic, files: ["study-lab/add.cjs"] }],
      apis: [{ name: "add(a,b)", input: "number, number", output: "number", errors: [] }],
      dataModels: [{ name: "N/A", fields: ["none"] }],
      implementationChecklist: ["return a + b 로 수정"],
      testIdeas: [input.architecture.overview],
      createdAt: new Date().toISOString()
    };
  }
}

class MockDevAgent implements DevAgentLike {
  async propose(params: {
    sessionId: string;
    iteration?: number;
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
    sessionId: string;
    iteration?: number;
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
  const artifacts = new ArtifactStore();
  const workspace = new WorkspaceService();
  const supervisor = new Supervisor(
    store,
    artifacts,
    workspace,
    new MockPlannerAgent(),
    new MockArchitectAgent(),
    new MockDesignerAgent(),
    new MockDevAgent(),
    new MockTestAgent(),
    new CommandRunner()
  );

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
