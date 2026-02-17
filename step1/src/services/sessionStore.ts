import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { SessionEvent, SessionInput, SessionState, SessionStatus } from "../types";

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
    const current = this.sessions.get(sessionId);
    if (!current) return;
    current.attempt = attempt;
  }

  pushEvent(sessionId: string, role: SessionEvent["role"], type: string, message: string, data?: Record<string, unknown>): SessionEvent {
    const event: SessionEvent = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      role,
      type,
      message,
      data
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
