import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { FailureClassification, PhaseName, PhaseStatus, SessionEvent, SessionInput, SessionState, SessionStatus } from "../types";

const phaseOrder: PhaseName[] = [
  "planning",
  "architecture",
  "design",
  "implementation",
  "validation",
  "review",
  "packaging"
];

const createInitialPhaseStatuses = (): Record<PhaseName, PhaseStatus> =>
  Object.fromEntries(phaseOrder.map((phase) => [phase, "pending"])) as Record<PhaseName, PhaseStatus>;

interface EventOptions {
  data?: Record<string, unknown>;
  phase?: PhaseName;
  iteration?: number;
  artifactId?: string;
  classification?: FailureClassification;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly events = new Map<string, SessionEvent[]>();
  private readonly emitter = new EventEmitter();

  create(input: SessionInput): SessionState {
    const session: SessionState = {
      id: randomUUID(),
      status: "pending",
      input,
      attempt: 0,
      iteration: 0,
      phaseStatuses: createInitialPhaseStatuses(),
      artifactRefs: {},
      startedAt: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    this.events.set(session.id, []);
    return session;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  all(): SessionState[] {
    return [...this.sessions.values()].sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
  }

  updateStatus(sessionId: string, status: SessionStatus, finalSummary?: string): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;

    current.status = status;
    if (status === "success" || status === "failed") {
      current.endedAt = new Date().toISOString();
      current.finalSummary = finalSummary;
    }
  }

  setAttempt(sessionId: string, attempt: number): void {
    this.setIteration(sessionId, attempt);
  }

  setIteration(sessionId: string, iteration: number): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;
    current.iteration = iteration;
    current.attempt = iteration;
  }

  setCurrentPhase(sessionId: string, phase: PhaseName): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;
    current.currentPhase = phase;
  }

  setPhaseStatus(sessionId: string, phase: PhaseName, status: PhaseStatus): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;
    current.phaseStatuses = {
      ...(current.phaseStatuses ?? createInitialPhaseStatuses()),
      [phase]: status
    };
  }

  setArtifactRef(sessionId: string, phase: "planning" | "architecture" | "design" | "validation", artifactId: string): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;
    current.artifactRefs = {
      ...(current.artifactRefs ?? {}),
      [phase]: artifactId
    };
  }

  pushEvent(
    sessionId: string,
    role: SessionEvent["role"],
    type: string,
    message: string,
    options: EventOptions = {}
  ): SessionEvent {
    const event: SessionEvent = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      role,
      type,
      message,
      phase: options.phase,
      iteration: options.iteration,
      artifactId: options.artifactId,
      classification: options.classification,
      data: options.data
    };
    const list = this.events.get(sessionId) ?? [];
    list.push(event);
    this.events.set(sessionId, list);
    this.emitter.emit(`session:${sessionId}`, event);
    return event;
  }

  getEvents(sessionId: string): SessionEvent[] {
    return [...(this.events.get(sessionId) ?? [])];
  }

  subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}
