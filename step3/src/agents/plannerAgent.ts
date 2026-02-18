import { randomUUID } from "node:crypto";
import { planDraftSchema } from "../schemas/step3Artifacts";
import { PlanArtifact } from "../types";
import { extractJsonObject } from "../utils/json";

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export interface PlannerInput {
  sessionId: string;
  topic: string;
  filePaths: string[];
}

export interface PlannerPromptTrace {
  sessionId: string;
  role: "planner";
  phase: "planning";
  system: string;
  user: string;
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

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isRecord(item)) return "";
      return readFirstString(item, ["goal", "title", "description", "text", "name", "value"]);
    })
    .filter((item): item is string => item.length > 0);
};

const normalizeRequirementPriority = (value: unknown): "must" | "should" | "could" => {
  if (typeof value !== "string") return "should";
  const lowered = value.trim().toLowerCase();
  if (lowered === "must" || lowered === "should" || lowered === "could") {
    return lowered;
  }
  return "should";
};

const normalizeRequirements = (
  value: unknown
): Array<{ id: string; description: string; priority: "must" | "should" | "could" }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!isRecord(item)) return undefined;
      const description =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : readFirstString(item, ["description", "text", "detail", "goal", "requirement"]);
      if (!description) return undefined;
      return {
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : readFirstString(item, ["key", "name", "title"]) || `REQ-${index + 1}`,
        description,
        priority: normalizeRequirementPriority(item.priority)
      };
    })
    .filter((item): item is { id: string; description: string; priority: "must" | "should" | "could" } => Boolean(item));
};

const normalizePlanDraft = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    goals: normalizeStringArray(value.goals),
    requirements: normalizeRequirements(value.requirements),
    constraints: normalizeStringArray(value.constraints),
    assumptions: normalizeStringArray(value.assumptions),
    doneCriteria: normalizeStringArray(value.doneCriteria)
  };
};

const applyPlanDefaults = (value: unknown, input: PlannerInput): unknown => {
  const source = isRecord(value) ? value : {};
  const goals = normalizeStringArray(source.goals);
  const requirements = normalizeRequirements(source.requirements);
  const constraints = normalizeStringArray(source.constraints);
  const assumptions = normalizeStringArray(source.assumptions);
  const doneCriteria = normalizeStringArray(source.doneCriteria);

  return {
    ...source,
    goals: goals.length > 0 ? goals : [`Deliver ${input.topic}`],
    requirements:
      requirements.length > 0
        ? requirements
        : [
            {
              id: "REQ-1",
              description: input.filePaths[0]
                ? `Implement ${input.topic} in ${input.filePaths[0]}.`
                : `Implement ${input.topic}.`,
              priority: "must" as const
            }
          ],
    constraints,
    assumptions,
    doneCriteria: doneCriteria.length > 0 ? doneCriteria : ["Configured validation command passes."]
  };
};

export class PlannerAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly idFactory: () => string = () => randomUUID(),
    private readonly onPrompt?: (trace: PlannerPromptTrace) => void
  ) {}

  async createPlan(input: PlannerInput): Promise<PlanArtifact> {
    const system = [
      "You are a planning agent for software delivery.",
      "Return JSON only.",
      "Keys required: goals, requirements, constraints, assumptions, doneCriteria.",
      "requirements items must include id, description, priority(must|should|could).",
      "goals/constraints/assumptions/doneCriteria must be arrays of plain strings (not objects)."
    ].join(" ");

    const user = [
      `Topic:\n${input.topic}`,
      `Candidate files:\n${input.filePaths.join("\n") || "(none)"}`,
      "Create an implementation-focused plan artifact."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "planner",
      phase: "planning",
      system,
      user
    });

    let normalized: unknown;
    try {
      const raw = await withTimeout(this.llm.completeJsonObject(system, user), 60000, "planner llm call");
      const parsed = JSON.parse(extractJsonObject(raw));
      normalized = normalizePlanDraft(parsed);
    } catch {
      normalized = {};
    }

    const draft = planDraftSchema.parse(applyPlanDefaults(normalized, input));

    return {
      id: this.idFactory(),
      sessionId: input.sessionId,
      phase: "planning",
      topic: input.topic,
      ...draft,
      createdAt: new Date().toISOString()
    };
  }
}
