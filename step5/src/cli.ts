import { assertConfig } from "./config";
import { ArchitectAgent } from "./agents/architectAgent";
import { DevAgent } from "./agents/devAgent";
import { DesignerAgent } from "./agents/designerAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { ReviewerAgent } from "./agents/reviewerAgent";
import { TestAgent } from "./agents/testAgent";
import { OpenAiClient } from "./llm/openaiClient";
import { Supervisor } from "./orchestrator/supervisor";
import { ArtifactStore } from "./services/artifactStore";
import { CommandRunner } from "./services/commandRunner";
import { SessionStore } from "./services/sessionStore";
import { WorkspaceService } from "./services/workspace";
import { SessionEvent } from "./types";

const getArgValue = (name: string): string | undefined => {
  const marker = `--${name}`;
  const index = process.argv.findIndex((arg) => arg === marker);
  if (index === -1) return undefined;
  return process.argv[index + 1];
};

const main = async (): Promise<void> => {
  assertConfig();

  const task = getArgValue("task");
  const filesRaw = getArgValue("files");
  const testCommand = getArgValue("test")?.trim();
  const validationCommandsRaw = getArgValue("validation-commands");
  const maxIterationsRaw = getArgValue("max-iterations");
  const maxMinutesRaw = getArgValue("max-minutes");
  const maxAttemptsRaw = getArgValue("max-attempts");

  if (!task || !filesRaw || (!testCommand && !validationCommandsRaw)) {
    console.error(
      "Usage: pnpm cli -- --task \"...\" --files \"src/a.ts,src/b.ts\" [--test \"pnpm test\"] [--validation-commands \"pnpm lint,pnpm typecheck,pnpm test\"] [--max-iterations 6] [--max-minutes 45] [--max-attempts 3]"
    );
    process.exit(1);
  }

  const filePaths = filesRaw.split(",").map((item) => item.trim()).filter(Boolean);
  const validationCommands = validationCommandsRaw
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const maxIterations = Number.parseInt(maxIterationsRaw ?? "", 10);
  const maxMinutes = Number.parseInt(maxMinutesRaw ?? "", 10);
  const maxAttempts = Number.parseInt(maxAttemptsRaw ?? "3", 10);

  const store = new SessionStore();
  const artifacts = new ArtifactStore();
  const llm = new OpenAiClient();
  await llm.assertModelAvailable();
  const logPrompt = (entry: {
    sessionId: string;
    role: "planner" | "architect" | "designer" | "dev" | "test" | "reviewer";
    phase: "planning" | "architecture" | "design" | "implementation" | "validation" | "review";
    system: string;
    user: string;
    iteration?: number;
  }): void => {
    store.pushEvent(entry.sessionId, entry.role, "prompt_logged", `${entry.role} prompt captured.`, {
      phase: entry.phase,
      iteration: entry.iteration,
      data: {
        system: entry.system,
        user: entry.user
      }
    });
  };

  const supervisor = new Supervisor(
    store,
    artifacts,
    new WorkspaceService(),
    new PlannerAgent(llm, undefined, logPrompt),
    new ArchitectAgent(llm, undefined, logPrompt),
    new DesignerAgent(llm, undefined, logPrompt),
    new ReviewerAgent(llm, undefined, logPrompt),
    new DevAgent(llm, logPrompt),
    new TestAgent(llm, logPrompt),
    new CommandRunner()
  );

  const sessionId = await supervisor.start({
    task,
    filePaths,
    testCommand,
    validationCommands,
    maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 3,
    maxIterations: Number.isFinite(maxIterations) ? maxIterations : undefined,
    maxMinutes: Number.isFinite(maxMinutes) ? maxMinutes : undefined
  });

  console.log(`Session started: ${sessionId}`);

  const printEvent = (event: SessionEvent): void => {
    const phaseText = event.phase ? ` [${event.phase}${typeof event.iteration === "number" ? `#${event.iteration}` : ""}]` : "";
    const artifactText = event.artifactId ? ` [artifact ${event.artifactId}]` : "";
    console.log(`[${event.timestamp}] [${event.role}]${phaseText}${artifactText} ${event.type}: ${event.message}`);
    if (event.data?.summary && typeof event.data.summary === "string") {
      console.log(event.data.summary);
    }
  };

  const unsubscribe = store.subscribe(sessionId, printEvent);

  while (true) {
    const session = store.get(sessionId);
    if (!session) break;

    if (session.status === "success" || session.status === "failed") {
      unsubscribe();
      console.log(`\nFinal status: ${session.status}`);
      if (session.finalSummary) {
        console.log(session.finalSummary);
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
