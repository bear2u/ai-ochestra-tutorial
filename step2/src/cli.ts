import { assertConfig } from "./config";
import { DevAgent } from "./agents/devAgent";
import { TestAgent } from "./agents/testAgent";
import { OpenAiClient } from "./llm/openaiClient";
import { Supervisor } from "./orchestrator/supervisor";
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
  const testCommand = getArgValue("test");
  const maxAttemptsRaw = getArgValue("max-attempts");

  if (!task || !filesRaw || !testCommand) {
    console.error("Usage: pnpm cli -- --task \"...\" --files \"src/a.ts,src/b.ts\" --test \"pnpm test\" [--max-attempts 3]");
    process.exit(1);
  }

  const filePaths = filesRaw.split(",").map((item) => item.trim()).filter(Boolean);
  const maxAttempts = Number.parseInt(maxAttemptsRaw ?? "3", 10);

  const store = new SessionStore();
  const supervisor = new Supervisor(
    store,
    new WorkspaceService(),
    new DevAgent(new OpenAiClient()),
    new TestAgent(new OpenAiClient()),
    new CommandRunner()
  );

  const sessionId = await supervisor.start({
    task,
    filePaths,
    testCommand,
    maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 3
  });

  console.log(`Session started: ${sessionId}`);

  const printEvent = (event: SessionEvent): void => {
    const phaseText = event.phase ? ` [${event.phase}${typeof event.iteration === "number" ? `#${event.iteration}` : ""}]` : "";
    console.log(`[${event.timestamp}] [${event.role}]${phaseText} ${event.type}: ${event.message}`);
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
