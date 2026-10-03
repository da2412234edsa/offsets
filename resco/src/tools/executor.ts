import { createTwoFilesPatch } from "diff";
import type { Bridge } from "../bridge/server.js";
import type { CheckpointEntry, ProjectStore } from "../memory/project.js";
import { TOOL_BY_NAME } from "./definitions.js";

export interface ApprovalRequest {
  tool: string;
  summary: string;
  diff?: string;
}

export type Approver = (req: ApprovalRequest) => Promise<boolean>;

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Set when the agent called `finish` and it was accepted. */
  finished?: { summary: string; verified: boolean };
}

export interface ExecutorOptions {
  bridge: Pick<Bridge, "call">;
  store: ProjectStore;
  runId: string;
  approve: Approver;
  requireVerification: boolean;
}

interface PlaytestResult {
  passed?: boolean;
}

/**
 * Executes tool calls from the model: forwards Studio tools over the bridge,
 * asks for approval on mutations, checkpoints scripts for undo, and enforces
 * that changes are playtested before the agent may finish.
 */
export class ToolExecutor {
  private checkpoint: CheckpointEntry[] = [];
  private checkpointed = new Set<string>();
  /** True when the place changed after the last passing playtest. */
  dirty = false;
  everPlaytested = false;

  constructor(private opts: ExecutorOptions) {}

  async execute(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
    const def = TOOL_BY_NAME.get(name);
    if (!def) return { content: `Unknown tool "${name}".`, isError: true };

    try {
      if (name === "remember") {
        await this.opts.store.remember(String(input.note ?? ""));
        return { content: "Saved to project memory." };
      }
      if (name === "finish") return this.finish(input);

      if (def.mutating) {
        const approved = await this.requestApproval(name, input);
        if (!approved) {
          return { content: "The user rejected this change. Ask what they want instead or try another approach.", isError: true };
        }
        await this.recordCheckpoint(name, input);
      }

      const timeout = name === "playtest" ? (Number(input.durationSec ?? 6) + 90) * 1000 : 60_000;
      const result = await this.opts.bridge.call(name, input, timeout);

      if (def.mutating) this.dirty = true;
      if (name === "playtest") {
        this.everPlaytested = true;
        if ((result as PlaytestResult)?.passed) this.dirty = false;
      }
      return { content: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  }

  private finish(input: Record<string, unknown>): ToolOutcome {
    const summary = String(input.summary ?? "");
    const verified = Boolean(input.verified);
    if (this.opts.requireVerification && this.dirty && verified) {
      return {
        content:
          "You claimed verified=true but the place changed after the last passing playtest. Run playtest (with checks for the new behaviour) and fix any errors first.",
        isError: true,
      };
    }
    if (this.opts.requireVerification && this.dirty && !this.everPlaytested) {
      return {
        content:
          "You changed the place but never playtested. Run playtest first; only finish with verified=false if a playtest is genuinely impossible, and say why.",
        isError: true,
      };
    }
    return { content: "Task finished.", finished: { summary, verified: verified && !this.dirty } };
  }

  get checkpointSize(): number {
    return this.checkpoint.length;
  }

  private async readScript(path: string): Promise<{ source: string; className?: string } | undefined> {
    try {
      const res = (await this.opts.bridge.call("read_script", { path })) as { source: string; className?: string };
      return res;
    } catch {
      return undefined;
    }
  }

  private async requestApproval(name: string, input: Record<string, unknown>): Promise<boolean> {
    switch (name) {
      case "write_script": {
        const path = String(input.path);
        const existing = await this.readScript(path);
        const diff = createTwoFilesPatch(path, path, existing?.source ?? "", String(input.source ?? ""), "", "", {
          context: 3,
        });
        return this.opts.approve({
          tool: name,
          summary: existing ? `Edit ${path}` : `Create ${input.className ?? "ModuleScript"} ${path}`,
          diff,
        });
      }
      case "create_instance":
        return this.opts.approve({
          tool: name,
          summary: `Create ${input.className} "${input.name}" in ${input.parentPath}`,
          diff: input.properties ? JSON.stringify(input.properties, null, 2) : undefined,
        });
      case "set_properties":
        return this.opts.approve({
          tool: name,
          summary: `Set properties on ${input.path}`,
          diff: JSON.stringify(input.properties, null, 2),
        });
      case "delete_instance":
        return this.opts.approve({ tool: name, summary: `Delete ${input.path}` });
      case "run_luau":
        return this.opts.approve({ tool: name, summary: "Run Luau in Studio (edit mode)", diff: String(input.code) });
      default:
        return this.opts.approve({ tool: name, summary: name });
    }
  }

  private async recordCheckpoint(name: string, input: Record<string, unknown>): Promise<void> {
    if (name !== "write_script" && name !== "delete_instance") return;
    const path = String(input.path);
    if (this.checkpointed.has(path)) return;
    const existing = await this.readScript(path);
    if (name === "delete_instance" && !existing) return;
    this.checkpointed.add(path);
    this.checkpoint.push({
      path,
      existed: Boolean(existing),
      className: existing?.className ?? (input.className as string | undefined),
      before: existing?.source,
    });
    await this.opts.store.saveCheckpoint(this.opts.runId, this.checkpoint);
  }
}
