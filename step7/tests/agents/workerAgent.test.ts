import { describe, expect, it, vi } from "vitest";
import { WorkerAgent } from "../../src/agents/workerAgent";
import { TaskCard } from "../../src/types";

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard => {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? "task-1",
    runId: overrides.runId ?? "run-1",
    title: overrides.title ?? "task",
    objective: overrides.objective ?? "objective",
    phase: overrides.phase ?? "implementation",
    status: overrides.status ?? "queued",
    assignee: overrides.assignee ?? "worker",
    dependencies: overrides.dependencies ?? [],
    targetFiles: overrides.targetFiles ?? ["src/app.ts"],
    acceptanceCriteria: overrides.acceptanceCriteria ?? ["done"],
    commands: overrides.commands ?? [],
    retries: overrides.retries ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  };
};

describe("WorkerAgent approval mode", () => {
  it("blocks approval-needed command in manual mode", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "plan",
        changes: [{ path: "src/app.ts", content: "export const a = 1;" }],
        commands: ["git status"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "src/app.ts": "" })),
      applyChanges: vi.fn(async () => [{ path: "src/app.ts", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const result = await agent.execute({
      runId: "run-1",
      topic: "topic",
      workspaceRoot: ".",
      task: createTask(),
      approvedCommands: new Set(),
      approvalMode: "manual"
    });

    expect(result.status).toBe("blocked");
    expect(result.approvalNeed?.command).toBe("git status");
    expect(commandRunner.run).not.toHaveBeenCalled();
  });

  it("auto-approves medium command in auto_safe mode", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "plan",
        changes: [{ path: "src/app.ts", content: "export const a = 1;" }],
        commands: ["git status"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "src/app.ts": "" })),
      applyChanges: vi.fn(async () => [{ path: "src/app.ts", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const result = await agent.execute({
      runId: "run-1",
      topic: "topic",
      workspaceRoot: ".",
      task: createTask(),
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("done");
    expect(result.autoApprovedCommands?.[0]?.command).toBe("git status");
    expect(commandRunner.run).toHaveBeenCalledOnce();
    expect(workspace.applyChanges).toHaveBeenCalledOnce();
  });

  it("keeps high-risk command blocked in auto_safe mode", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "plan",
        changes: [{ path: "src/app.ts", content: "export const a = 1;" }],
        commands: ["npm publish"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "src/app.ts": "" })),
      applyChanges: vi.fn(async () => [{ path: "src/app.ts", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const result = await agent.execute({
      runId: "run-1",
      topic: "topic",
      workspaceRoot: ".",
      task: createTask(),
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("blocked");
    expect(result.approvalNeed?.command).toBe("npm publish");
    expect(commandRunner.run).not.toHaveBeenCalled();
  });

  it("executes task commands before dev proposed commands", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "plan",
        changes: [{ path: "src/app.ts", content: "export const a = 1;" }],
        commands: ["pnpm lint"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "src/app.ts": "" })),
      applyChanges: vi.fn(async () => [{ path: "src/app.ts", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const task = createTask({
      commands: ["pnpm install"]
    });

    const result = await agent.execute({
      runId: "run-1",
      topic: "topic",
      workspaceRoot: ".",
      task,
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("done");
    expect(commandRunner.run).toHaveBeenCalledTimes(2);
    expect(commandRunner.run).toHaveBeenNthCalledWith(1, "pnpm install", { workspaceRoot: "." });
    expect(commandRunner.run).toHaveBeenNthCalledWith(2, "pnpm lint", { workspaceRoot: "." });
  });

  it("normalizes safe cd && command into scoped workspace execution", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "install in scoped directory",
        changes: [{ path: "example/package.json", content: "{\"name\":\"example\"}" }],
        commands: ["cd example && pnpm install"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "example/package.json": "" })),
      ensureDirectory: vi.fn(async () => undefined),
      applyChanges: vi.fn(async () => [{ path: "example/package.json", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const result = await agent.execute({
      runId: "run-scoped",
      topic: "topic",
      workspaceRoot: ".",
      task: createTask({
        targetFiles: ["example/package.json"]
      }),
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("done");
    expect(result.executedCommands).toContain("cd example && pnpm install");
    expect(commandRunner.run).toHaveBeenCalledWith("cd example && pnpm install", { workspaceRoot: "." });
    expect(workspace.ensureDirectory).toHaveBeenCalledWith("example", ".");
  });

  it("skips out-of-scope scoped command instead of failing task", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "ignore unrelated install",
        changes: [{ path: "tests/foo.test.ts", content: "export {};" }],
        commands: ["cd example && pnpm install"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "tests/foo.test.ts": "" })),
      applyChanges: vi.fn(async () => [{ path: "tests/foo.test.ts", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const result = await agent.execute({
      runId: "run-skip",
      topic: "topic",
      workspaceRoot: ".",
      task: createTask({
        targetFiles: ["tests/foo.test.ts"]
      }),
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("done");
    expect(result.summary).toContain("Skipped 1 out-of-scope command");
    expect(result.executedCommands).toHaveLength(0);
    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(workspace.applyChanges).toHaveBeenCalledOnce();
  });

  it("rejects unsafe scoped cd path traversal", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "unsafe traversal",
        changes: [{ path: "src/app.ts", content: "export const a = 1;" }],
        commands: ["cd ../secrets && pnpm install"]
      }))
    };
    const workspace = {
      readFiles: vi.fn(async () => ({ "src/app.ts": "" })),
      applyChanges: vi.fn(async () => [{ path: "src/app.ts", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({ exitCode: 0, output: "ok" }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const result = await agent.execute({
      runId: "run-unsafe",
      topic: "topic",
      workspaceRoot: ".",
      task: createTask(),
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("Unsafe scoped command path");
    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(workspace.applyChanges).not.toHaveBeenCalled();
  });

  it("treats create-next failure as success when example project is already bootstrapped", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "reuse existing bootstrap",
        changes: [{ path: "example/src/app/page.tsx", content: "export default function Page(){return null;}" }],
        commands: []
      }))
    };
    const workspace = {
      readFiles: vi.fn(async (paths: string[]) => {
        if (paths.includes("example/package.json")) {
          return {
            "example/package.json": JSON.stringify({
              dependencies: {
                next: "16.0.0"
              }
            })
          };
        }
        return Object.fromEntries(paths.map((path) => [path, ""]));
      }),
      applyChanges: vi.fn(async () => [{ path: "example/src/app/page.tsx", mode: "content" as const }])
    };
    const commandRunner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        output: "The directory example contains files that could conflict"
      }))
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const task = createTask({
      targetFiles: ["example/package.json", "example/src/app/page.tsx"],
      commands: ["pnpm create next-app@latest example --ts --eslint --tailwind --app --src-dir --use-pnpm --yes"]
    });

    const result = await agent.execute({
      runId: "run-1",
      topic: "topic",
      workspaceRoot: ".",
      task,
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("done");
    expect(result.executedCommands).toContain("pnpm create next-app@latest example --ts --eslint --tailwind --app --src-dir --use-pnpm --yes");
    expect(workspace.applyChanges).toHaveBeenCalledOnce();
  });

  it("treats shadcn timeout as success when components.json already exists", async () => {
    const devAgent = {
      propose: vi.fn(async () => ({
        rationale: "keep bootstrap artifacts",
        changes: [{ path: "example/components.json", content: "{\"style\":\"default\"}" }],
        commands: []
      }))
    };
    const workspace = {
      readFiles: vi.fn(async (paths: string[]) => {
        if (paths.includes("example/components.json")) {
          return {
            "example/components.json": "{\"style\":\"new-york\"}"
          };
        }
        return Object.fromEntries(paths.map((path) => [path, ""]));
      }),
      applyChanges: vi.fn(async () => [{ path: "example/components.json", mode: "content" as const }])
    };
    const command = "pnpm dlx shadcn@latest init --yes --defaults --cwd example";
    const commandRunner = {
      run: vi.fn(async () => {
        throw new Error(`worker command "${command}" timed out after 600000ms`);
      })
    };

    const agent = new WorkerAgent(devAgent, workspace, commandRunner);
    const task = createTask({
      targetFiles: ["example/components.json"],
      commands: [command]
    });

    const result = await agent.execute({
      runId: "run-timeout",
      topic: "topic",
      workspaceRoot: ".",
      task,
      approvedCommands: new Set(),
      approvalMode: "auto_safe"
    });

    expect(result.status).toBe("done");
    expect(result.executedCommands).toContain(command);
    expect(workspace.applyChanges).toHaveBeenCalledOnce();
  });
});
