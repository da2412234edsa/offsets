import readline from "node:readline";
import type { Bridge } from "../bridge/server.js";
import { ProjectStore } from "../memory/project.js";
import { TOOLS } from "../tools/definitions.js";
import { ToolExecutor } from "../tools/executor.js";

const PROTOCOL_VERSION = "2025-06-18";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Minimal MCP server over stdio exposing Resco's Studio tools to external agents
 * (Claude Code, Cursor, Codex...). The client is responsible for approvals, so
 * mutations are auto-approved but still checkpointed for `resco undo`.
 */
export async function runMcpServer(bridge: Bridge, projectDir: string, version: string): Promise<void> {
  const executor = new ToolExecutor({
    bridge,
    store: new ProjectStore(projectDir),
    runId: `mcp-${Date.now()}`,
    approve: async () => true,
    requireVerification: false,
  });
  const tools = TOOLS.filter((t) => t.name !== "finish");

  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = readline.createInterface({ input: process.stdin });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: RpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (req.id === undefined) continue;

    const reply = (result: unknown) => send({ jsonrpc: "2.0", id: req.id, result });
    switch (req.method) {
      case "initialize":
        reply({
          protocolVersion: (req.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "resco", version },
          instructions:
            "Resco controls the user's open Roblox Studio place. Inspect with get_tree/read_script before editing, and verify changes with playtest.",
        });
        break;
      case "ping":
        reply({});
        break;
      case "tools/list":
        reply({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
        break;
      case "tools/call": {
        const name = String(req.params?.name ?? "");
        const args = (req.params?.arguments as Record<string, unknown>) ?? {};
        const outcome = await executor.execute(name, args);
        reply({ content: [{ type: "text", text: outcome.content }], isError: Boolean(outcome.isError) });
        break;
      }
      default:
        send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
    }
  }
}
