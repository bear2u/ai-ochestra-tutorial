export type AgentRole = "supervisor" | "dev" | "test" | "planner" | "architect" | "designer";

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

export interface PlanArtifact {
  id: string;
  sessionId: string;
  phase: "planning";
  topic: string;
  goals: string[];
  requirements: {
    id: string;
    description: string;
    priority: "must" | "should" | "could";
  }[];
  constraints: string[];
  assumptions: string[];
  doneCriteria: string[];
  createdAt: string;
}

export interface ArchitectureArtifact {
  id: string;
  sessionId: string;
  phase: "architecture";
  overview: string;
  modules: {
    name: string;
    responsibility: string;
    files: string[];
  }[];
  decisions: {
    title: string;
    rationale: string;
    tradeoffs: string[];
  }[];
  risks: {
    risk: string;
    mitigation: string;
  }[];
  createdAt: string;
}

export interface DesignArtifact {
  id: string;
  sessionId: string;
  phase: "design";
  components: {
    name: string;
    purpose: string;
    files: string[];
  }[];
  apis: {
    name: string;
    input: string;
    output: string;
    errors: string[];
  }[];
  dataModels: {
    name: string;
    fields: string[];
  }[];
  implementationChecklist: string[];
  testIdeas: string[];
  createdAt: string;
}

export type Step3Artifact = PlanArtifact | ArchitectureArtifact | DesignArtifact;

export interface SessionState {
  id: string;
  status: SessionStatus;
  input: SessionInput;
  attempt: number;
  iteration: number;
  currentPhase?: PhaseName;
  phaseStatuses?: Record<PhaseName, PhaseStatus>;
  artifactRefs?: Partial<Record<"planning" | "architecture" | "design", string>>;
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
  artifactId?: string;
  data?: Record<string, unknown>;
}
