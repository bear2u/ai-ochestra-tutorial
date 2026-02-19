import { z } from "zod";

export const failureClassificationSchema = z.enum(["lint", "type", "test", "runtime", "unknown"]);
export const validationStageSchema = z.enum(["lint", "type", "test", "custom"]);

export const validationStepSchema = z.object({
  stage: validationStageSchema,
  command: z.string().min(1),
  passed: z.boolean(),
  exitCode: z.number().int(),
  output: z.string(),
  summary: z.string().min(1),
  durationMs: z.number().int().min(0),
  classification: failureClassificationSchema.optional()
});

export const validationArtifactDraftSchema = z.object({
  iteration: z.number().int().min(1),
  passed: z.boolean(),
  summary: z.string().min(1),
  classification: failureClassificationSchema.optional(),
  steps: z.array(validationStepSchema).min(1)
});

export type ValidationArtifactDraft = z.infer<typeof validationArtifactDraftSchema>;
