import { z } from "zod";

const nonEmptyStringArray = z.array(z.string().min(1)).min(1);

export const planDraftSchema = z.object({
  goals: nonEmptyStringArray,
  requirements: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        priority: z.enum(["must", "should", "could"])
      })
    )
    .min(1),
  constraints: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  doneCriteria: nonEmptyStringArray
});

export const architectureDraftSchema = z.object({
  overview: z.string().min(1),
  modules: z
    .array(
      z.object({
        name: z.string().min(1),
        responsibility: z.string().min(1),
        files: nonEmptyStringArray
      })
    )
    .min(1),
  decisions: z
    .array(
      z.object({
        title: z.string().min(1),
        rationale: z.string().min(1),
        tradeoffs: nonEmptyStringArray
      })
    )
    .min(1),
  risks: z
    .array(
      z.object({
        risk: z.string().min(1),
        mitigation: z.string().min(1)
      })
    )
    .min(1)
});

export const designDraftSchema = z.object({
  components: z
    .array(
      z.object({
        name: z.string().min(1),
        purpose: z.string().min(1),
        files: nonEmptyStringArray
      })
    )
    .min(1),
  apis: z
    .array(
      z.object({
        name: z.string().min(1),
        input: z.string().min(1),
        output: z.string().min(1),
        errors: z.array(z.string().min(1)).default([])
      })
    )
    .min(1),
  dataModels: z
    .array(
      z.object({
        name: z.string().min(1),
        fields: nonEmptyStringArray
      })
    )
    .min(1),
  implementationChecklist: nonEmptyStringArray,
  testIdeas: nonEmptyStringArray
});

export type PlanDraft = z.infer<typeof planDraftSchema>;
export type ArchitectureDraft = z.infer<typeof architectureDraftSchema>;
export type DesignDraft = z.infer<typeof designDraftSchema>;
