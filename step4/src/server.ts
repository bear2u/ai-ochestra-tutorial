import { assertConfig, config } from "./config";
import { ArchitectAgent } from "./agents/architectAgent";
import { DevAgent } from "./agents/devAgent";
import { DesignerAgent } from "./agents/designerAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { TestAgent } from "./agents/testAgent";
import { OpenAiClient } from "./llm/openaiClient";
import { Supervisor } from "./orchestrator/supervisor";
import { ArtifactStore } from "./services/artifactStore";
import { CommandRunner } from "./services/commandRunner";
import { SessionStore } from "./services/sessionStore";
import { WorkspaceService } from "./services/workspace";
import { buildApp } from "./serverApp";

const store = new SessionStore();
const artifacts = new ArtifactStore();
const workspace = new WorkspaceService();
const llm = new OpenAiClient();
const commandRunner = new CommandRunner();
const logPrompt = (entry: {
  sessionId: string;
  role: "planner" | "architect" | "designer" | "dev" | "test";
  phase: "planning" | "architecture" | "design" | "implementation" | "validation";
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
  workspace,
  new PlannerAgent(llm, undefined, logPrompt),
  new ArchitectAgent(llm, undefined, logPrompt),
  new DesignerAgent(llm, undefined, logPrompt),
  new DevAgent(llm, logPrompt),
  new TestAgent(llm, logPrompt),
  commandRunner
);

const app = buildApp({
  store,
  supervisor,
  llm,
  commandRunner
});

const start = async (): Promise<void> => {
  assertConfig();
  await app.listen({ port: config.port, host: "0.0.0.0" });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
