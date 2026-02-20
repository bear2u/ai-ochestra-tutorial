import { randomUUID } from "node:crypto";
import { DiscoveryArtifact, HandoffEnvelope, HandoffStatus, TaskCard, TaskGraphArtifact, TaskStatus } from "../types";

interface RunGraphState {
  graph?: TaskGraphArtifact;
  tasks: TaskCard[];
  handoffs: HandoffEnvelope[];
  discovery?: DiscoveryArtifact;
}

const cloneTask = (task: TaskCard): TaskCard => ({ ...task, dependencies: [...task.dependencies], targetFiles: [...task.targetFiles], acceptanceCriteria: [...task.acceptanceCriteria], commands: [...task.commands] });

export class TaskGraphStore {
  private readonly byRun = new Map<string, RunGraphState>();

  private ensure(runId: string): RunGraphState {
    const current = this.byRun.get(runId) ?? { tasks: [], handoffs: [] };
    this.byRun.set(runId, current);
    return current;
  }

  setGraph(runId: string, tasks: TaskCard[], edges: Array<{ from: string; to: string }>): TaskGraphArtifact {
    const state = this.ensure(runId);
    const graph: TaskGraphArtifact = {
      id: randomUUID(),
      runId,
      tasks: tasks.map(cloneTask),
      edges: edges.map((edge) => ({ ...edge })),
      createdAt: new Date().toISOString()
    };

    state.graph = graph;
    state.tasks = tasks.map(cloneTask);
    return graph;
  }

  getGraph(runId: string): TaskGraphArtifact | undefined {
    const state = this.byRun.get(runId);
    if (!state?.graph) return undefined;
    return {
      ...state.graph,
      tasks: state.graph.tasks.map(cloneTask),
      edges: state.graph.edges.map((edge) => ({ ...edge }))
    };
  }

  setDiscovery(runId: string, discovery: DiscoveryArtifact): void {
    const state = this.ensure(runId);
    state.discovery = {
      ...discovery,
      candidates: discovery.candidates.map((candidate) => ({ ...candidate, reasons: [...candidate.reasons] })),
      selectedFiles: [...discovery.selectedFiles]
    };
  }

  getDiscovery(runId: string): DiscoveryArtifact | undefined {
    const discovery = this.byRun.get(runId)?.discovery;
    if (!discovery) return undefined;
    return {
      ...discovery,
      candidates: discovery.candidates.map((candidate) => ({ ...candidate, reasons: [...candidate.reasons] })),
      selectedFiles: [...discovery.selectedFiles]
    };
  }

  listTasks(runId: string): TaskCard[] {
    return (this.byRun.get(runId)?.tasks ?? []).map(cloneTask);
  }

  getTask(runId: string, taskId: string): TaskCard | undefined {
    const state = this.byRun.get(runId);
    const task = state?.tasks.find((item) => item.id === taskId);
    return task ? cloneTask(task) : undefined;
  }

  updateTask(runId: string, taskId: string, update: Partial<TaskCard>): TaskCard | undefined {
    const state = this.byRun.get(runId);
    if (!state) return undefined;

    const index = state.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) return undefined;

    const next: TaskCard = {
      ...state.tasks[index],
      ...update,
      dependencies: update.dependencies ? [...update.dependencies] : [...state.tasks[index].dependencies],
      targetFiles: update.targetFiles ? [...update.targetFiles] : [...state.tasks[index].targetFiles],
      acceptanceCriteria: update.acceptanceCriteria
        ? [...update.acceptanceCriteria]
        : [...state.tasks[index].acceptanceCriteria],
      commands: update.commands ? [...update.commands] : [...state.tasks[index].commands],
      updatedAt: new Date().toISOString()
    };

    state.tasks[index] = next;
    return cloneTask(next);
  }

  setTaskStatus(runId: string, taskId: string, status: TaskStatus, extras?: Partial<TaskCard>): TaskCard | undefined {
    return this.updateTask(runId, taskId, {
      ...extras,
      status,
      updatedAt: new Date().toISOString()
    });
  }

  setHandoffs(runId: string, handoffs: HandoffEnvelope[]): void {
    const state = this.ensure(runId);
    state.handoffs = handoffs.map((handoff) => ({
      ...handoff,
      requiredArtifacts: [...handoff.requiredArtifacts],
      requiredChecks: [...handoff.requiredChecks]
    }));
  }

  listHandoffs(runId: string): HandoffEnvelope[] {
    return (this.byRun.get(runId)?.handoffs ?? []).map((handoff) => ({
      ...handoff,
      requiredArtifacts: [...handoff.requiredArtifacts],
      requiredChecks: [...handoff.requiredChecks]
    }));
  }

  updateHandoffStatus(runId: string, handoffId: string, status: HandoffStatus): HandoffEnvelope | undefined {
    const state = this.byRun.get(runId);
    if (!state) return undefined;

    const index = state.handoffs.findIndex((handoff) => handoff.id === handoffId);
    if (index === -1) return undefined;

    const current = state.handoffs[index];
    const next: HandoffEnvelope = {
      ...current,
      status,
      resolvedAt: status === "pending" ? undefined : new Date().toISOString()
    };
    state.handoffs[index] = next;
    return {
      ...next,
      requiredArtifacts: [...next.requiredArtifacts],
      requiredChecks: [...next.requiredChecks]
    };
  }
}
