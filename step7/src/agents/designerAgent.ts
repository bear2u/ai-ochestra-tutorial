import { randomUUID } from "node:crypto";
import { designDraftSchema } from "../schemas/step3Artifacts";
import { ArchitectureArtifact, DesignArtifact, PlanArtifact } from "../types";
import { extractJsonObject } from "../utils/json";

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export interface DesignerInput {
  sessionId: string;
  plan: PlanArtifact;
  architecture: ArchitectureArtifact;
}

export interface DesignerPromptTrace {
  sessionId: string;
  role: "designer";
  phase: "design";
  system: string;
  user: string;
}

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
  if (isRecord(value)) {
    const single = readFirstString(value, ["title", "description", "text", "name", "value", "step", "idea", "note"]);
    return single ? [single] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isRecord(item)) return "";
      return readFirstString(item, ["title", "description", "text", "name", "value", "step", "idea", "note"]);
    })
    .filter((item): item is string => item.length > 0);
};

const normalizeApiField = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!isRecord(value)) {
    return "";
  }
  return readFirstString(value, ["schema", "type", "description", "text", "value", "name"]);
};

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

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];

const hasRecoverableSignal = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys: Array<keyof typeof value> = ["components", "apis", "dataModels", "implementationChecklist", "testIdeas"];
  return keys.some((key) => Array.isArray(value[key]) && value[key].length > 0);
};

const buildFallbackDesignDraft = (normalized: unknown, input: DesignerInput): unknown => {
  const source = isRecord(normalized) ? normalized : {};
  const flatFiles = input.architecture.modules.flatMap((module) => module.files).filter(Boolean);
  const defaultFiles = flatFiles.length > 0 ? Array.from(new Set(flatFiles)).slice(0, 3) : ["playground/design-smoke.md"];

  const componentsFromModel = asRecordArray(source.components)
    .map((item, index) => ({
      name: readFirstString(item, ["name", "component", "title"]) || `Component${index + 1}`,
      purpose: readFirstString(item, ["purpose", "scope", "description", "text"]) || `Support ${input.plan.topic}`,
      files: normalizeStringList(item.files).length > 0 ? normalizeStringList(item.files) : defaultFiles
    }))
    .filter((item) => item.name && item.purpose && item.files.length > 0);

  const components =
    componentsFromModel.length > 0
      ? componentsFromModel
      : input.architecture.modules.slice(0, 2).map((module, index) => ({
          name: module.name || `Component${index + 1}`,
          purpose: module.responsibility || `Support ${input.plan.topic}`,
          files: module.files.length > 0 ? module.files.slice(0, 3) : defaultFiles
        }));

  const apisFromModel = asRecordArray(source.apis)
    .map((item, index) => ({
      name: readFirstString(item, ["name", "api", "title"]) || `api${index + 1}`,
      input: normalizeApiField(item.input) || "request: unknown",
      output: normalizeApiField(item.output) || "response: unknown",
      errors: normalizeStringList(item.errors)
    }))
    .map((item) => ({
      ...item,
      errors: item.errors.length > 0 ? item.errors : ["unknown_error"]
    }))
    .filter((item) => item.name && item.input && item.output);

  const apis =
    apisFromModel.length > 0
      ? apisFromModel
      : [
          {
            name: "runPreloopSmoke",
            input: "task:string",
            output: "result:SmokeResult",
            errors: ["validation_failed"]
          }
        ];

  const dataModelsFromModel = asRecordArray(source.dataModels)
    .map((item, index) => ({
      name: readFirstString(item, ["name", "model", "title"]) || `DataModel${index + 1}`,
      fields: normalizeStringList(item.fields)
    }))
    .map((item) => ({
      ...item,
      fields: item.fields.length > 0 ? item.fields : ["value:string"]
    }))
    .filter((item) => item.name && item.fields.length > 0);

  const dataModels =
    dataModelsFromModel.length > 0
      ? dataModelsFromModel
      : [
          {
            name: "SmokeResult",
            fields: ["status:string", "summary:string"]
          }
        ];

  const implementationChecklist = normalizeStringList(source.implementationChecklist);
  const testIdeas = normalizeStringList(source.testIdeas);

  return {
    components: components.length > 0 ? components : [{ name: "CoreComponent", purpose: `Support ${input.plan.topic}`, files: defaultFiles }],
    apis,
    dataModels,
    implementationChecklist:
      implementationChecklist.length > 0 ? implementationChecklist : input.plan.doneCriteria.slice(0, 4).filter(Boolean),
    testIdeas: testIdeas.length > 0 ? testIdeas : input.plan.goals.slice(0, 4).filter(Boolean)
  };
};

const normalizeDesignDraft = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  const components = Array.isArray(value.components)
    ? value.components
        .map((item) => {
          if (!isRecord(item)) return item;
          return {
            ...item,
            name: typeof item.name === "string" ? item.name.trim() : readFirstString(item, ["name", "component", "title"]),
            purpose:
              typeof item.purpose === "string"
                ? item.purpose.trim()
                : readFirstString(item, ["purpose", "scope", "description", "text"]),
            files: normalizeStringList(item.files)
          };
        })
        .filter(Boolean)
    : value.components;

  const apis = Array.isArray(value.apis)
    ? value.apis
        .map((item) => {
          if (!isRecord(item)) return item;
          return {
            ...item,
            name: typeof item.name === "string" ? item.name.trim() : readFirstString(item, ["name", "api", "title"]),
            input: normalizeApiField(item.input),
            output: normalizeApiField(item.output),
            errors: normalizeStringList(item.errors)
          };
        })
        .filter(Boolean)
    : value.apis;

  const dataModels = Array.isArray(value.dataModels)
    ? value.dataModels
        .map((item) => {
          if (!isRecord(item)) return item;
          return {
            ...item,
            name: typeof item.name === "string" ? item.name.trim() : readFirstString(item, ["name", "model", "title"]),
            fields: normalizeStringList(item.fields)
          };
        })
        .filter(Boolean)
    : value.dataModels;

  return {
    ...value,
    components,
    apis,
    dataModels,
    implementationChecklist: normalizeStringList(value.implementationChecklist),
    testIdeas: normalizeStringList(value.testIdeas)
  };
};

export class DesignerAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly idFactory: () => string = () => randomUUID(),
    private readonly onPrompt?: (trace: DesignerPromptTrace) => void
  ) {}

  async createDesign(input: DesignerInput): Promise<DesignArtifact> {
    const compactModules = input.architecture.modules.slice(0, 4).map((module) => ({
      name: module.name,
      responsibility: module.responsibility.slice(0, 180),
      files: module.files.slice(0, 4)
    }));
    const moduleOverflow =
      input.architecture.modules.length > compactModules.length
        ? `...and ${input.architecture.modules.length - compactModules.length} more module(s).`
        : "No additional modules.";

    const system = [
      "You are a design agent for implementation planning.",
      "Return JSON only.",
      "Keys required: components, apis, dataModels, implementationChecklist, testIdeas.",
      "Use concise outputs with practical scope.",
      "Prefer 1-4 components and 1-4 APIs grounded in provided files.",
      "components items must include name, purpose, files(string[]).",
      "apis items must include name, input(string), output(string), errors(string[]).",
      "dataModels items must include name and fields(string[]).",
      "implementationChecklist and testIdeas must be string arrays."
    ].join(" ");

    const user = [
      `Plan topic:\n${input.plan.topic}`,
      `Architecture overview:\n${input.architecture.overview}`,
      `Architecture modules (compact):\n${JSON.stringify(compactModules, null, 2)}`,
      `Module overflow note:\n${moduleOverflow}`,
      "Create a detailed implementation design artifact."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "designer",
      phase: "design",
      system,
      user
    });

    let normalized: unknown;
    try {
      const raw = await withTimeout(this.llm.completeJsonObject(system, user), 70000, "designer llm call");
      const parsed = JSON.parse(extractJsonObject(raw));
      normalized = normalizeDesignDraft(parsed);
    } catch {
      normalized = {};
    }

    const strict = designDraftSchema.safeParse(normalized);
    if (!strict.success) {
      const repaired = buildFallbackDesignDraft(normalized, input);
      const repairedParsed = designDraftSchema.safeParse(repaired);
      if (!repairedParsed.success) {
        if (!hasRecoverableSignal(normalized)) {
          throw strict.error;
        }
        throw repairedParsed.error;
      }
      return {
        id: this.idFactory(),
        sessionId: input.sessionId,
        phase: "design",
        ...repairedParsed.data,
        createdAt: new Date().toISOString()
      };
    }

    const draft = strict.data;

    return {
      id: this.idFactory(),
      sessionId: input.sessionId,
      phase: "design",
      ...draft,
      createdAt: new Date().toISOString()
    };
  }
}
