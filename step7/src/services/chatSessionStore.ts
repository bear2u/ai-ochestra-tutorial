import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { ApprovalMode, ChatMessage, ChatMessageRole, ChatSession, ChatStreamEvent } from "../types";

export interface CreateChatSessionInput {
  workspaceRoot: string;
  autonomous: boolean;
  approvalMode: ApprovalMode;
  maxIterations: number;
  maxMinutes: number;
}

export class ChatSessionStore {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly events = new Map<string, ChatStreamEvent[]>();
  private readonly emitter = new EventEmitter();

  create(input: CreateChatSessionInput): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      status: "active",
      workspaceRoot: input.workspaceRoot,
      autonomous: input.autonomous,
      approvalMode: input.approvalMode,
      maxIterations: input.maxIterations,
      maxMinutes: input.maxMinutes,
      createdAt: now,
      updatedAt: now
    };

    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    this.events.set(session.id, []);

    this.pushEvent(session.id, "chat_session_created", "Chat session created.", {
      workspaceRoot: input.workspaceRoot,
      autonomous: input.autonomous,
      approvalMode: input.approvalMode,
      maxIterations: input.maxIterations,
      maxMinutes: input.maxMinutes
    });

    return session;
  }

  get(chatSessionId: string): ChatSession | undefined {
    return this.sessions.get(chatSessionId);
  }

  list(): ChatSession[] {
    return [...this.sessions.values()].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  }

  setActiveRun(chatSessionId: string, runSessionId: string): void {
    const current = this.sessions.get(chatSessionId);
    if (!current) return;
    current.activeRunId = runSessionId;
    current.updatedAt = new Date().toISOString();

    this.pushEvent(chatSessionId, "chat_run_started", "Run linked to chat session.", {
      runSessionId
    });
  }

  setSummary(chatSessionId: string, summary: string): void {
    const current = this.sessions.get(chatSessionId);
    if (!current) return;
    current.lastSummary = summary;
    current.updatedAt = new Date().toISOString();
    this.pushEvent(chatSessionId, "chat_summary_updated", "Chat summary updated.", { summary });
  }

  appendMessage(chatSessionId: string, role: ChatMessageRole, content: string, linkedRunId?: string): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      chatSessionId,
      role,
      content,
      linkedRunId,
      createdAt: new Date().toISOString()
    };

    const list = this.messages.get(chatSessionId) ?? [];
    list.push(message);
    this.messages.set(chatSessionId, list);

    const current = this.sessions.get(chatSessionId);
    if (current) {
      current.updatedAt = message.createdAt;
    }

    this.pushEvent(chatSessionId, "chat_message", `${role} message appended.`, {
      messageId: message.id,
      role,
      linkedRunId
    });

    return message;
  }

  listMessages(chatSessionId: string): ChatMessage[] {
    return [...(this.messages.get(chatSessionId) ?? [])];
  }

  getEvents(chatSessionId: string): ChatStreamEvent[] {
    return [...(this.events.get(chatSessionId) ?? [])];
  }

  pushEvent(chatSessionId: string, type: string, message: string, data?: Record<string, unknown>): ChatStreamEvent {
    const event: ChatStreamEvent = {
      id: randomUUID(),
      chatSessionId,
      timestamp: new Date().toISOString(),
      type,
      message,
      data
    };

    const list = this.events.get(chatSessionId) ?? [];
    list.push(event);
    this.events.set(chatSessionId, list);
    this.emitter.emit(`chat:${chatSessionId}`, event);

    return event;
  }

  subscribe(chatSessionId: string, handler: (event: ChatStreamEvent) => void): () => void {
    const channel = `chat:${chatSessionId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}
