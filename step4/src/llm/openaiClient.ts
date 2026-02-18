import OpenAI from "openai";
import { config } from "../config";

export class OpenAiClient {
  private readonly client: OpenAI;

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
