import { describe, expect, it } from "vitest";
import { BudgetTracker } from "../../src/services/budgetTracker";

describe("BudgetTracker", () => {
  it("allows iterations within budget", () => {
    const startedAt = "2026-02-18T00:00:00.000Z";
    const tracker = new BudgetTracker(3, 45, startedAt);

    const gate1 = tracker.canStartIteration(1, new Date("2026-02-18T00:01:00.000Z").getTime());
    const gate3 = tracker.canStartIteration(3, new Date("2026-02-18T00:30:00.000Z").getTime());

    expect(gate1.ok).toBe(true);
    expect(gate3.ok).toBe(true);
    expect(gate1.snapshot.remainingIterations).toBe(3);
    expect(gate3.snapshot.remainingIterations).toBe(1);
  });

  it("fails when iteration budget is exceeded", () => {
    const tracker = new BudgetTracker(2, 45, "2026-02-18T00:00:00.000Z");
    const gate = tracker.canStartIteration(3, new Date("2026-02-18T00:05:00.000Z").getTime());

    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("iterations");
    expect(gate.snapshot.exhaustedReason).toBe("iterations");
  });

  it("fails when minute budget is exceeded", () => {
    const tracker = new BudgetTracker(6, 1, "2026-02-18T00:00:00.000Z");
    const gate = tracker.canStartIteration(1, new Date("2026-02-18T00:01:01.000Z").getTime());

    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("minutes");
    expect(gate.snapshot.exhaustedReason).toBe("minutes");
  });
});
