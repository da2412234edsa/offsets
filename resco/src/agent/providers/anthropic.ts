import type { CompletionRequest, CompletionResponse, ContentBlock, ModelProvider } from "./types.js";

const API_URL = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements ModelProvider {
  readonly name: string;

  constructor(
    private apiKey: string,
    private model: string,
  ) {
    this.name = `anthropic:${model}`;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 16_000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools,
      messages: req.messages,
    };

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
        continue;
      }
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

      const data = (await res.json()) as {
        content: ContentBlock[];
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
      return {
        content: data.content.filter((b) => b.type === "text" || b.type === "tool_use"),
        stopReason: data.stop_reason,
        usage: data.usage && { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
      };
    }
  }
}
