import { describe, expect, it } from "vitest";
import { CommandPolicy } from "../../src/services/commandPolicy";

describe("CommandPolicy", () => {
  const policy = new CommandPolicy();

  it("allows install and validation commands", () => {
    expect(policy.evaluate("pnpm add shadcn-ui").action).toBe("allow");
    expect(policy.evaluate("npm run test").action).toBe("allow");
    expect(policy.evaluate("cd example && pnpm install").action).toBe("allow");
  });

  it("requires approval for non-allowlisted commands", () => {
    const decision = policy.evaluate("npm publish");
    expect(decision.action).toBe("approval");
    expect(decision.riskLevel).toBe("high");
  });

  it("rejects dangerous shell patterns", () => {
    const decision = policy.evaluate("pnpm test && rm -rf .");
    expect(decision.action).toBe("reject");
    expect(decision.riskLevel).toBe("high");
  });

  it("rejects unsafe scoped command path traversal", () => {
    const decision = policy.evaluate("cd ../private && pnpm install");
    expect(decision.action).toBe("reject");
    expect(decision.reason).toContain("Unsafe scoped command path");
  });

  it("allows commands already approved in this run", () => {
    const approved = new Set(["git status"]);
    const decision = policy.evaluate("git status", approved);
    expect(decision.action).toBe("allow");
  });
});
