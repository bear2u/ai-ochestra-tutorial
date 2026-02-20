import { describe, expect, it } from "vitest";
import { TaskDecomposerAgent } from "../../src/agents/taskDecomposerAgent";

describe("TaskDecomposerAgent", () => {
  it("uses bootstrap-only graph for pure install topic", () => {
    const agent = new TaskDecomposerAgent();
    const graph = agent.decompose({
      runId: "run-1",
      topic: "example 폴더를 만들고 NextJs16+ShadCN을 기본 설치",
      selectedFiles: ["package.json", "README.md"],
      maxParallelWorkers: 3
    });

    const bootstrap = graph.tasks.find((task) => task.title.includes("Bootstrap Example"));
    expect(bootstrap).toBeDefined();
    expect(bootstrap?.commands.some((command) => command.includes("create next-app"))).toBe(true);
    expect(bootstrap?.commands.some((command) => command.includes("shadcn") && command.includes("--defaults"))).toBe(true);

    const mergeTask = graph.tasks.find((task) => task.assignee === "coordinator");
    expect(mergeTask).toBeDefined();
    expect(mergeTask?.dependencies).toContain(bootstrap?.id);

    const workerTasks = graph.tasks.filter((task) => task.assignee === "worker" && task.id !== bootstrap?.id);
    expect(workerTasks).toHaveLength(0);
  });

  it("keeps bootstrap + worker decomposition when feature intent exists", () => {
    const agent = new TaskDecomposerAgent();
    const graph = agent.decompose({
      runId: "run-feature",
      topic: "example 폴더에 NextJs16+ShadCN 설치 후 Todo 칸반 보드를 구성해줘",
      selectedFiles: ["src/server.ts", "README.md"],
      maxParallelWorkers: 3
    });

    const bootstrap = graph.tasks.find((task) => task.title.includes("Bootstrap Example"));
    expect(bootstrap).toBeDefined();
    const workerTasks = graph.tasks.filter((task) => task.assignee === "worker" && task.id !== bootstrap?.id);
    expect(workerTasks.length).toBeGreaterThan(0);
    for (const workerTask of workerTasks) {
      expect(workerTask.dependencies).toContain(bootstrap?.id);
      expect(workerTask.targetFiles.every((file) => file.startsWith("example/"))).toBe(true);
    }
  });

  it("uses regular decomposition when bootstrap intent is absent", () => {
    const agent = new TaskDecomposerAgent();
    const graph = agent.decompose({
      runId: "run-2",
      topic: "프로젝트 리드미를 업데이트해줘",
      selectedFiles: ["README.md", "docs/guide.md"],
      maxParallelWorkers: 2
    });

    const bootstrap = graph.tasks.find((task) => task.title.includes("Bootstrap Example"));
    expect(bootstrap).toBeUndefined();
  });

  it("creates react bootstrap task for example react setup topics", () => {
    const agent = new TaskDecomposerAgent();
    const graph = agent.decompose({
      runId: "run-react",
      topic: "example 폴더를 만들고 React 를 세팅해줘",
      selectedFiles: ["package.json", "README.md"],
      maxParallelWorkers: 3
    });

    const bootstrap = graph.tasks.find((task) => task.title.includes("Bootstrap Example React"));
    expect(bootstrap).toBeDefined();
    expect(bootstrap?.commands).toContain("pnpm create vite@latest example --template react-ts");
    expect(bootstrap?.targetFiles).toEqual(
      expect.arrayContaining(["example/package.json", "example/src/main.tsx", "example/src/App.tsx"])
    );
  });
});
