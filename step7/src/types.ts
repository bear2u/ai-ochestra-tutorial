export type AgentRole =
  | "supervisor"
  | "dev"
  | "test"
  | "validator"
  | "planner"
  | "architect"
  | "designer"
  | "reviewer"
  | "advisor"
  | "packager"
  | "coordinator"
  | "worker"
  | "discoverer";

export type SessionStatus = "pending" | "running" | "waiting_approval" | "success" | "failed";

export type PhaseName =
  | "planning"
  | "architecture"
  | "design"
  | "implementation"
  | "goal_validation"
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
  approvalMode?: ApprovalMode;
  workspaceRoot?: string;
  chatSessionId?: string;
  originMessageId?: string;
  filePaths: string[];
  testCommand?: string;
  validationCommands?: string[];
  validationGuidance?: string;
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

export interface GoalValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  expected?: string;
  actual?: string;
}

export interface GoalValidationArtifact {
  id: string;
  sessionId: string;
  phase: "goal_validation";
  iteration: number;
  passed: boolean;
  summary: string;
  checks: GoalValidationCheck[];
  missingTargets: string[];
  suggestions: string[];
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

export type Step5Artifact = PlanArtifact | ArchitectureArtifact | DesignArtifact | GoalValidationArtifact | ValidationArtifact | ReviewArtifact;
export type Step6Artifact = Step5Artifact | PrPackageArtifact;
export type Step7Artifact = Step6Artifact;

export interface SessionState {
  id: string;
  status: SessionStatus;
  input: SessionInput;
  attempt: number;
  iteration: number;
  currentPhase?: PhaseName;
  phaseStatuses?: Record<PhaseName, PhaseStatus>;
  artifactRefs?: Partial<Record<"planning" | "architecture" | "design" | "goal_validation" | "validation" | "review" | "packaging", string>>;
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

export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatSessionStatus = "active" | "closed";

export interface ChatSession {
  id: string;
  status: ChatSessionStatus;
  workspaceRoot: string;
  autonomous: boolean;
  approvalMode: ApprovalMode;
  maxIterations: number;
  maxMinutes: number;
  activeRunId?: string;
  lastSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  chatSessionId: string;
  role: ChatMessageRole;
  content: string;
  linkedRunId?: string;
  createdAt: string;
}

export interface ChatStreamEvent {
  id: string;
  chatSessionId: string;
  timestamp: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export type TaskPhase = "planning" | "implementation" | "validation" | "review" | "packaging";
export type TaskStatus = "queued" | "running" | "review" | "done" | "blocked" | "failed";

export interface TaskCard {
  id: string;
  runId: string;
  title: string;
  objective: string;
  phase: TaskPhase;
  status: TaskStatus;
  assignee: AgentRole;
  dependencies: string[];
  targetFiles: string[];
  acceptanceCriteria: string[];
  commands: string[];
  handoffRequired?: boolean;
  retries: number;
  summary?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type HandoffStatus = "pending" | "accepted" | "rejected" | "completed";

export interface HandoffEnvelope {
  id: string;
  runId: string;
  fromTaskId: string;
  toTaskId: string;
  reason: string;
  requiredArtifacts: string[];
  requiredChecks: string[];
  status: HandoffStatus;
  createdAt: string;
  resolvedAt?: string;
}

export type ApprovalRiskLevel = "low" | "medium" | "high";
export type ApprovalMode = "manual" | "auto_safe" | "auto_all";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId?: string;
  command: string;
  reason: string;
  riskLevel: ApprovalRiskLevel;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface DiscoveryCandidate {
  path: string;
  score: number;
  reasons: string[];
}

export interface DiscoveryArtifact {
  id: string;
  runId: string;
  workspaceRoot: string;
  candidates: DiscoveryCandidate[];
  selectedFiles: string[];
  reasoning: string;
  createdAt: string;
}

export interface TaskGraphArtifact {
  id: string;
  runId: string;
  tasks: TaskCard[];
  edges: Array<{ from: string; to: string }>;
  createdAt: string;
}
