import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "../config";

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface CommandRunOptions {
  workspaceRoot?: string;
}

const isWithinOrEqual = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

export class CommandRunner {
  constructor(private readonly root = config.workspaceRoot) {}

  resolveWorkspaceRoot(workspaceRoot?: string): string {
    const input = workspaceRoot?.trim();
    if (!input) {
      return this.root;
    }
    const absolute = path.resolve(this.root, input);
    if (!isWithinOrEqual(absolute, this.root)) {
      throw new Error(`Unsafe workspaceRoot rejected: ${workspaceRoot}`);
    }
    return absolute;
  }

  async run(command: string, options?: CommandRunOptions): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const cwd = this.resolveWorkspaceRoot(options?.workspaceRoot);
      const child = spawn(command, {
        cwd,
        shell: true,
        env: {
          ...process.env,
          CI: process.env.CI ?? "1"
        }
      });

      let combined = "";
      child.stdout.on("data", (chunk: Buffer) => {
        combined += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        combined += chunk.toString("utf8");
      });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        const output = combined.slice(-config.maxCommandOutputChars);
        resolve({ exitCode: code ?? 1, output });
      });
    });
  }
}
