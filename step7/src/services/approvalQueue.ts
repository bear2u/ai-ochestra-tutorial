import { randomUUID } from "node:crypto";
import { ApprovalRequest, ApprovalRiskLevel } from "../types";

export interface CreateApprovalInput {
  runId: string;
  taskId?: string;
  command: string;
  reason: string;
  riskLevel: ApprovalRiskLevel;
}

export class ApprovalQueue {
  private readonly approvals = new Map<string, ApprovalRequest>();

  create(input: CreateApprovalInput): ApprovalRequest {
    const approval: ApprovalRequest = {
      id: randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      command: input.command,
      reason: input.reason,
      riskLevel: input.riskLevel,
      status: "pending",
      requestedAt: new Date().toISOString()
    };

    this.approvals.set(approval.id, approval);
    return { ...approval };
  }

  get(id: string): ApprovalRequest | undefined {
    const approval = this.approvals.get(id);
    return approval ? { ...approval } : undefined;
  }

  listPending(runId?: string): ApprovalRequest[] {
    return [...this.approvals.values()]
      .filter((item) => item.status === "pending" && (!runId || item.runId === runId))
      .sort((a, b) => (a.requestedAt > b.requestedAt ? -1 : 1))
      .map((item) => ({ ...item }));
  }

  decide(id: string, decision: "approve" | "reject", note?: string, decidedBy = "user"): ApprovalRequest | undefined {
    const current = this.approvals.get(id);
    if (!current) return undefined;

    if (current.status !== "pending") {
      return { ...current };
    }

    const decided: ApprovalRequest = {
      ...current,
      status: decision === "approve" ? "approved" : "rejected",
      decidedAt: new Date().toISOString(),
      decidedBy,
      note
    };

    this.approvals.set(id, decided);
    return { ...decided };
  }

  rejectPendingByRun(runId: string, note = "Cancelled due to a newer request.", decidedBy = "system"): ApprovalRequest[] {
    const rejected: ApprovalRequest[] = [];

    for (const [id, current] of this.approvals.entries()) {
      if (current.runId !== runId || current.status !== "pending") {
        continue;
      }

      const decided: ApprovalRequest = {
        ...current,
        status: "rejected",
        decidedAt: new Date().toISOString(),
        decidedBy,
        note
      };
      this.approvals.set(id, decided);
      rejected.push({ ...decided });
    }

    return rejected;
  }
}
