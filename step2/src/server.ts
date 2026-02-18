import { assertConfig, config } from "./config";
import { DevAgent } from "./agents/devAgent";
import { TestAgent } from "./agents/testAgent";
import { OpenAiClient } from "./llm/openaiClient";
import { Supervisor } from "./orchestrator/supervisor";
import { CommandRunner } from "./services/commandRunner";
import { SessionStore } from "./services/sessionStore";
import { WorkspaceService } from "./services/workspace";
import { buildApp } from "./serverApp";

const store = new SessionStore();
const workspace = new WorkspaceService();
const llm = new OpenAiClient();
const commandRunner = new CommandRunner();
const supervisor = new Supervisor(store, workspace, new DevAgent(llm), new TestAgent(llm), commandRunner);

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
