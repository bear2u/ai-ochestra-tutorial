import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunLogArchive, RunLogSnapshot } from "../../src/services/runLogArchive";

const tmpDirs: string[] = [];

const createSnapshot = (runId: string, triggerType: string): RunLogSnapshot =>
  ({
    version: 1,
    runId,
    archivedAt: new Date().toISOString(),
    trigger: {
      type: triggerType,
      eventId: `${runId}-event`,
      message: `${triggerType} happened`,
      timestamp: new Date().toISOString()
    },
    session: {
      id: runId,
      status: "running",
      input: {
        topic: "topic",
        task: "topic",
        filePaths: ["src/demo.ts"],
        testCommand: "pnpm test",
        maxIterations: 3,
        maxMinutes: 30
      },
      attempt: 1,
      iteration: 1,
      phaseStatuses: {
        planning: "completed",
        architecture: "completed",
        design: "completed",
        implementation: "running",
        goal_validation: "pending",
        validation: "pending",
        review: "pending",
        packaging: "pending"
      },
      artifactRefs: {},
      startedAt: new Date().toISOString()
    },
    events: [],
    tasks: [],
    handoffs: [],
    discovery: null,
    approvalsPending: [],
    artifacts: [],
    prPackage: null,
    chat: null
  }) as RunLogSnapshot;

describe("RunLogArchive", () => {
  afterEach(async () => {
    await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tmpDirs.length = 0;
  });

  it("writes snapshot and reads latest/byRunId", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "step7-runlog-"));
    tmpDirs.push(root);

    const archive = new RunLogArchive(root);
    const first = createSnapshot("run-1", "task_blocked");
    const second = createSnapshot("run-2", "session_finished");

    await archive.write(first);
    await archive.write(second);

    const index = await archive.list(10);
    expect(index.length).toBe(2);
    expect(index[0].runId).toBe("run-2");

    const latest = await archive.readLatest();
    expect(latest?.runId).toBe("run-2");
    expect(latest?.trigger.type).toBe("session_finished");

    const byRun = await archive.readByRunId("run-1");
    expect(byRun?.runId).toBe("run-1");
    expect(byRun?.trigger.type).toBe("task_blocked");
  });
});

