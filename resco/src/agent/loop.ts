import type { ToolExecutor } from "../tools/executor.js";
import type { ContentBlock, Message, ModelProvider, ToolSpec } from "./providers/types.js";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; content: string; isError: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number };

export interface AgentResult {
  status: "finished" | "stopped" | "max_steps";
  summary?: string;
  verified?: boolean;
  steps: number;
}

export interface RunOptions {
  provider: ModelProvider;
  executor: ToolExecutor;
  system: string;
  tools: ToolSpec[];
  /** Conversation so far; the new user prompt is appended and the array is mutated in place. */
  messages: Message[];
  prompt: string;
  maxSteps: number;
  onEvent?: (e: AgentEvent) => void;
}

const MAX_TOOL_RESULT_CHARS = 30_000;

export async function runAgent(opts: RunOptions): Promise<AgentResult> {
  const { provider, executor, messages, onEvent } = opts;
  messages.push({ role: "user", content: [{ type: "text", text: opts.prompt }] });

  for (let step = 1; step <= opts.maxSteps; step++) {
    const res = await provider.complete({ system: opts.system, messages, tools: opts.tools });
    if (res.usage) onEvent?.({ type: "usage", ...res.usage });
    messages.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    for (const b of res.content) if (b.type === "text" && b.text.trim()) onEvent?.({ type: "text", text: b.text });

    if (toolUses.length === 0) {
      return { status: "stopped", steps: step };
    }

    const results: ContentBlock[] = [];
    let finished: { summary: string; verified: boolean } | undefined;
    for (const use of toolUses) {
      onEvent?.({ type: "tool_call", name: use.name, input: use.input });
      const outcome = await executor.execute(use.name, use.input ?? {});
      const content =
        outcome.content.length > MAX_TOOL_RESULT_CHARS
          ? `${outcome.content.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated ${outcome.content.length - MAX_TOOL_RESULT_CHARS} chars]`
          : outcome.content;
      onEvent?.({ type: "tool_result", name: use.name, content, isError: Boolean(outcome.isError) });
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: outcome.isError || undefined });
      if (outcome.finished) finished = outcome.finished;
    }
    messages.push({ role: "user", content: results });

    if (finished) return { status: "finished", ...finished, steps: step };
  }
  return { status: "max_steps", steps: opts.maxSteps };
}
