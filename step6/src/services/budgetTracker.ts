import { BudgetExhaustedReason, BudgetState } from "../types";

export interface BudgetSnapshotInput {
  iteration: number;
  exhaustedReason?: BudgetExhaustedReason;
  nowMs?: number;
}

export interface BudgetGateResult {
  ok: boolean;
  reason?: BudgetExhaustedReason;
  snapshot: BudgetState;
}

export class BudgetTracker {
  private readonly startedAtMs: number;
  private readonly deadlineMs: number;

  constructor(
    private readonly maxIterations: number,
    private readonly maxMinutes: number,
    startedAtIso: string
  ) {
    this.startedAtMs = new Date(startedAtIso).getTime();
    this.deadlineMs = this.startedAtMs + maxMinutes * 60_000;
  }

  snapshot(input: BudgetSnapshotInput): BudgetState {
    const nowMs = input.nowMs ?? Date.now();
    return {
      maxIterations: this.maxIterations,
      maxMinutes: this.maxMinutes,
      startedAt: new Date(this.startedAtMs).toISOString(),
      deadlineAt: new Date(this.deadlineMs).toISOString(),
      elapsedMs: Math.max(0, nowMs - this.startedAtMs),
      remainingIterations: Math.max(0, this.maxIterations - input.iteration + 1),
      exhaustedReason: input.exhaustedReason
    };
  }

  canStartIteration(iteration: number, nowMs = Date.now()): BudgetGateResult {
    if (iteration > this.maxIterations) {
      return {
        ok: false,
        reason: "iterations",
        snapshot: this.snapshot({ iteration, exhaustedReason: "iterations", nowMs })
      };
    }

    if (nowMs > this.deadlineMs) {
      return {
        ok: false,
        reason: "minutes",
        snapshot: this.snapshot({ iteration, exhaustedReason: "minutes", nowMs })
      };
    }

    return {
      ok: true,
      snapshot: this.snapshot({ iteration, nowMs })
    };
  }
}
