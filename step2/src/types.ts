export type AgentRole = "supervisor" | "dev" | "test";

export type SessionStatus = "pending" | "running" | "success" | "failed";

export type PhaseName =
  | "planning"
  | "architecture"
  | "design"
  | "implementation"
  | "validation"
  | "review"
  | "packaging";

export type PhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface FileChange {
  path: string;
  content: string;
}

export interface DevOutput {
  rationale: string;
  changes: FileChange[];
}

export interface TestResult {
  passed: boolean;
  summary: string;
  commandOutput: string;
  exitCode: number;
}

export interface SessionInput {
  task: string;
  filePaths: string[];
  testCommand: string;
  maxAttempts: number;
}

export interface SessionState {
  id: string;
  status: SessionStatus;
  input: SessionInput;
  attempt: number;
  iteration: number;
  currentPhase?: PhaseName;
  phaseStatuses?: Record<PhaseName, PhaseStatus>;
  startedAt: string;
  endedAt?: string;
  finalSummary?: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  role: AgentRole;
  type: string;
  message: string;
  phase?: PhaseName;
  iteration?: number;
  data?: Record<string, unknown>;
}
