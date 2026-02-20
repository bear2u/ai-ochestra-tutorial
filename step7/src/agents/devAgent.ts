import { z } from "zod";
import { DevOutput } from "../types";
import { extractJsonObject } from "../utils/json";

const changeSchema = z
  .object({
    path: z.string().min(1),
    patch: z.string().optional(),
    fallbackContent: z.string().optional(),
    content: z.string().optional()
  })
  .transform((value) => ({
    ...value,
    fallbackContent: value.fallbackContent ?? value.content
  }))
  .refine((value) => Boolean(value.patch || value.fallbackContent), {
    message: "Each change must include patch or fallbackContent/content."
  });

const devSchema = z.object({
  rationale: z.string().min(1),
  changes: z.array(changeSchema).min(1),
  commands: z.array(z.string().min(1)).optional()
});

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

export interface DevPromptTrace {
  sessionId: string;
  role: "dev";
  phase: "implementation";
  system: string;
  user: string;
  iteration?: number;
}

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export class DevAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly onPrompt?: (trace: DevPromptTrace) => void
  ) {}

  async propose(params: {
    sessionId: string;
    iteration?: number;
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<DevOutput> {
    const system = [
      "You are the dev agent in a supervised coding loop.",
      "Return only JSON object with keys: rationale, changes, commands(optional).",
      "changes must be an array of { path, patch, fallbackContent }.",
      "commands must be an array of safe npm/pnpm command strings when setup/install/build actions are needed.",
      "patch must be a unified diff that transforms current file content.",
      "fallbackContent must contain complete file content if patch cannot be applied.",
      "Prefer patch + fallbackContent together for each change.",
      "Do not return markdown."
    ].join(" ");

    const fileBundle = Object.entries(params.files)
      .map(([filePath, content]) => `FILE: ${filePath}\n${content || "<EMPTY>"}`)
      .join("\n\n");

    const user = [
      `Task:\n${params.task}`,
      `Previous test feedback:\n${params.feedback || "(none)"}`,
      `Current files:\n${fileBundle}`,
      "If project setup commands are required (e.g. package install), include them in commands[] without shell operators.",
      "Produce minimal, correct file updates in patch-first format."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: params.sessionId,
      role: "dev",
      phase: "implementation",
      system,
      user,
      iteration: params.iteration
    });

    try {
      const raw = await withTimeout(this.llm.completeJsonObject(system, user), 60000, "dev llm call");
      const parsed = JSON.parse(extractJsonObject(raw));
      const strict = devSchema.safeParse(parsed);
      if (strict.success) {
        return strict.data;
      }
    } catch {
      // fall through to deterministic fallback below
    }

    const [fallbackPath, fallbackContent] = Object.entries(params.files)[0] ?? ["tmp_orch_smoke.txt", ""];
    return {
      rationale: "Fallback no-op change generated because dev LLM output was unavailable or invalid.",
      changes: [
        {
          path: fallbackPath,
          fallbackContent
        }
      ]
    };
  }
}
