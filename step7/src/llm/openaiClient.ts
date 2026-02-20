import OpenAI from "openai";
import { config } from "../config";

export class OpenAiClient {
  private readonly client: OpenAI;
  private modelValidationPromise?: Promise<void>;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl
    });
  }

  private static isNotFoundError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;

    const status = (error as { status?: number }).status;
    if (status === 404) return true;

    const message = error instanceof Error ? error.message : String(error);
    return /not found/i.test(message);
  }

  private static isModelUnknownError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /unknown model|invalid model|model .* does not exist|no such model|unsupported model|\"code\":\"1211\"/i.test(message);
  }

  private static isModelsListUnsupportedError(error: unknown): boolean {
    if (typeof error === "object" && error !== null) {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 405 || status === 501) {
        return true;
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return /models?.*(not found|unsupported)|unsupported.*models?/i.test(message);
  }

  private static toUnknownModelConfigError(error: unknown): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);
    return new Error(
      [
        `Configured OPENAI_MODEL \"${config.model}\" is not available on ${config.openaiBaseUrl}.`,
        "Set OPENAI_MODEL to a provider-supported model and restart.",
        `Original error: ${originalMessage}`
      ].join(" ")
    );
  }

  private static extractResponseText(response: unknown): string {
    const body = response as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };

    if (typeof body.output_text === "string" && body.output_text.trim()) {
      return body.output_text.trim();
    }

    const textChunks =
      body.output
        ?.flatMap((item) => item.content ?? [])
        .filter((item) => item.type === "output_text" && typeof item.text === "string")
        .map((item) => item.text!.trim())
        .filter(Boolean) ?? [];

    if (textChunks.length > 0) {
      return textChunks.join("\n");
    }

    throw new Error("LLM returned empty output.");
  }

  private async validateWithModelsList(): Promise<void> {
    const response = await this.client.models.list();
    const modelIds = (response.data ?? [])
      .map((item) => (typeof item.id === "string" ? item.id.trim() : ""))
      .filter(Boolean);

    if (modelIds.length === 0) {
      return;
    }

    if (modelIds.includes(config.model)) {
      return;
    }

    const sample = modelIds.slice(0, 8).join(", ");
    const hint = sample ? ` Available models (sample): ${sample}` : "";
    throw new Error(`Configured OPENAI_MODEL \"${config.model}\" is not in provider model list.${hint}`);
  }

  private async probeModelByRequest(): Promise<void> {
    try {
      await this.client.chat.completions.create({
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0
      });
      return;
    } catch (error: unknown) {
      if (OpenAiClient.isModelUnknownError(error)) {
        throw OpenAiClient.toUnknownModelConfigError(error);
      }
      if (!OpenAiClient.isNotFoundError(error)) {
        throw error;
      }
    }

    try {
      await this.client.responses.create({
        model: config.model,
        input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
        max_output_tokens: 1
      });
    } catch (error: unknown) {
      if (OpenAiClient.isModelUnknownError(error)) {
        throw OpenAiClient.toUnknownModelConfigError(error);
      }
      throw error;
    }
  }

  private async runModelValidation(): Promise<void> {
    try {
      await this.validateWithModelsList();
      return;
    } catch (error: unknown) {
      if (OpenAiClient.isModelUnknownError(error)) {
        throw OpenAiClient.toUnknownModelConfigError(error);
      }

      if (!OpenAiClient.isModelsListUnsupportedError(error)) {
        throw error;
      }
    }

    await this.probeModelByRequest();
  }

  async assertModelAvailable(): Promise<void> {
    if (!this.modelValidationPromise) {
      this.modelValidationPromise = this.runModelValidation();
    }

    return this.modelValidationPromise;
  }

  private async completeWithChat(system: string, user: string): Promise<string> {
    return this.completeWithChatOptions(system, user);
  }

  private async completeWithChatOptions(
    system: string,
    user: string,
    options?: { response_format?: { type: "json_object" } }
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      ...(options?.response_format ? { response_format: options.response_format } : {})
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("LLM returned empty output.");
    }
    return text;
  }

  private async completeWithResponses(system: string, user: string): Promise<string> {
    const response = await this.client.responses.create({
      model: config.model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: user }]
        }
      ]
    });

    return OpenAiClient.extractResponseText(response);
  }

  async complete(system: string, user: string): Promise<string> {
    await this.assertModelAvailable();

    try {
      return await this.completeWithChat(system, user);
    } catch (error: unknown) {
      if (!OpenAiClient.isNotFoundError(error)) {
        throw error;
      }
    }

    return this.completeWithResponses(system, user);
  }

  async completeJsonObject(system: string, user: string): Promise<string> {
    await this.assertModelAvailable();

    try {
      return await this.completeWithChatOptions(system, user, {
        response_format: { type: "json_object" }
      });
    } catch (error: unknown) {
      if (!OpenAiClient.isNotFoundError(error)) {
        throw error;
      }
    }

    // responses fallback currently has no strict JSON mode here; keep same behavior.
    return this.completeWithResponses(system, user);
  }
}
