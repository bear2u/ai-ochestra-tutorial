import { FileLockManager } from "./fileLockManager";
import { TaskCard } from "../types";
import { WorkerExecutionResult } from "../agents/workerAgent";

export interface WorkerRunCallbacks {
  onTaskStarted?: (task: TaskCard) => void;
  onTaskFinished?: (task: TaskCard, result: WorkerExecutionResult) => void;
}

export interface WorkerSchedulerResult {
  tasks: TaskCard[];
  blocked: boolean;
  failed: boolean;
}

const cloneTask = (task: TaskCard): TaskCard => ({
  ...task,
  dependencies: [...task.dependencies],
  targetFiles: [...task.targetFiles],
  acceptanceCriteria: [...task.acceptanceCriteria],
  commands: [...task.commands]
});

const isDependencyDone = (task: TaskCard, tasks: Map<string, TaskCard>): boolean =>
  task.dependencies.every((dependencyId) => tasks.get(dependencyId)?.status === "done");

export class WorkerScheduler {
  constructor(
    private readonly lockManager = new FileLockManager(),
    private readonly maxParallelWorkers = 3
  ) {}

  async run(
    tasksInput: TaskCard[],
    execute: (task: TaskCard) => Promise<WorkerExecutionResult>,
    callbacks: WorkerRunCallbacks = {}
  ): Promise<WorkerSchedulerResult> {
    const tasks = new Map<string, TaskCard>(tasksInput.map((task) => [task.id, cloneTask(task)]));
    const running = new Map<string, Promise<{ taskId: string; result: WorkerExecutionResult }>>();

    const maxParallel = Math.max(1, Math.min(this.maxParallelWorkers, 5));

    const startReadyTasks = (): void => {
      if (running.size >= maxParallel) return;

      const ready = [...tasks.values()].filter((task) => task.status === "queued" && isDependencyDone(task, tasks));
      for (const task of ready) {
        if (running.size >= maxParallel) break;
        const locked = this.lockManager.tryAcquire(task.id, task.targetFiles);
        if (!locked) {
          continue;
        }

        task.status = "running";
        task.updatedAt = new Date().toISOString();
        callbacks.onTaskStarted?.(cloneTask(task));

        const wrapped = execute(cloneTask(task))
          .then((result) => ({ taskId: task.id, result }))
          .finally(() => {
            this.lockManager.release(task.id);
          });

        running.set(task.id, wrapped);
      }
    };

    startReadyTasks();

    while (running.size > 0) {
      const finished = await Promise.race(running.values());
      running.delete(finished.taskId);

      const task = tasks.get(finished.taskId);
      if (!task) {
        startReadyTasks();
        continue;
      }

      task.summary = finished.result.summary;
      task.commands = [...finished.result.executedCommands];
      task.updatedAt = new Date().toISOString();

      if (finished.result.status === "done") {
        task.status = "done";
      } else if (finished.result.status === "blocked") {
        task.status = "blocked";
      } else {
        task.status = "failed";
      }

      callbacks.onTaskFinished?.(cloneTask(task), finished.result);
      startReadyTasks();
    }

    const ordered = tasksInput.map((task) => cloneTask(tasks.get(task.id) ?? task));

    for (const task of ordered) {
      if (task.status === "queued") {
        const hasBadDependency = task.dependencies.some((dependencyId) => {
          const dependency = ordered.find((candidate) => candidate.id === dependencyId);
          return dependency?.status === "failed" || dependency?.status === "blocked";
        });
        if (hasBadDependency) {
          task.status = "blocked";
          task.summary = "Blocked by dependency state.";
          task.updatedAt = new Date().toISOString();
        }
      }
    }

    const blocked = ordered.some((task) => task.status === "blocked");
    const failed = ordered.some((task) => task.status === "failed");

    return {
      tasks: ordered,
      blocked,
      failed
    };
  }
}
