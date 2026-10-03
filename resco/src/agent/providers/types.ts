export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxTokens?: number;
}

export interface CompletionResponse {
  content: ContentBlock[];
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ModelProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}
