import { describe, expect, it } from "vitest";
import { SessionStore } from "../../src/services/sessionStore";

describe("SessionStore", () => {
  it("updates artifact refs per phase", () => {
    const store = new SessionStore();
    const session = store.create({
      task: "task",
      filePaths: ["src/a.ts"],
      testCommand: "pnpm test",
      maxAttempts: 3
    });

    store.setArtifactRef(session.id, "planning", "plan-1");
    store.setArtifactRef(session.id, "architecture", "arch-1");
    store.setArtifactRef(session.id, "design", "design-1");

    const updated = store.get(session.id);
    expect(updated?.artifactRefs).toEqual({
      planning: "plan-1",
      architecture: "arch-1",
      design: "design-1"
    });
  });

  it("stores optional artifactId on events", () => {
    const store = new SessionStore();
    const session = store.create({
      task: "task",
      filePaths: ["src/a.ts"],
      testCommand: "pnpm test",
      maxAttempts: 3
    });

    store.pushEvent(session.id, "planner", "artifact_created", "Plan created", {
      phase: "planning",
      artifactId: "plan-1",
      data: { sample: true }
    });

    const events = store.getEvents(session.id);
    expect(events).toHaveLength(1);
    expect(events[0].artifactId).toBe("plan-1");
    expect(events[0].phase).toBe("planning");
  });
});
