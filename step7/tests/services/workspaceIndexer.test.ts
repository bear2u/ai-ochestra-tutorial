import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceIndexer } from "../../src/services/workspaceIndexer";

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "step7-indexer-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    })
  );
});

describe("WorkspaceIndexer", () => {
  it("indexes regular files and ignores excluded directories/binaries", async () => {
    const root = await makeTempRoot();
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "x"), { recursive: true });
    await fs.mkdir(path.join(root, ".git"), { recursive: true });

    await fs.writeFile(path.join(root, "src", "app.ts"), "export const ok = true;", "utf8");
    await fs.writeFile(path.join(root, "README.md"), "# demo", "utf8");
    await fs.writeFile(path.join(root, "node_modules", "x", "index.js"), "ignored", "utf8");
    await fs.writeFile(path.join(root, "logo.png"), "binary-ish", "utf8");

    const indexer = new WorkspaceIndexer();
    const files = await indexer.scan(root);
    const paths = files.map((file) => file.path).sort();

    expect(paths).toContain("README.md");
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("node_modules/x/index.js");
    expect(paths).not.toContain("logo.png");
  });
});
