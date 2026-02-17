export type AgentRole = "supervisor" | "dev" | "test";

export type SessionStatus = "pending" | "running" | "success" | "failed";

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
  data?: Record<string, unknown>;
}
