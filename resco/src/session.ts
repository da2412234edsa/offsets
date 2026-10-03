import { randomUUID } from "node:crypto";
import { Bridge } from "./bridge/server.js";
import type { RescoConfig } from "./config.js";
import { runAgent, type AgentEvent, type AgentResult } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/prompts.js";
import { AnthropicProvider } from "./agent/providers/anthropic.js";
import type { Message, ModelProvider } from "./agent/providers/types.js";
import { ProjectStore } from "./memory/project.js";
import { TOOLS } from "./tools/definitions.js";
import { ToolExecutor, type Approver } from "./tools/executor.js";

export function createProvider(config: RescoConfig): ModelProvider {
  if (!config.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Export it or put it in your environment before running Resco.");
  }
  return new AnthropicProvider(config.apiKey, config.model);
}

/** One conversation with the agent against one Studio place. */
export class Session {
  readonly runId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 6);
  readonly store: ProjectStore;
  readonly executor: ToolExecutor;
  private messages: Message[] = [];

  constructor(
    readonly config: RescoConfig,
    readonly bridge: Bridge,
    private provider: ModelProvider,
    approve: Approver,
  ) {
    this.store = new ProjectStore(config.projectDir);
    this.executor = new ToolExecutor({
      bridge,
      store: this.store,
      runId: this.runId,
      approve,
      requireVerification: config.requireVerification,
    });
  }

  async send(prompt: string, onEvent?: (e: AgentEvent) => void): Promise<AgentResult> {
    const system = buildSystemPrompt({ memory: await this.store.readMemory(), studio: this.bridge.studio });
    return runAgent({
      provider: this.provider,
      executor: this.executor,
      system,
      tools: TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      messages: this.messages,
      prompt,
      maxSteps: this.config.maxSteps,
      onEvent,
    });
  }
}

export async function startBridge(config: RescoConfig): Promise<Bridge> {
  const bridge = new Bridge(config.host, config.port);
  try {
    await bridge.start();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(`Port ${config.port} is busy — is another Resco running? Set RESCO_PORT to use a different port.`);
    }
    throw err;
  }
  return bridge;
}
