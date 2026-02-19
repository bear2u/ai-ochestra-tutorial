import { z } from "zod";

export const reviewIssueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1)
});

export const reviewArtifactDraftSchema = z.object({
  iteration: z.number().int().min(1),
  blockingIssues: z.array(reviewIssueSchema),
  nonBlockingIssues: z.array(reviewIssueSchema),
  score: z.number().int().min(0).max(100),
  fixPlan: z.array(z.string().min(1))
});

export type ReviewArtifactDraft = z.infer<typeof reviewArtifactDraftSchema>;
