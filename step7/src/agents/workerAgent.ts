import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { CommandPolicy } from "../services/commandPolicy";
import { AppliedChangeResult, ApprovalMode, ApprovalRiskLevel, TaskCard } from "../types";

export interface WorkerDevAgentLike {
  propose(params: {
    sessionId: string;
    iteration?: number;
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<{
    rationale: string;
    changes: Array<{
      path: string;
      patch?: string;
      fallbackContent?: string;
      content?: string;
    }>;
    commands?: string[];
  }>;
}

export interface WorkerWorkspaceLike {
  readFiles(filePaths: string[], workspaceRoot?: string): Promise<Record<string, string>>;
  ensureDirectory?(relativePath: string, workspaceRoot?: string): Promise<void>;
  applyChanges(
    changes: Array<{
      path: string;
      patch?: string;
      fallbackContent?: string;
      content?: string;
    }>,
    workspaceRoot?: string
  ): Promise<AppliedChangeResult[]>;
}

export interface WorkerCommandRunnerLike {
  run(command: string, options?: { workspaceRoot?: string }): Promise<{ exitCode: number; output: string }>;
}

export interface WorkerExecutionInput {
  runId: string;
  topic: string;
  workspaceRoot: string;
  task: TaskCard;
  approvedCommands: ReadonlySet<string>;
  approvalMode: ApprovalMode;
  onCommandStarted?: (input: { taskId: string; command: string; index: number; total: number }) => void;
  onCommandCompleted?: (input: {
    taskId: string;
    command: string;
    index: number;
    total: number;
    durationMs: number;
    output: string;
  }) => void;
  onCommandFailed?: (input: {
    taskId: string;
    command: string;
    index: number;
    total: number;
    durationMs: number;
    errorMessage: string;
  }) => void;
}

export interface WorkerApprovalNeed {
  command: string;
  reason: string;
  riskLevel: ApprovalRiskLevel;
}

export interface WorkerExecutionResult {
  status: "done" | "blocked" | "failed";
  summary: string;
  changedPaths: string[];
  executedCommands: string[];
  approvalNeed?: WorkerApprovalNeed;
  autoApprovedCommands?: WorkerApprovalNeed[];
}

interface NormalizedWorkerCommand {
  original: string;
  policyCommand: string;
  runCommand: string;
  workspaceRoot: string;
  scopedDirectory?: string;
}

const isWithinOrEqual = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const dedupeStrings = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];
const shouldAutoApprove = (mode: ApprovalMode, riskLevel: ApprovalRiskLevel): boolean =>
  mode === "auto_all" || (mode === "auto_safe" && riskLevel !== "high");
const isLongRunningInstallCommand = (command: string): boolean =>
  /^(pnpm|npm)\s+(create|init|install|i|add|dlx)\b/i.test(command.trim());
const isCreateNextAppCommand = (command: string): boolean =>
  /^(pnpm|npm)\s+(create|dlx)\s+next-app@latest\b/i.test(command.trim());
const isCreateViteCommand = (command: string): boolean =>
  /^(pnpm|npm)\s+create\s+vite(@latest)?\b/i.test(command.trim());
const isShadcnInitCommand = (command: string): boolean =>
  /^(pnpm|npm)\s+dlx\s+shadcn@latest\s+init\b/i.test(command.trim());
const isTimeoutErrorMessage = (message: string): boolean => /timed out after \d+ms/i.test(message);
const isWindowsAbsolutePath = (value: string): boolean => /^[a-zA-Z]:[\\/]/.test(value);
const hasParentTraversal = (value: string): boolean =>
  value
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .some((segment) => segment === "..");
const normalizePathPrefix = (value: string): string => value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
const isScopedCommandRelevantToTask = (scopedDirectory: string, targetFiles: string[]): boolean => {
  const normalizedDir = normalizePathPrefix(scopedDirectory);
  if (!normalizedDir) return false;
  return targetFiles.some((filePath) => {
    const normalizedPath = normalizePathPrefix(filePath);
    return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}/`);
  });
};
const summarizeOutput = (output: string, maxChars = 400): string => {
  const trimmed = output.trim();
  if (!trimmed) return "";
  const compact = trimmed.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean).slice(-8).join(" | ");
  return compact.length > maxChars ? compact.slice(compact.length - maxChars) : compact;
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class WorkerAgent {
  constructor(
    private readonly devAgent: WorkerDevAgentLike,
    private readonly workspace: WorkerWorkspaceLike,
    private readonly commandRunner: WorkerCommandRunnerLike,
    private readonly policy = new CommandPolicy()
  ) {}

  private normalizeCommand(command: string, workspaceRoot: string): NormalizedWorkerCommand {
    const original = command.trim();
    const scopedMatch = original.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|><`$]+))\s*&&\s*(.+)$/i);
    if (!scopedMatch) {
      return {
        original,
        policyCommand: original,
        runCommand: original,
        workspaceRoot
      };
    }

    const targetDirectory = (scopedMatch[1] ?? scopedMatch[2] ?? scopedMatch[3] ?? "").trim();
    const scopedCommand = (scopedMatch[4] ?? "").trim();
    if (!targetDirectory || !scopedCommand) {
      throw new Error("Invalid scoped command format.");
    }

    if (
      targetDirectory.includes("~") ||
      path.isAbsolute(targetDirectory) ||
      isWindowsAbsolutePath(targetDirectory) ||
      hasParentTraversal(targetDirectory) ||
      !/^[a-zA-Z0-9._/-]+$/.test(targetDirectory)
    ) {
      throw new Error(`Unsafe scoped command path: ${targetDirectory}`);
    }

    return {
      original,
      policyCommand: scopedCommand,
      runCommand: original,
      workspaceRoot,
      scopedDirectory: targetDirectory
    };
  }

  private resolveWorkspaceBase(workspaceRoot: string): string {
    const base = path.resolve(config.workspaceRoot, workspaceRoot);
    if (!isWithinOrEqual(base, config.workspaceRoot)) {
      throw new Error(`Unsafe workspaceRoot rejected: ${workspaceRoot}`);
    }
    return base;
  }

  private async ensureScopedDirectoryExists(scopedDirectory: string, workspaceRoot: string): Promise<void> {
    if (typeof this.workspace.ensureDirectory === "function") {
      await this.workspace.ensureDirectory(scopedDirectory, workspaceRoot);
      return;
    }

    const base = this.resolveWorkspaceBase(workspaceRoot);
    const absolute = path.resolve(base, scopedDirectory);
    if (!isWithinOrEqual(absolute, base)) {
      throw new Error(`Unsafe scoped command path: ${scopedDirectory}`);
    }
    await fs.mkdir(absolute, { recursive: true });
  }

  private hasNextDependency(packageJsonRaw: string): boolean {
    try {
      const parsed = JSON.parse(packageJsonRaw) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const deps = {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {})
      };
      return typeof deps.next === "string";
    } catch {
      return false;
    }
  }

  private async isIdempotentBootstrapAlreadySatisfied(command: string, workspaceRoot: string): Promise<boolean> {
    if (isCreateNextAppCommand(command)) {
      const files = await this.workspace.readFiles(["example/package.json"], workspaceRoot);
      const packageJson = files["example/package.json"] ?? "";
      return this.hasNextDependency(packageJson);
    }

    if (isShadcnInitCommand(command)) {
      const files = await this.workspace.readFiles(["example/components.json"], workspaceRoot);
      const components = (files["example/components.json"] ?? "").trim();
      return components.length > 0;
    }

    if (isCreateViteCommand(command)) {
      const files = await this.workspace.readFiles(["example/package.json"], workspaceRoot);
      const packageJson = files["example/package.json"] ?? "";
      try {
        const parsed = JSON.parse(packageJson) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
        };
        const deps = {
          ...(parsed.dependencies ?? {}),
          ...(parsed.devDependencies ?? {})
        };
        return typeof deps.react === "string";
      } catch {
        return false;
      }
    }

    return false;
  }

  async execute(input: WorkerExecutionInput): Promise<WorkerExecutionResult> {
    if (input.task.phase !== "implementation") {
      return {
        status: "done",
        summary: `No-op task for phase ${input.task.phase}.`,
        changedPaths: [],
        executedCommands: []
      };
    }

    const files = await this.workspace.readFiles(input.task.targetFiles, input.workspaceRoot);
    const devOutput = await this.devAgent.propose({
      sessionId: input.runId,
      task: `${input.topic}\nSub-task: ${input.task.title}`,
      feedback: "",
      files
    });

    const commands = dedupeStrings([...(input.task.commands ?? []), ...(devOutput.commands ?? [])]);
    const executedCommands: string[] = [];
    const autoApprovedCommands: WorkerApprovalNeed[] = [];
    const skippedCommands: string[] = [];

    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      let normalized: NormalizedWorkerCommand;
      try {
        normalized = this.normalizeCommand(command, input.workspaceRoot);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: "failed",
          summary: `Command rejected by policy: ${command} (${message})`,
          changedPaths: [],
          executedCommands
        };
      }

      const alreadyApproved =
        input.approvedCommands.has(normalized.original) || input.approvedCommands.has(normalized.policyCommand);
      const policy = alreadyApproved
        ? {
            action: "allow" as const,
            reason: "Previously approved command.",
            riskLevel: "low" as const
          }
        : this.policy.evaluate(normalized.policyCommand, input.approvedCommands);
      if (policy.action === "reject") {
        return {
          status: "failed",
          summary: `Command rejected by policy: ${command} (${policy.reason})`,
          changedPaths: [],
          executedCommands
        };
      }

      if (policy.action === "approval") {
        if (!shouldAutoApprove(input.approvalMode, policy.riskLevel)) {
          return {
            status: "blocked",
            summary: `Approval required for command: ${command}`,
            changedPaths: [],
            executedCommands,
            approvalNeed: {
              command: normalized.original,
              reason: policy.reason,
              riskLevel: policy.riskLevel
            }
          };
        }

        autoApprovedCommands.push({
          command: normalized.original,
          reason: policy.reason,
          riskLevel: policy.riskLevel
        });
      }

      if (
        normalized.scopedDirectory &&
        !isScopedCommandRelevantToTask(normalized.scopedDirectory, input.task.targetFiles)
      ) {
        skippedCommands.push(normalized.original);
        continue;
      }

      if (normalized.scopedDirectory) {
        try {
          await this.ensureScopedDirectoryExists(normalized.scopedDirectory, input.workspaceRoot);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            status: "failed",
            summary: `Command failed: ${command} (${message})`,
            changedPaths: [],
            executedCommands
          };
        }
      }

      input.onCommandStarted?.({
        taskId: input.task.id,
        command,
        index: index + 1,
        total: commands.length
      });

      const startedAt = Date.now();
      try {
        const timeoutMs = isLongRunningInstallCommand(normalized.policyCommand)
          ? Math.max(config.maxCommandRuntimeMs, config.maxInstallCommandRuntimeMs)
          : config.maxCommandRuntimeMs;
        const result = await withTimeout(
          this.commandRunner.run(normalized.runCommand, { workspaceRoot: normalized.workspaceRoot }),
          timeoutMs,
          `worker command "${command}"`
        );
        const durationMs = Date.now() - startedAt;

        if (result.exitCode !== 0) {
          const alreadySatisfied = await this.isIdempotentBootstrapAlreadySatisfied(
            normalized.policyCommand,
            normalized.workspaceRoot
          );
          if (alreadySatisfied) {
            executedCommands.push(normalized.original);
            input.onCommandCompleted?.({
              taskId: input.task.id,
              command,
              index: index + 1,
              total: commands.length,
              durationMs,
              output: result.output
            });
            continue;
          }

          const outputSummary = summarizeOutput(result.output);
          input.onCommandFailed?.({
            taskId: input.task.id,
            command,
            index: index + 1,
            total: commands.length,
            durationMs,
            errorMessage: outputSummary ? `Command failed (${result.exitCode}): ${outputSummary}` : `Command failed (${result.exitCode})`
          });
          return {
            status: "failed",
            summary: outputSummary
              ? `Command failed (${result.exitCode}): ${command} | ${outputSummary}`
              : `Command failed (${result.exitCode}): ${command}`,
            changedPaths: [],
            executedCommands
          };
        }

        executedCommands.push(normalized.original);
        input.onCommandCompleted?.({
          taskId: input.task.id,
          command,
          index: index + 1,
          total: commands.length,
          durationMs,
          output: result.output
        });
      } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        const alreadySatisfiedAfterTimeout =
          isTimeoutErrorMessage(message) &&
          (await this.isIdempotentBootstrapAlreadySatisfied(normalized.policyCommand, normalized.workspaceRoot));
        if (alreadySatisfiedAfterTimeout) {
          executedCommands.push(normalized.original);
          input.onCommandCompleted?.({
            taskId: input.task.id,
            command,
            index: index + 1,
            total: commands.length,
            durationMs,
            output: message
          });
          continue;
        }

        input.onCommandFailed?.({
          taskId: input.task.id,
          command,
          index: index + 1,
          total: commands.length,
          durationMs,
          errorMessage: message
        });
        return {
          status: "failed",
          summary: `Command failed: ${command} (${message})`,
          changedPaths: [],
          executedCommands
        };
      }
    }

    const applyResults = await this.workspace.applyChanges(devOutput.changes, input.workspaceRoot);
    const changedPaths = dedupeStrings(applyResults.map((item) => item.path));
    const summary =
      skippedCommands.length > 0
        ? `${devOutput.rationale} Skipped ${skippedCommands.length} out-of-scope command(s).`
        : devOutput.rationale;

    return {
      status: "done",
      summary,
      changedPaths,
      executedCommands,
      autoApprovedCommands
    };
  }
}
