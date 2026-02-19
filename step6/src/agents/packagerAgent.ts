import { prPackageDraftSchema } from "../schemas/step6Artifacts";
import { PrPackageArtifact } from "../types";
import { extractJsonObject } from "../utils/json";

interface JsonLlmLike {
  completeJsonObject(system: string, user: string): Promise<string>;
}

export interface PackagerInput {
  sessionId: string;
  iteration: number;
  topic: string;
  changedFiles: string[];
  testSummary: string;
  reviewSummary: string;
  riskNotes: string[];
  advisorNotes: string[];
  timeline: string[];
}

export type PackagerDraftOutput = Omit<PrPackageArtifact, "id" | "sessionId" | "phase" | "outputPath" | "createdAt">;

export interface PackagerPromptTrace {
  sessionId: string;
  role: "packager";
  phase: "packaging";
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

const dedupeStrings = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

const buildFallback = (input: PackagerInput): PackagerDraftOutput => {
  const changedFiles = dedupeStrings(input.changedFiles.length > 0 ? input.changedFiles : ["(unknown)"]);
  const riskNotes = dedupeStrings(input.riskNotes);
  const advisorNotes = dedupeStrings(input.advisorNotes);
  const bodyLines = [
    "## Summary",
    `- Topic: ${input.topic}`,
    `- Iteration: ${input.iteration}`,
    "",
    "## Validation",
    input.testSummary,
    "",
    "## Review",
    input.reviewSummary,
    "",
    "## Changed Files",
    ...changedFiles.map((filePath) => `- ${filePath}`)
  ];

  if (riskNotes.length > 0) {
    bodyLines.push("", "## Risk Notes", ...riskNotes.map((note) => `- ${note}`));
  }

  if (advisorNotes.length > 0) {
    bodyLines.push("", "## Advisory Notes", ...advisorNotes.map((note) => `- ${note}`));
  }

  return {
    iteration: input.iteration,
    topic: input.topic,
    title: `chore: package ${input.topic}`,
    body: bodyLines.join("\n"),
    changedFiles,
    testSummary: input.testSummary,
    reviewSummary: input.reviewSummary,
    riskNotes,
    advisorNotes
  };
};

export class PackagerAgent {
  constructor(
    private readonly llm: JsonLlmLike,
    private readonly onPrompt?: (trace: PackagerPromptTrace) => void
  ) {}

  async createPrPackage(input: PackagerInput): Promise<PackagerDraftOutput> {
    const system = [
      "You are a release packager agent.",
      "Return JSON only.",
      "Required keys: title, body, changedFiles, testSummary, reviewSummary, riskNotes, advisorNotes.",
      "title and body must be non-empty strings.",
      "changedFiles/riskNotes/advisorNotes must be arrays of strings."
    ].join(" ");

    const user = [
      `Topic:\n${input.topic}`,
      `Iteration: ${input.iteration}`,
      `Changed files:\n${input.changedFiles.join("\n") || "(none)"}`,
      `Validation summary:\n${input.testSummary}`,
      `Review summary:\n${input.reviewSummary}`,
      `Risk notes:\n${input.riskNotes.join("\n") || "(none)"}`,
      `Advisor notes:\n${input.advisorNotes.join("\n") || "(none)"}`,
      `Timeline:\n${input.timeline.join("\n") || "(none)"}`,
      "Produce a concise PR package draft."
    ].join("\n\n");

    this.onPrompt?.({
      sessionId: input.sessionId,
      role: "packager",
      phase: "packaging",
      system,
      user,
      iteration: input.iteration
    });

    try {
      const raw = await withTimeout(this.llm.completeJsonObject(system, user), 45000, "packager llm call");
      const parsed = JSON.parse(extractJsonObject(raw));

      const fallback = buildFallback(input);
      const strict = prPackageDraftSchema.parse({
        iteration: input.iteration,
        topic: input.topic,
        title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
        body: typeof parsed?.body === "string" && parsed.body.trim() ? parsed.body.trim() : fallback.body,
        changedFiles: Array.isArray(parsed?.changedFiles)
          ? dedupeStrings(parsed.changedFiles.filter((item: unknown) => typeof item === "string"))
          : fallback.changedFiles,
        testSummary:
          typeof parsed?.testSummary === "string" && parsed.testSummary.trim() ? parsed.testSummary.trim() : fallback.testSummary,
        reviewSummary:
          typeof parsed?.reviewSummary === "string" && parsed.reviewSummary.trim()
            ? parsed.reviewSummary.trim()
            : fallback.reviewSummary,
        riskNotes: Array.isArray(parsed?.riskNotes)
          ? dedupeStrings(parsed.riskNotes.filter((item: unknown) => typeof item === "string"))
          : fallback.riskNotes,
        advisorNotes: Array.isArray(parsed?.advisorNotes)
          ? dedupeStrings(parsed.advisorNotes.filter((item: unknown) => typeof item === "string"))
          : fallback.advisorNotes
      });

      return strict;
    } catch {
      return buildFallback(input);
    }
  }
}
