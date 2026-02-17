import { z } from "zod";
import { OpenAiClient } from "../llm/openaiClient";
import { DevOutput } from "../types";
import { extractJsonObject } from "../utils/json";

const devSchema = z.object({
  rationale: z.string().min(1),
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string()
      })
    )
    .min(1)
});

export class DevAgent {
  constructor(private readonly llm: OpenAiClient) {}

  async propose(params: {
    task: string;
    files: Record<string, string>;
    feedback: string;
  }): Promise<DevOutput> {
    const system = [
      "You are the dev agent in a supervised coding loop.",
      "Return only JSON object with keys: rationale, changes.",
      "changes must be an array of { path, content } with full file content.",
      "Do not return markdown."
    ].join(" ");

    const fileBundle = Object.entries(params.files)
      .map(([filePath, content]) => `FILE: ${filePath}\n${content || "<EMPTY>"}`)
      .join("\n\n");

    const user = [
      `Task:\n${params.task}`,
      `Previous test feedback:\n${params.feedback || "(none)"}`,
      `Current files:\n${fileBundle}`,
      "Produce minimal, correct file updates."
    ].join("\n\n");

    const raw = await this.llm.completeJsonObject(system, user);
    const parsed = JSON.parse(extractJsonObject(raw));
    return devSchema.parse(parsed);
  }
}
