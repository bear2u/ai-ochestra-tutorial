import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GoalValidatorAgent } from "../../src/agents/goalValidatorAgent";

const createTempRoot = async (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), "goal-validator-"));

describe("GoalValidatorAgent", () => {
  it("passes when requested example + next + shadcn signals are present", async () => {
    const root = await createTempRoot();
    const exampleRoot = path.join(root, "example");
    await fs.mkdir(exampleRoot, { recursive: true });
    await fs.writeFile(
      path.join(exampleRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            next: "16.0.0",
            "@radix-ui/react-slot": "^1.1.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(exampleRoot, "components.json"), JSON.stringify({ style: "default" }, null, 2), "utf8");

    const agent = new GoalValidatorAgent(root);
    const result = await agent.validate({
      sessionId: "s1",
      iteration: 1,
      topic: "example 폴더를 만들고 NextJs16+ShadCN 기본 설치",
      workspaceRoot: ".",
      changedFiles: ["example/package.json"],
      filePaths: ["example/package.json"]
    });

    expect(result.passed).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails with suggestions when goals are missing", async () => {
    const root = await createTempRoot();
    const agent = new GoalValidatorAgent(root);
    const result = await agent.validate({
      sessionId: "s2",
      iteration: 1,
      topic: "example 폴더를 만들고 NextJs16+ShadCN 기본 설치",
      workspaceRoot: ".",
      changedFiles: [],
      filePaths: []
    });

    expect(result.passed).toBe(false);
    expect(result.missingTargets).toContain("example");
    expect(result.suggestions.length).toBeGreaterThan(0);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("passes when requested example + react setup is present", async () => {
    const root = await createTempRoot();
    const exampleRoot = path.join(root, "example");
    await fs.mkdir(exampleRoot, { recursive: true });
    await fs.writeFile(
      path.join(exampleRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            react: "^18.3.0",
            "react-dom": "^18.3.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const agent = new GoalValidatorAgent(root);
    const result = await agent.validate({
      sessionId: "s3",
      iteration: 1,
      topic: "example 폴더를 만들고 React 를 세팅해줘",
      workspaceRoot: ".",
      changedFiles: ["example/package.json"],
      filePaths: ["example/package.json"]
    });

    expect(result.passed).toBe(true);
    expect(result.checks.find((check) => check.id === "react-dependency")?.passed).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });
});
