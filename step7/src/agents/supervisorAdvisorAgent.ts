import { supervisorAdviceDraftSchema } from "../schemas/step6Artifacts";
import { BudgetState, FailureClassification, SupervisorAdvice } from "../types";
import { extractJsonObject } from "../utils/json";

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export interface SupervisorAdvisorInput {
  sessionId: string;
  iteration: number;
  topic: string;
  feedback: string;
  validationSummary?: string;
  validationClassification?: FailureClassification;
  reviewSummary?: string;
  budget?: BudgetState;
  artifactRefs?: Record<string, string | undefined>;
}

export interface SupervisorAdvisorPromptTrace {
  sessionId: string;
  role: "advisor";
  phase: "implementation";
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

export class SupervisorAdvisorAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly onPrompt?: (trace: SupervisorAdvisorPromptTrace) => void
  ) {}

  async createAdvice(input: SupervisorAdvisorInput): Promise<SupervisorAdvice> {
    const system = [
      "You are a supervisor advisory agent for an autonomous coding loop.",
      "Return JSON only.",
      "Required keys: iteration, focusSummary, feedbackPatch, riskNotes, recommendedAction, confidence.",
      "recommendedAction must be one of continue|rework|approve.",
      "feedbackPatch and riskNotes must be arrays of short plain strings.",
      "confidence must be number 0..1."
    ].join(" ");

    const user = [
      `Topic:\n${input.topic}`,
      `Iteration: ${input.iteration}`,
      `Current feedback:\n${input.feedback || "(none)"}`,
      `Validation classification: ${input.validationClassification ?? "none"}`,
      `Validation summary:\n${input.validationSummary ?? "(none)"}`,
      `Review summary:\n${input.reviewSummary ?? "(none)"}`,
      `Budget snapshot:\n${JSON.stringify(input.budget ?? {}, null, 2)}`,
      `Artifact refs:\n${JSON.stringify(input.artifactRefs ?? {}, null, 2)}`,
      "Generate concise advisory guidance for the next implementation step."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "advisor",
      phase: "implementation",
      system,
      user,
      iteration: input.iteration
    });

    const raw = await withTimeout(this.llm.completeJsonObject(system, user), 30000, "advisor llm call");
    const parsed = JSON.parse(extractJsonObject(raw));

    const advice = supervisorAdviceDraftSchema.parse({
      ...parsed,
      iteration: input.iteration
    });

    return advice;
  }
}
