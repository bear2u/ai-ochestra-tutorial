import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { FileChange } from "../types";

const isInside = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export class WorkspaceService {
  constructor(private readonly root = config.workspaceRoot) {}

  resolveSafePath(relativePath: string): string {
    const cleaned = relativePath.replace(/^\/+/, "");
    const absolute = path.resolve(this.root, cleaned);
    if (!isInside(absolute, this.root)) {
      throw new Error(`Unsafe path rejected: ${relativePath}`);
    }
    return absolute;
  }

  async readFiles(filePaths: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(
      filePaths.map(async (filePath) => {
        const absolute = this.resolveSafePath(filePath);
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

  async applyChanges(changes: FileChange[]): Promise<void> {
    for (const change of changes) {
      const absolute = this.resolveSafePath(change.path);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, change.content, "utf8");
    }
  }
}
