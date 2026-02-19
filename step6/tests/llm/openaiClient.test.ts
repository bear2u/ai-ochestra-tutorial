import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";

const mockModelsList = vi.fn();
const mockChatCreate = vi.fn();
const mockResponsesCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    readonly models = { list: mockModelsList };
    readonly chat = {
      completions: {
        create: mockChatCreate
      }
    };
    readonly responses = {
      create: mockResponsesCreate
    };

    constructor(_: unknown) {}
  }

  return { default: MockOpenAI };
});

import { OpenAiClient } from "../../src/llm/openaiClient";

describe("OpenAiClient model validation", () => {
  const originalModel = config.model;
  const originalBaseUrl = config.openaiBaseUrl;

  beforeEach(() => {
    config.model = originalModel;
    config.openaiBaseUrl = originalBaseUrl;

    mockModelsList.mockReset();
    mockChatCreate.mockReset();
    mockResponsesCreate.mockReset();
  });

  it("passes when configured model is found in provider model list", async () => {
    config.model = "supported-model";
    mockModelsList.mockResolvedValue({
      data: [{ id: "supported-model" }, { id: "other-model" }]
    });

    const client = new OpenAiClient();
    await client.assertModelAvailable();
    await client.assertModelAvailable();

    expect(mockModelsList).toHaveBeenCalledTimes(1);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it("throws actionable error when provider returns unknown model", async () => {
    config.model = "bad-model";
    config.openaiBaseUrl = "http://localhost:8000/v1";
    mockModelsList.mockRejectedValueOnce({ status: 404, message: "models endpoint not found" });
    mockChatCreate.mockRejectedValueOnce(
      new Error("API Error: 400 {\"error\":{\"code\":\"1211\",\"message\":\"Unknown Model\"}}")
    );

    const client = new OpenAiClient();
    await expect(client.assertModelAvailable()).rejects.toThrow(
      "Configured OPENAI_MODEL \"bad-model\" is not available on http://localhost:8000/v1."
    );
  });

  it("falls back to responses probe when chat endpoint is unavailable", async () => {
    config.model = "supported-via-responses";
    mockModelsList.mockRejectedValueOnce({ status: 404, message: "models endpoint not found" });
    mockChatCreate.mockRejectedValueOnce({ status: 404, message: "chat endpoint not found" });
    mockResponsesCreate.mockResolvedValueOnce({ output_text: "ok" });

    const client = new OpenAiClient();
    await expect(client.assertModelAvailable()).resolves.toBeUndefined();

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
  });
});
