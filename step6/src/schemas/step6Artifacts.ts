import { z } from "zod";

const nonEmptyStringArray = z.array(z.string().min(1)).min(1);

export const supervisorAdviceDraftSchema = z.object({
  iteration: z.number().int().min(1),
  focusSummary: z.string().min(1),
  feedbackPatch: z.array(z.string().min(1)),
  riskNotes: z.array(z.string().min(1)),
  recommendedAction: z.enum(["continue", "rework", "approve"]),
  confidence: z.number().min(0).max(1)
});

export const prPackageDraftSchema = z.object({
  iteration: z.number().int().min(1),
  topic: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  changedFiles: nonEmptyStringArray,
  testSummary: z.string().min(1),
  reviewSummary: z.string().min(1),
  riskNotes: z.array(z.string().min(1)),
  advisorNotes: z.array(z.string().min(1))
});

export type SupervisorAdviceDraft = z.infer<typeof supervisorAdviceDraftSchema>;
export type PrPackageDraft = z.infer<typeof prPackageDraftSchema>;
