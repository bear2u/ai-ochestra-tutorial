import { describe, expect, it } from "vitest";
import { SessionStore } from "../../src/services/sessionStore";

describe("SessionStore", () => {
  it("updates artifact refs per phase", () => {
    const store = new SessionStore();
    const session = store.create({
      topic: "task",
      task: "task",
      autonomous: true,
      filePaths: ["src/a.ts"],
      testCommand: "pnpm test",
      maxAttempts: 3
    });

    store.setArtifactRef(session.id, "planning", "plan-1");
    store.setArtifactRef(session.id, "architecture", "arch-1");
    store.setArtifactRef(session.id, "design", "design-1");
    store.setArtifactRef(session.id, "goal_validation", "goal-2");
    store.setArtifactRef(session.id, "validation", "validation-2");
    store.setArtifactRef(session.id, "review", "review-2");
    store.setArtifactRef(session.id, "packaging", "pkg-1");

    const updated = store.get(session.id);
    expect(updated?.artifactRefs).toEqual({
      planning: "plan-1",
      architecture: "arch-1",
      design: "design-1",
      goal_validation: "goal-2",
      validation: "validation-2",
      review: "review-2",
      packaging: "pkg-1"
    });
  });

  it("stores optional artifactId on events", () => {
    const store = new SessionStore();
    const session = store.create({
      topic: "task",
      task: "task",
      autonomous: true,
      filePaths: ["src/a.ts"],
      testCommand: "pnpm test",
      maxAttempts: 3
    });

    store.pushEvent(session.id, "planner", "artifact_created", "Plan created", {
      phase: "planning",
      artifactId: "plan-1",
      classification: "unknown",
      data: { sample: true }
    });

    const events = store.getEvents(session.id);
    expect(events).toHaveLength(1);
    expect(events[0].artifactId).toBe("plan-1");
    expect(events[0].phase).toBe("planning");
    expect(events[0].classification).toBe("unknown");
  });

  it("stores budget snapshot updates", () => {
    const store = new SessionStore();
    const session = store.create({
      topic: "task",
      task: "task",
      autonomous: true,
      filePaths: ["src/a.ts"],
      testCommand: "pnpm test",
      maxIterations: 4,
      maxMinutes: 30
    });

    store.updateBudget(session.id, {
      maxIterations: 4,
      maxMinutes: 30,
      startedAt: session.startedAt,
      deadlineAt: new Date(new Date(session.startedAt).getTime() + 30 * 60_000).toISOString(),
      elapsedMs: 5000,
      remainingIterations: 3
    });

    expect(store.get(session.id)?.budget?.remainingIterations).toBe(3);
  });
});
