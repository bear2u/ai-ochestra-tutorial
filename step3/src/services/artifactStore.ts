import { ArchitectureArtifact, DesignArtifact, PlanArtifact, Step3Artifact } from "../types";

type Step3ArtifactPhase = "planning" | "architecture" | "design";

type SessionArtifacts = Partial<Record<Step3ArtifactPhase, Step3Artifact>>;

export class ArtifactStore {
  private readonly bySession = new Map<string, SessionArtifacts>();

  save(sessionId: string, artifact: Step3Artifact): void {
    const current = this.bySession.get(sessionId) ?? {};
    current[artifact.phase] = artifact;
    this.bySession.set(sessionId, current);
  }

  get<T extends Step3Artifact>(sessionId: string, phase: T["phase"]): T | undefined {
    const current = this.bySession.get(sessionId);
    if (!current) return undefined;
    return current[phase] as T | undefined;
  }

  getAll(sessionId: string): Step3Artifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];

    return ["planning", "architecture", "design"]
      .map((phase) => current[phase as Step3ArtifactPhase])
      .filter((artifact): artifact is Step3Artifact => artifact !== undefined);
  }

  getRefs(sessionId: string): { planning?: string; architecture?: string; design?: string } {
    const planning = this.get<PlanArtifact>(sessionId, "planning");
    const architecture = this.get<ArchitectureArtifact>(sessionId, "architecture");
    const design = this.get<DesignArtifact>(sessionId, "design");

    return {
      ...(planning ? { planning: planning.id } : {}),
      ...(architecture ? { architecture: architecture.id } : {}),
      ...(design ? { design: design.id } : {})
    };
  }
}
