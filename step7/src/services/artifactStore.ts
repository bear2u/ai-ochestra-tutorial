import {
  ArchitectureArtifact,
  DesignArtifact,
  GoalValidationArtifact,
  PlanArtifact,
  PrPackageArtifact,
  ReviewArtifact,
  Step7Artifact,
  ValidationArtifact
} from "../types";

type SessionArtifacts = {
  planning?: PlanArtifact;
  architecture?: ArchitectureArtifact;
  design?: DesignArtifact;
  goalValidations: GoalValidationArtifact[];
  validations: ValidationArtifact[];
  reviews: ReviewArtifact[];
  packaging?: PrPackageArtifact;
};

export class ArtifactStore {
  private readonly bySession = new Map<string, SessionArtifacts>();

  save(sessionId: string, artifact: Step7Artifact): void {
    const current = this.bySession.get(sessionId) ?? { goalValidations: [], validations: [], reviews: [] };
    if (artifact.phase === "goal_validation") {
      current.goalValidations.push(artifact);
    } else if (artifact.phase === "validation") {
      current.validations.push(artifact);
    } else if (artifact.phase === "review") {
      current.reviews.push(artifact);
    } else if (artifact.phase === "planning") {
      current.planning = artifact;
    } else if (artifact.phase === "architecture") {
      current.architecture = artifact;
    } else if (artifact.phase === "design") {
      current.design = artifact;
    } else {
      current.packaging = artifact;
    }
    this.bySession.set(sessionId, current);
  }

  get(sessionId: string, phase: "planning"): PlanArtifact | undefined;
  get(sessionId: string, phase: "architecture"): ArchitectureArtifact | undefined;
  get(sessionId: string, phase: "design"): DesignArtifact | undefined;
  get(sessionId: string, phase: "goal_validation"): GoalValidationArtifact | undefined;
  get(sessionId: string, phase: "validation"): ValidationArtifact | undefined;
  get(sessionId: string, phase: "review"): ReviewArtifact | undefined;
  get(sessionId: string, phase: "packaging"): PrPackageArtifact | undefined;
  get(sessionId: string, phase: Step7Artifact["phase"]): Step7Artifact | undefined {
    const current = this.bySession.get(sessionId);
    if (!current) return undefined;

    if (phase === "goal_validation") {
      return current.goalValidations[current.goalValidations.length - 1];
    }
    if (phase === "validation") {
      return current.validations[current.validations.length - 1];
    }
    if (phase === "review") {
      return current.reviews[current.reviews.length - 1];
    }
    if (phase === "planning") return current.planning;
    if (phase === "architecture") return current.architecture;
    if (phase === "design") return current.design;
    return current.packaging;
  }

  getAll(sessionId: string): Step7Artifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];

    const preLoop = [current.planning, current.architecture, current.design].filter(
      (artifact): artifact is PlanArtifact | ArchitectureArtifact | DesignArtifact => artifact !== undefined
    );

    return [
      ...preLoop,
      ...current.goalValidations,
      ...current.validations,
      ...current.reviews,
      ...(current.packaging ? [current.packaging] : [])
    ];
  }

  getValidationArtifacts(sessionId: string): ValidationArtifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];
    return [...current.validations];
  }

  getGoalValidationArtifacts(sessionId: string): GoalValidationArtifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];
    return [...current.goalValidations];
  }

  getReviewArtifacts(sessionId: string): ReviewArtifact[] {
    const current = this.bySession.get(sessionId);
    if (!current) return [];
    return [...current.reviews];
  }

  getPrPackage(sessionId: string): PrPackageArtifact | undefined {
    const current = this.bySession.get(sessionId);
    return current?.packaging;
  }

  getRefs(sessionId: string): {
    planning?: string;
    architecture?: string;
    design?: string;
    goal_validation?: string;
    validation?: string;
    review?: string;
    packaging?: string;
  } {
    const planning = this.get(sessionId, "planning");
    const architecture = this.get(sessionId, "architecture");
    const design = this.get(sessionId, "design");
    const goalValidation = this.get(sessionId, "goal_validation");
    const validation = this.get(sessionId, "validation");
    const review = this.get(sessionId, "review");
    const packaging = this.get(sessionId, "packaging");

    return {
      ...(planning ? { planning: planning.id } : {}),
      ...(architecture ? { architecture: architecture.id } : {}),
      ...(design ? { design: design.id } : {}),
      ...(goalValidation ? { goal_validation: goalValidation.id } : {}),
      ...(validation ? { validation: validation.id } : {}),
      ...(review ? { review: review.id } : {}),
      ...(packaging ? { packaging: packaging.id } : {})
    };
  }
}
