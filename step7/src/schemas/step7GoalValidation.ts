import { z } from "zod";

export const goalValidationCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().min(1),
  expected: z.string().min(1).optional(),
  actual: z.string().min(1).optional()
});

export const goalValidationArtifactDraftSchema = z.object({
  iteration: z.number().int().min(1),
  passed: z.boolean(),
  summary: z.string().min(1),
  checks: z.array(goalValidationCheckSchema).min(1),
  missingTargets: z.array(z.string().min(1)),
  suggestions: z.array(z.string().min(1))
});

export type GoalValidationArtifactDraft = z.infer<typeof goalValidationArtifactDraftSchema>;
