import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PrPackageWriter } from "../../src/services/prPackageWriter";

describe("PrPackageWriter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("writes pr-package.json under .orchestra/sessions/<id>", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "step6-pr-writer-"));
    tempDirs.push(root);

    const writer = new PrPackageWriter(root);
    const result = await writer.write("session-123", { hello: "world" });

    expect(result.outputPath).toBe(".orchestra/sessions/session-123/pr-package.json");

    const absolute = path.join(root, result.outputPath);
    const content = await fs.readFile(absolute, "utf8");
    expect(JSON.parse(content)).toEqual({ hello: "world" });
  });
});
