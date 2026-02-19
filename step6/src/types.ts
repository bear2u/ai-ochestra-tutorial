export type AgentRole = "supervisor" | "dev" | "test" | "planner" | "architect" | "designer" | "reviewer" | "advisor" | "packager";

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

export type FailureClassification = "lint" | "type" | "test" | "runtime" | "unknown";

export type ValidationStage = "lint" | "type" | "test" | "custom";
export type BudgetExhaustedReason = "iterations" | "minutes";

export interface FileChange {
  path: string;
  patch?: string;
  fallbackContent?: string;
  content?: string;
}

export type AppliedChangeMode = "patch" | "fallbackContent" | "content";

export interface AppliedChangeResult {
  path: string;
  mode: AppliedChangeMode;
}

export interface DevOutput {
  rationale: string;
  changes: FileChange[];
  commands?: string[];
}

export interface TestResult {
  passed: boolean;
  summary: string;
  commandOutput: string;
  exitCode: number;
  classification?: FailureClassification;
}

export interface SessionInput {
  topic?: string;
  task?: string;
  autonomous?: boolean;
  workspaceRoot?: string;
  filePaths: string[];
  testCommand?: string;
  validationCommands?: string[];
  maxAttempts?: number;
  maxIterations?: number;
  maxMinutes?: number;
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

export interface ValidationStepResult {
  stage: ValidationStage;
  command: string;
  passed: boolean;
  exitCode: number;
  output: string;
  summary: string;
  durationMs: number;
  classification?: FailureClassification;
}

export interface ValidationArtifact {
  id: string;
  sessionId: string;
  phase: "validation";
  iteration: number;
  passed: boolean;
  summary: string;
  classification?: FailureClassification;
  steps: ValidationStepResult[];
  createdAt: string;
}

export interface ReviewIssue {
  id: string;
  title: string;
  detail: string;
}

export interface ReviewArtifact {
  id: string;
  sessionId: string;
  phase: "review";
  iteration: number;
  blockingIssues: ReviewIssue[];
  nonBlockingIssues: ReviewIssue[];
  score: number;
  fixPlan: string[];
  createdAt: string;
}

export interface SupervisorAdvice {
  iteration: number;
  focusSummary: string;
  feedbackPatch: string[];
  riskNotes: string[];
  recommendedAction: "continue" | "rework" | "approve";
  confidence: number;
}

export interface PrPackageArtifact {
  id: string;
  sessionId: string;
  phase: "packaging";
  iteration: number;
  topic: string;
  title: string;
  body: string;
  changedFiles: string[];
  testSummary: string;
  reviewSummary: string;
  riskNotes: string[];
  advisorNotes: string[];
  outputPath: string;
  createdAt: string;
}

export interface BudgetState {
  maxIterations: number;
  maxMinutes: number;
  startedAt: string;
  deadlineAt: string;
  elapsedMs: number;
  remainingIterations: number;
  exhaustedReason?: BudgetExhaustedReason;
}

export type Step5Artifact = PlanArtifact | ArchitectureArtifact | DesignArtifact | ValidationArtifact | ReviewArtifact;
export type Step6Artifact = Step5Artifact | PrPackageArtifact;

export interface SessionState {
  id: string;
  status: SessionStatus;
  input: SessionInput;
  attempt: number;
  iteration: number;
  currentPhase?: PhaseName;
  phaseStatuses?: Record<PhaseName, PhaseStatus>;
  artifactRefs?: Partial<Record<"planning" | "architecture" | "design" | "validation" | "review" | "packaging", string>>;
  budget?: BudgetState;
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
  classification?: FailureClassification;
  data?: Record<string, unknown>;
}
