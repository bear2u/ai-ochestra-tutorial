import { randomUUID } from "node:crypto";
import { reviewArtifactDraftSchema } from "../schemas/step5Artifacts";
import {
  ArchitectureArtifact,
  DesignArtifact,
  FailureClassification,
  PlanArtifact,
  ReviewArtifact,
  ReviewIssue
} from "../types";
import { extractJsonObject } from "../utils/json";

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export interface ReviewerInput {
  sessionId: string;
  iteration: number;
  task: string;
  feedback: string;
  plan?: PlanArtifact;
  architecture?: ArchitectureArtifact;
  design?: DesignArtifact;
  validationSummary: string;
  validationClassification?: FailureClassification;
}

export interface ReviewerPromptTrace {
  sessionId: string;
  role: "reviewer";
  phase: "review";
  system: string;
  user: string;
  iteration: number;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFirstString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const normalizeIssues = (value: unknown, prefix: string): ReviewIssue[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (typeof item === "string" && item.trim()) {
        return {
          id: `${prefix}-${index + 1}`,
          title: item.trim().slice(0, 80),
          detail: item.trim()
        };
      }

      if (!isRecord(item)) return undefined;

      const title = readFirstString(item, ["title", "name", "summary", "issue"]);
      const detail = readFirstString(item, ["detail", "description", "reason", "text"]);
      if (!title || !detail) return undefined;

      const id = readFirstString(item, ["id", "key"]) || `${prefix}-${index + 1}`;
      return { id, title, detail };
    })
    .filter((item): item is ReviewIssue => Boolean(item));
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (isRecord(item)) return readFirstString(item, ["step", "title", "detail", "description", "text"]);
      return "";
    })
    .filter((item): item is string => item.length > 0);
};

const clampScore = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 70;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const normalizeReviewDraft = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    blockingIssues: normalizeIssues(value.blockingIssues, "BLOCK"),
    nonBlockingIssues: normalizeIssues(value.nonBlockingIssues, "INFO"),
    score: clampScore(value.score),
    fixPlan: normalizeStringArray(value.fixPlan)
  };
};

const buildForcedDraft = (input: ReviewerInput): unknown => {
  if (/\[force_review_block\]/i.test(input.task)) {
    return {
      blockingIssues: [
        {
          id: "BLOCK-1",
          title: "Forced blocking issue",
          detail: "Task keyword requested forced review blocking for loop verification."
        }
      ],
      nonBlockingIssues: [],
      score: 45,
      fixPlan: ["Address forced blocking condition and rerun implementation + validation."]
    };
  }

  if (/\[force_review_approve\]/i.test(input.task)) {
    return {
      blockingIssues: [],
      nonBlockingIssues: [
        {
          id: "INFO-1",
          title: "Forced approval",
          detail: "Task keyword requested forced review approval."
        }
      ],
      score: 92,
      fixPlan: []
    };
  }

  return undefined;
};

const applyReviewDefaults = (value: unknown): unknown => {
  const source = isRecord(value) ? value : {};
  const blockingIssues = normalizeIssues(source.blockingIssues, "BLOCK");
  const nonBlockingIssues = normalizeIssues(source.nonBlockingIssues, "INFO");
  const fixPlan = normalizeStringArray(source.fixPlan);
  const score = clampScore(source.score);

  const safeNonBlocking =
    nonBlockingIssues.length > 0
      ? nonBlockingIssues
      : [
          {
            id: "INFO-1",
            title: "No major review concerns",
            detail: "Validation passed and no blocking issue was detected in the review fallback path."
          }
        ];

  return {
    ...source,
    blockingIssues,
    nonBlockingIssues: safeNonBlocking,
    score,
    fixPlan:
      blockingIssues.length > 0
        ? fixPlan.length > 0
          ? fixPlan
          : ["Resolve blocking issues and re-run implementation, validation, and review."]
        : fixPlan
  };
};

export class ReviewerAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly idFactory: () => string = () => randomUUID(),
    private readonly onPrompt?: (trace: ReviewerPromptTrace) => void
  ) {}

  async createReview(input: ReviewerInput): Promise<ReviewArtifact> {
    const forced = buildForcedDraft(input);
    if (forced) {
      const forcedDraft = reviewArtifactDraftSchema.parse({
        iteration: input.iteration,
        ...forced
      });
      return {
        id: this.idFactory(),
        sessionId: input.sessionId,
        phase: "review",
        ...forcedDraft,
        createdAt: new Date().toISOString()
      };
    }

    const system = [
      "You are a reviewer agent in an autonomous coding loop.",
      "Return JSON only.",
      "Keys required: blockingIssues, nonBlockingIssues, score, fixPlan.",
      "Issue items must include id, title, detail.",
      "Use blockingIssues only for must-fix issues that should trigger another iteration.",
      "score must be an integer in range 0..100."
    ].join(" ");

    const user = [
      `Task:\n${input.task}`,
      `Iteration: ${input.iteration}`,
      `Validation classification: ${input.validationClassification ?? "none"}`,
      `Validation summary:\n${input.validationSummary}`,
      `Previous loop feedback:\n${input.feedback || "(none)"}`,
      `Plan goals:\n${input.plan?.goals.join("\n") ?? "(none)"}`,
      `Architecture modules:\n${input.architecture?.modules.map((module) => module.name).join(", ") ?? "(none)"}`,
      `Design checklist:\n${input.design?.implementationChecklist.join("\n") ?? "(none)"}`,
      "Return compact review JSON."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "reviewer",
      phase: "review",
      system,
      user,
      iteration: input.iteration
    });

    let normalized: unknown;
    try {
      const raw = await withTimeout(this.llm.completeJsonObject(system, user), 45000, "reviewer llm call");
      const parsed = JSON.parse(extractJsonObject(raw));
      normalized = normalizeReviewDraft(parsed);
    } catch {
      normalized = {};
    }

    const normalizedDraft =
      typeof normalized === "object" && normalized !== null ? (normalized as Record<string, unknown>) : {};

    const draft = reviewArtifactDraftSchema.parse(
      applyReviewDefaults({
        iteration: input.iteration,
        ...normalizedDraft
      })
    );

    return {
      id: this.idFactory(),
      sessionId: input.sessionId,
      phase: "review",
      ...draft,
      createdAt: new Date().toISOString()
    };
  }
}
