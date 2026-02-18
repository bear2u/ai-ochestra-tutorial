import { spawn } from "node:child_process";
import { config } from "../config";

export interface CommandResult {
  exitCode: number;
  output: string;
}

export class CommandRunner {
  async run(command: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: config.workspaceRoot,
        shell: true,
        env: process.env
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
