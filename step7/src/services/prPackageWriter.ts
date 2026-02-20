import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";

const isInside = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

export class PrPackageWriter {
  constructor(private readonly root = config.workspaceRoot) {}

  private resolveSafePath(relativePath: string): string {
    const cleaned = relativePath.replace(/^\/+/, "");
    const absolute = path.resolve(this.root, cleaned);
    if (!isInside(absolute, this.root)) {
      throw new Error(`Unsafe output path rejected: ${relativePath}`);
    }
    return absolute;
  }

  async write(sessionId: string, payload: unknown): Promise<{ outputPath: string }> {
    const outputPath = `.orchestra/sessions/${sessionId}/pr-package.json`;
    const absolute = this.resolveSafePath(outputPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { outputPath };
  }
}
