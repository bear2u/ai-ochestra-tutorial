import { ArchitectureArtifact, DesignArtifact, PlanArtifact, ReviewArtifact, Step5Artifact, ValidationArtifact } from "../types";

type SessionArtifacts = {
  planning?: PlanArtifact;
  architecture?: ArchitectureArtifact;
  design?: DesignArtifact;
  validations: ValidationArtifact[];
  reviews: ReviewArtifact[];
};

export class ArtifactStore {
  private readonly bySession = new Map<string, SessionArtifacts>();

  save(sessionId: string, artifact: Step5Artifact): void {
    const current = this.bySession.get(sessionId) ?? { validations: [], reviews: [] };
    if (artifact.phase === "validation") {
      current.validations.push(artifact);
    } else if (artifact.phase === "review") {
      current.reviews.push(artifact);
    } else if (artifact.phase === "planning") {
      current.planning = artifact;
    } else if (artifact.phase === "architecture") {
      current.architecture = artifact;
    } else {
      current.design = artifact;
    }
    this.bySession.set(sessionId, current);
  }

  get(sessionId: string, phase: "planning"): PlanArtifact | undefined;
  get(sessionId: string, phase: "architecture"): ArchitectureArtifact | undefined;
  get(sessionId: string, phase: "design"): DesignArtifact | undefined;
  get(sessionId: string, phase: "validation"): ValidationArtifact | undefined;
  get(sessionId: string, phase: "review"): ReviewArtifact | undefined;
  get(sessionId: string, phase: Step5Artifact["phase"]): Step5Artifact | undefined {
    const current = this.bySession.get(sessionId);
    if (!current) return undefined;

    if (phase === "validation") {
      return current.validations[current.validations.length - 1];
    }
    if (phase === "review") {
      return current.reviews[current.reviews.length - 1];
    }
    if (phase === "planning") return current.planning;
    if (phase === "architecture") return current.architecture;
    return current.design;
  }

  getAll(sessionId: string): Step5Artifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];

    const preLoop = [current.planning, current.architecture, current.design].filter(
      (artifact): artifact is PlanArtifact | ArchitectureArtifact | DesignArtifact => artifact !== undefined
    );

    return [...preLoop, ...current.validations, ...current.reviews];
  }

  getValidationArtifacts(sessionId: string): ValidationArtifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];
    return [...current.validations];
  }

  getReviewArtifacts(sessionId: string): ReviewArtifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];
    return [...current.reviews];
  }

  getRefs(sessionId: string): { planning?: string; architecture?: string; design?: string; validation?: string; review?: string } {
    const planning = this.get(sessionId, "planning");
    const architecture = this.get(sessionId, "architecture");
    const design = this.get(sessionId, "design");
    const validation = this.get(sessionId, "validation");
    const review = this.get(sessionId, "review");

    return {
      ...(planning ? { planning: planning.id } : {}),
      ...(architecture ? { architecture: architecture.id } : {}),
      ...(design ? { design: design.id } : {}),
      ...(validation ? { validation: validation.id } : {}),
      ...(review ? { review: review.id } : {})
    };
  }
}
