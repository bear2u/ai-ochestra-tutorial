import { randomUUID } from "node:crypto";
import { architectureDraftSchema } from "../schemas/step3Artifacts";
import { ArchitectureArtifact, PlanArtifact } from "../types";
import { extractJsonObject } from "../utils/json";

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export interface ArchitectInput {
  sessionId: string;
  plan: PlanArtifact;
}

export interface ArchitectPromptTrace {
  sessionId: string;
  role: "architect";
  phase: "architecture";
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

const normalizeStringList = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isRecord(item)) return "";
      return readFirstString(item, ["title", "description", "text", "name", "value"]);
    })
    .filter((item): item is string => item.length > 0);
};

const normalizeArchitectureDraft = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  const overview =
    typeof value.overview === "string"
      ? value.overview.trim()
      : isRecord(value.overview)
        ? readFirstString(value.overview, ["overview", "summary", "description", "text", "title"])
        : "";

  const modules = Array.isArray(value.modules)
    ? value.modules
        .map((item) => {
          if (!isRecord(item)) return item;
          return {
            ...item,
            name: typeof item.name === "string" ? item.name.trim() : readFirstString(item, ["module", "title", "name"]),
            responsibility:
              typeof item.responsibility === "string"
                ? item.responsibility.trim()
                : readFirstString(item, ["responsibility", "description", "purpose", "text"]),
            files: normalizeStringList(item.files)
          };
        })
        .filter(Boolean)
    : value.modules;

  const decisions = Array.isArray(value.decisions)
    ? value.decisions
        .map((item) => {
          if (!isRecord(item)) return item;
          return {
            ...item,
            title: typeof item.title === "string" ? item.title.trim() : readFirstString(item, ["title", "decision", "name"]),
            rationale:
              typeof item.rationale === "string"
                ? item.rationale.trim()
                : readFirstString(item, ["rationale", "reason", "description", "text"]),
            tradeoffs: normalizeStringList(item.tradeoffs)
          };
        })
        .filter(Boolean)
    : value.decisions;

  const risks = Array.isArray(value.risks)
    ? value.risks
        .map((item) => {
          if (!isRecord(item)) return item;
          return {
            ...item,
            risk: typeof item.risk === "string" ? item.risk.trim() : readFirstString(item, ["risk", "title", "description"]),
            mitigation:
              typeof item.mitigation === "string"
                ? item.mitigation.trim()
                : readFirstString(item, ["mitigation", "plan", "countermeasure", "description"])
          };
        })
        .filter(Boolean)
    : value.risks;

  return {
    ...value,
    overview,
    modules,
    decisions,
    risks
  };
};

const applyArchitectureDefaults = (value: unknown, input: ArchitectInput): unknown => {
  const source = isRecord(value) ? value : {};
  const fallbackFiles = ["playground/architecture-smoke.md"];

  const overview =
    typeof source.overview === "string" && source.overview.trim()
      ? source.overview.trim()
      : `Architecture for ${input.plan.topic}`;

  const modulesFromModel = Array.isArray(source.modules)
    ? source.modules
        .map((item, index) => {
          if (!isRecord(item)) return undefined;
          const files = normalizeStringList(item.files);
          return {
            name:
              typeof item.name === "string" && item.name.trim()
                ? item.name.trim()
                : `module-${index + 1}`,
            responsibility:
              typeof item.responsibility === "string" && item.responsibility.trim()
                ? item.responsibility.trim()
                : `Support ${input.plan.topic}`,
            files: files.length > 0 ? files : fallbackFiles
          };
        })
        .filter((item): item is { name: string; responsibility: string; files: string[] } => Boolean(item))
    : [];

  const modules =
    modulesFromModel.length > 0
      ? modulesFromModel
      : input.plan.requirements.slice(0, 3).map((requirement, index) => ({
          name: requirement.id || `module-${index + 1}`,
          responsibility: requirement.description || `Support ${input.plan.topic}`,
          files: fallbackFiles
        }));

  const decisionsFromModel = Array.isArray(source.decisions)
    ? source.decisions
        .map((item, index) => {
          if (!isRecord(item)) return undefined;
          const tradeoffs = normalizeStringList(item.tradeoffs);
          const title =
            typeof item.title === "string" && item.title.trim()
              ? item.title.trim()
              : `Decision ${index + 1}`;
          return {
            title,
            rationale:
              typeof item.rationale === "string" && item.rationale.trim()
                ? item.rationale.trim()
                : `Chosen to support ${input.plan.topic}.`,
            tradeoffs: tradeoffs.length > 0 ? tradeoffs : [`Tradeoff for ${title}`]
          };
        })
        .filter((item): item is { title: string; rationale: string; tradeoffs: string[] } => Boolean(item))
    : [];

  const decisions =
    decisionsFromModel.length > 0
      ? decisionsFromModel
      : input.plan.goals.slice(0, 2).map((goal, index) => ({
          title: `Decision ${index + 1}`,
          rationale: goal,
          tradeoffs: ["Increased delivery complexity"]
        }));

  const risksFromModel = Array.isArray(source.risks)
    ? source.risks
        .map((item, index) => {
          if (!isRecord(item)) return undefined;
          const mitigation =
            typeof item.mitigation === "string" && item.mitigation.trim()
              ? item.mitigation.trim()
              : "Mitigate with incremental validation and rollback-ready changes.";
          const rawRisk = typeof item.risk === "string" ? item.risk.trim() : "";
          const risk = rawRisk || `Risk ${index + 1}`;
          return { risk, mitigation };
        })
        .filter((item): item is { risk: string; mitigation: string } => Boolean(item))
    : [];

  const risks =
    risksFromModel.length > 0
      ? risksFromModel
      : [
          {
            risk: "Requirement drift during implementation",
            mitigation: "Track assumptions and validate changes each iteration."
          }
        ];

  return {
    ...source,
    overview,
    modules,
    decisions,
    risks
  };
};

export class ArchitectAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly idFactory: () => string = () => randomUUID(),
    private readonly onPrompt?: (trace: ArchitectPromptTrace) => void
  ) {}

  async createArchitecture(input: ArchitectInput): Promise<ArchitectureArtifact> {
    const system = [
      "You are an architecture agent for software delivery.",
      "Return JSON only.",
      "Keys required: overview, modules, decisions, risks.",
      "modules items: name, responsibility, files.",
      "decisions items: title, rationale, tradeoffs.",
      "overview must be a plain string and tradeoffs must be an array of strings."
    ].join(" ");

    const user = [
      `Plan topic:\n${input.plan.topic}`,
      `Plan goals:\n${input.plan.goals.join("\n")}`,
      `Plan requirements:\n${JSON.stringify(input.plan.requirements, null, 2)}`,
      "Create architecture decisions and modules aligned with the plan."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "architect",
      phase: "architecture",
      system,
      user
    });

    let normalized: unknown;
    try {
      const raw = await withTimeout(this.llm.completeJsonObject(system, user), 70000, "architect llm call");
      const parsed = JSON.parse(extractJsonObject(raw));
      normalized = normalizeArchitectureDraft(parsed);
    } catch {
      normalized = {};
    }

    const draft = architectureDraftSchema.parse(applyArchitectureDefaults(normalized, input));

    return {
      id: this.idFactory(),
      sessionId: input.sessionId,
      phase: "architecture",
      ...draft,
      createdAt: new Date().toISOString()
    };
  }
}
