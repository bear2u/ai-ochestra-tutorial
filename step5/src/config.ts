import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const defaultWorkspaceRoot = path.resolve(__dirname, "..");

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: toInt(process.env.PORT, 3000),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "http://localhost:8000/v1",
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT ?? defaultWorkspaceRoot),
  maxCommandOutputChars: toInt(process.env.MAX_COMMAND_OUTPUT_CHARS, 12000),
  maxCommandRuntimeMs: toInt(process.env.MAX_COMMAND_RUNTIME_MS, 15000)
};

export const assertConfig = (): void => {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required. Add it to .env or shell env.");
  }
};
