import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { AppliedChangeResult, FileChange } from "../types";
import { applyUnifiedPatch } from "./patchApply";

const isWithinOrEqual = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

export class WorkspaceService {
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

  resolveSafePath(relativePath: string, workspaceRoot?: string): string {
    const baseRoot = this.resolveWorkspaceRoot(workspaceRoot);
    const cleaned = relativePath.replace(/^\/+/, "");
    const absolute = path.resolve(baseRoot, cleaned);
    if (!isWithinOrEqual(absolute, baseRoot)) {
      throw new Error(`Unsafe path rejected: ${relativePath}`);
    }
    return absolute;
  }

  async readFiles(filePaths: string[], workspaceRoot?: string): Promise<Record<string, string>> {
    const entries = await Promise.all(
      filePaths.map(async (filePath) => {
        const absolute = this.resolveSafePath(filePath, workspaceRoot);
        try {
          const content = await fs.readFile(absolute, "utf8");
          return [filePath, content] as const;
        } catch {
          return [filePath, ""] as const;
        }
      })
    );

    return Object.fromEntries(entries);
  }

  async applyChanges(changes: FileChange[], workspaceRoot?: string): Promise<AppliedChangeResult[]> {
    const results: AppliedChangeResult[] = [];

    for (const change of changes) {
      const absolute = this.resolveSafePath(change.path, workspaceRoot);
      await fs.mkdir(path.dirname(absolute), { recursive: true });

      let currentContent = "";
      try {
        currentContent = await fs.readFile(absolute, "utf8");
      } catch {
        currentContent = "";
      }

      if (typeof change.patch === "string" && change.patch.trim()) {
        try {
          const next = applyUnifiedPatch(currentContent, change.patch);
          await fs.writeFile(absolute, next, "utf8");
          results.push({ path: change.path, mode: "patch" });
          continue;
        } catch {
          // fall through to fallback content
        }
      }

      if (typeof change.fallbackContent === "string") {
        await fs.writeFile(absolute, change.fallbackContent, "utf8");
        results.push({ path: change.path, mode: "fallbackContent" });
        continue;
      }

      if (typeof change.content === "string") {
        await fs.writeFile(absolute, change.content, "utf8");
        results.push({ path: change.path, mode: "content" });
        continue;
      }

      throw new Error(`Unable to apply change for ${change.path}. Missing patch and fallback content.`);
    }

    return results;
  }
}
