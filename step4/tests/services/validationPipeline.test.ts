import { describe, expect, it } from "vitest";
import { ValidationPipeline } from "../../src/services/validationPipeline";

describe("ValidationPipeline", () => {
  it("passes when all commands succeed", async () => {
    const pipeline = new ValidationPipeline(
      {
        run: async () => ({ exitCode: 0, output: "ok" })
      },
      {
        evaluate: async ({ exitCode, commandOutput }) => ({
          summary: exitCode === 0 ? "passed" : "failed",
          exitCode,
          commandOutput
        })
      }
    );

    const result = await pipeline.run({
      sessionId: "s1",
      iteration: 1,
      task: "task",
      commands: [
        { stage: "lint", command: "pnpm lint" },
        { stage: "type", command: "pnpm typecheck" },
        { stage: "test", command: "pnpm test" }
      ]
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((step) => step.passed)).toBe(true);
  });

  it("stops immediately and classifies lint failure", async () => {
    let callCount = 0;
    const pipeline = new ValidationPipeline(
      {
        run: async () => {
          callCount += 1;
          return callCount === 1 ? { exitCode: 1, output: "lint fail" } : { exitCode: 0, output: "ok" };
        }
      },
      {
        evaluate: async ({ exitCode, commandOutput }) => ({
          summary: exitCode === 0 ? "passed" : "failed",
          exitCode,
          commandOutput
        })
      }
    );

    const result = await pipeline.run({
      sessionId: "s1",
      iteration: 1,
      task: "task",
      commands: [
        { stage: "lint", command: "pnpm lint" },
        { stage: "test", command: "pnpm test" }
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.classification).toBe("lint");
    expect(callCount).toBe(1);
    expect(result.steps).toHaveLength(1);
  });

  it("uses test agent classification for custom failures", async () => {
    const pipeline = new ValidationPipeline(
      {
        run: async () => ({ exitCode: 1, output: "mystery fail" })
      },
      {
        evaluate: async ({ exitCode, commandOutput }) => ({
          summary: "custom stage failed",
          exitCode,
          commandOutput
        }),
        classifyFailure: async () => "unknown"
      }
    );

    const result = await pipeline.run({
      sessionId: "s1",
      iteration: 1,
      task: "task",
      commands: [{ stage: "custom", command: "node custom.js" }]
    });

    expect(result.passed).toBe(false);
    expect(result.classification).toBe("unknown");
  });

  it("classifies runtime failures when command runner throws", async () => {
    const pipeline = new ValidationPipeline(
      {
        run: async () => {
          throw new Error("spawn EACCES");
        }
      },
      {
        evaluate: async ({ exitCode, commandOutput }) => ({
          summary: "runtime fail",
          exitCode,
          commandOutput
        })
      }
    );

    const result = await pipeline.run({
      sessionId: "s1",
      iteration: 1,
      task: "task",
      commands: [{ stage: "test", command: "pnpm test" }]
    });

    expect(result.passed).toBe(false);
    expect(result.classification).toBe("runtime");
    expect(result.steps[0].classification).toBe("runtime");
  });
});
