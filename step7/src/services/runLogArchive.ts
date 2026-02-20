import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import {
  ApprovalRequest,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  DiscoveryArtifact,
  HandoffEnvelope,
  SessionEvent,
  SessionState,
  Step7Artifact,
  TaskCard
} from "../types";

export interface RunLogSnapshot {
  version: 1;
  runId: string;
  archivedAt: string;
  trigger: {
    type: string;
    eventId: string;
    message: string;
    phase?: string;
    iteration?: number;
    timestamp: string;
  };
  session: SessionState;
  events: SessionEvent[];
  tasks: TaskCard[];
  handoffs: HandoffEnvelope[];
  discovery: DiscoveryArtifact | null;
  approvalsPending: ApprovalRequest[];
  artifacts: Step7Artifact[];
  prPackage: Step7Artifact | null;
  chat: {
    session: ChatSession;
    messages: ChatMessage[];
    events: ChatStreamEvent[];
  } | null;
}

export interface RunLogIndexEntry {
  runId: string;
  archivedAt: string;
  triggerType: string;
  triggerEventId: string;
  sessionStatus: SessionState["status"];
  relativePath: string;
}

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export class RunLogArchive {
  private readonly rootDir: string;
  private readonly indexFilePath: string;

  constructor(rootDir = path.join(config.workspaceRoot, ".orchestra", "run-logs")) {
    this.rootDir = rootDir;
    this.indexFilePath = path.join(this.rootDir, "index.json");
  }

  getRootDir(): string {
    return this.rootDir;
  }

  async write(snapshot: RunLogSnapshot): Promise<RunLogIndexEntry> {
    const runDir = path.join(this.rootDir, safeSegment(snapshot.runId));
    await fs.mkdir(runDir, { recursive: true });

    const stamp = snapshot.archivedAt.replace(/[:.]/g, "-");
    const fileName = `${stamp}-${safeSegment(snapshot.trigger.type)}.json`;
    const absolutePath = path.join(runDir, fileName);
    const latestPath = path.join(runDir, "latest.json");
    const payload = JSON.stringify(snapshot, null, 2);

    await fs.writeFile(absolutePath, payload, "utf8");
    await fs.writeFile(latestPath, payload, "utf8");

    const entry: RunLogIndexEntry = {
      runId: snapshot.runId,
      archivedAt: snapshot.archivedAt,
      triggerType: snapshot.trigger.type,
      triggerEventId: snapshot.trigger.eventId,
      sessionStatus: snapshot.session.status,
      relativePath: path.join(safeSegment(snapshot.runId), fileName)
    };

    const current = await this.readIndex();
    const next = [entry, ...current].slice(0, 500);
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(this.indexFilePath, JSON.stringify(next, null, 2), "utf8");

    return entry;
  }

  async list(limit = 20): Promise<RunLogIndexEntry[]> {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(Math.round(limit), 200)) : 20;
    const index = await this.readIndex();
    return index.slice(0, bounded);
  }

  async readLatest(): Promise<RunLogSnapshot | undefined> {
    const [latest] = await this.list(1);
    if (!latest) return undefined;
    return this.readByRelativePath(latest.relativePath);
  }

  async readByRunId(runId: string): Promise<RunLogSnapshot | undefined> {
    const index = await this.readIndex();
    const matched = index.find((entry) => entry.runId === runId);
    if (matched) {
      return this.readByRelativePath(matched.relativePath);
    }

    const fallbackPath = path.join(this.rootDir, safeSegment(runId), "latest.json");
    try {
      const raw = await fs.readFile(fallbackPath, "utf8");
      return JSON.parse(raw) as RunLogSnapshot;
    } catch {
      return undefined;
    }
  }

  private async readByRelativePath(relativePath: string): Promise<RunLogSnapshot | undefined> {
    try {
      const absolutePath = path.join(this.rootDir, relativePath);
      const raw = await fs.readFile(absolutePath, "utf8");
      return JSON.parse(raw) as RunLogSnapshot;
    } catch {
      return undefined;
    }
  }

  private async readIndex(): Promise<RunLogIndexEntry[]> {
    try {
      const raw = await fs.readFile(this.indexFilePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => entry && typeof entry.runId === "string" && typeof entry.relativePath === "string");
    } catch {
      return [];
    }
  }
}

