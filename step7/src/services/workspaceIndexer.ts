import fs from "node:fs/promises";
import path from "node:path";

export interface IndexedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

const ignoredDirs = new Set([".git", "node_modules", "dist", ".next", ".orchestra", "coverage", "tmp"]);
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot"
]);

const shouldIgnorePath = (relativePath: string): boolean => {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => ignoredDirs.has(segment))) {
    return true;
  }
  const extension = path.extname(relativePath).toLowerCase();
  return binaryExtensions.has(extension);
};

export class WorkspaceIndexer {
  async scan(root: string): Promise<IndexedFile[]> {
    const entries: IndexedFile[] = [];

    const visit = async (currentAbsolute: string): Promise<void> => {
      const listing = await fs.readdir(currentAbsolute, { withFileTypes: true });
      for (const entry of listing) {
        const absolutePath = path.join(currentAbsolute, entry.name);
        const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

        if (!relativePath || shouldIgnorePath(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await visit(absolutePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const stat = await fs.stat(absolutePath);
        if (stat.size > 1_500_000) {
          continue;
        }

        entries.push({
          path: relativePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        });
      }
    };

    await visit(root);
    return entries;
  }
}
