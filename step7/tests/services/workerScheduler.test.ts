import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { WorkerScheduler } from "../../src/services/workerScheduler";
import { TaskCard } from "../../src/types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard => {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
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
    handoffRequired: overrides.handoffRequired ?? false,
    retries: overrides.retries ?? 0,
    summary: overrides.summary,
    errorMessage: overrides.errorMessage,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  };
};

describe("WorkerScheduler", () => {
  it("respects file locks while scheduling in parallel", async () => {
    const scheduler = new WorkerScheduler(undefined, 2);

    const tasks = [
      createTask({ id: "t1", title: "t1", targetFiles: ["src/same.ts"] }),
      createTask({ id: "t2", title: "t2", targetFiles: ["src/same.ts"] })
    ];

    let running = 0;
    let maxRunning = 0;

    const result = await scheduler.run(tasks, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await wait(20);
      running -= 1;
      return {
        status: "done",
        summary: "ok",
        changedPaths: ["src/same.ts"],
        executedCommands: []
      } as const;
    });

    expect(maxRunning).toBe(1);
    expect(result.failed).toBe(false);
    expect(result.tasks.every((task) => task.status === "done")).toBe(true);
  });

  it("marks dependent tasks blocked when dependency is blocked", async () => {
    const scheduler = new WorkerScheduler(undefined, 3);

    const first = createTask({ id: "t1", title: "t1" });
    const second = createTask({ id: "t2", title: "t2", dependencies: ["t1"] });

    const result = await scheduler.run([first, second], async (task) => {
      if (task.id === "t1") {
        return {
          status: "blocked",
          summary: "approval required",
          changedPaths: [],
          executedCommands: []
        } as const;
      }

      return {
        status: "done",
        summary: "should not run",
        changedPaths: [],
        executedCommands: []
      } as const;
    });

    const t2 = result.tasks.find((task) => task.id === "t2");
    expect(result.blocked).toBe(true);
    expect(t2?.status).toBe("blocked");
  });
});
