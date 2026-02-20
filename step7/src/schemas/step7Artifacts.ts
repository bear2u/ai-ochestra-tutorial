import { z } from "zod";

export const discoveryCandidateSchema = z.object({
  path: z.string().min(1),
  score: z.number(),
  reasons: z.array(z.string())
});

export const discoveryArtifactSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  candidates: z.array(discoveryCandidateSchema),
  selectedFiles: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1),
  createdAt: z.string().min(1)
});

export const taskCardSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  phase: z.enum(["planning", "implementation", "validation", "review", "packaging"]),
  status: z.enum(["queued", "running", "review", "done", "blocked", "failed"]),
  assignee: z.enum(["coordinator", "worker", "supervisor", "dev", "test", "validator", "planner", "architect", "designer", "reviewer", "advisor", "packager", "discoverer"]),
  dependencies: z.array(z.string()),
  targetFiles: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  commands: z.array(z.string()),
  handoffRequired: z.boolean().optional(),
  retries: z.number().int().min(0),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const taskGraphSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  tasks: z.array(taskCardSchema).min(1),
  edges: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1)
    })
  ),
  createdAt: z.string().min(1)
});
