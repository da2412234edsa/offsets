import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/agent/loop.js";
import type { CompletionRequest, CompletionResponse, ContentBlock, ModelProvider } from "../src/agent/providers/types.js";
import { Bridge } from "../src/bridge/server.js";
import { ProjectStore } from "../src/memory/project.js";
import { TOOLS } from "../src/tools/definitions.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { FakeStudio } from "./fakeStudio.js";

/** Replays a fixed list of assistant turns and records what it was sent. */
class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  requests: CompletionRequest[] = [];
  constructor(private turns: ContentBlock[][]) {}
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(structuredClone(req));
    const content = this.turns.shift() ?? [{ type: "text", text: "no more turns" }];
    return { content };
  }
}

const use = (id: string, name: string, input: Record<string, unknown>): ContentBlock => ({
  type: "tool_use",
  id,
  name,
  input,
});

const lastToolResult = (req: CompletionRequest, id: string) =>
  req.messages
    .flatMap((m) => m.content)
    .find((b): b is Extract<ContentBlock, { type: "tool_result" }> => b.type === "tool_result" && b.tool_use_id === id);

describe("resco", () => {
  let bridge: Bridge;
  let studio: FakeStudio;
  let dir: string;
  let store: ProjectStore;

  beforeEach(async () => {
    bridge = new Bridge("127.0.0.1", 0);
    await bridge.start();
    studio = new FakeStudio(bridge.address);
    await studio.start();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "resco-"));
    store = new ProjectStore(dir);
  });

  afterEach(async () => {
    studio.stop();
    await bridge.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const makeExecutor = (approve = async () => true) =>
    new ToolExecutor({ bridge, store, runId: "run1", approve, requireVerification: true });

  it("round-trips commands through the bridge to the plugin", async () => {
    expect(await bridge.waitForStudio(1000)).toBe(true);
    expect(bridge.studio.placeName).toBe("TestPlace");
    await bridge.call("write_script", { path: "ServerScriptService/Hello", source: "print(1)", className: "Script" });
    const res = await bridge.call<{ source: string }>("read_script", { path: "ServerScriptService/Hello" });
    expect(res.source).toBe("print(1)");
    await expect(bridge.call("read_script", { path: "Nope" })).rejects.toThrow("Instance not found");
  });

  it("blocks finish until a passing playtest happens after edits", async () => {
    const provider = new ScriptedProvider([
      [use("1", "write_script", { path: "ServerScriptService/Shop", source: "-- shop", className: "Script" })],
      [use("2", "finish", { summary: "added shop", verified: true })],
      [use("3", "playtest", { durationSec: 3 })],
      [use("4", "finish", { summary: "added shop", verified: true })],
    ]);
    const result = await runAgent({
      provider,
      executor: makeExecutor(),
      system: "sys",
      tools: TOOLS,
      messages: [],
      prompt: "add a shop",
      maxSteps: 10,
    });

    expect(result).toMatchObject({ status: "finished", verified: true, steps: 4 });
    expect(lastToolResult(provider.requests[2], "2")?.is_error).toBe(true);
    expect(studio.scripts.get("ServerScriptService/Shop")?.source).toBe("-- shop");
  });

  it("keeps the agent fixing when the playtest fails", async () => {
    studio.playtestPasses = false;
    const provider = new ScriptedProvider([
      [use("1", "write_script", { path: "ServerScriptService/Shop", source: "bad", className: "Script" })],
      [use("2", "playtest", {})],
      [use("3", "finish", { summary: "done", verified: true })],
    ]);
    const executor = makeExecutor();
    const result = await runAgent({
      provider,
      executor,
      system: "sys",
      tools: TOOLS,
      messages: [],
      prompt: "add a shop",
      maxSteps: 3,
    });
    expect(result.status).toBe("max_steps");
    expect(executor.dirty).toBe(true);
    expect(lastToolResult(provider.requests[2], "2")?.content).toContain("attempt to index nil");
  });

  it("does not apply rejected changes and checkpoints approved ones", async () => {
    studio.scripts.set("ServerScriptService/Main", { source: "old", className: "Script" });
    const seen: string[] = [];
    let allow = false;
    const executor = makeExecutor(async (req) => {
      seen.push(req.diff ?? "");
      return allow;
    });

    const rejected = await executor.execute("write_script", { path: "ServerScriptService/Main", source: "new" });
    expect(rejected.isError).toBe(true);
    expect(studio.scripts.get("ServerScriptService/Main")?.source).toBe("old");
    expect(seen[0]).toContain("-old");
    expect(seen[0]).toContain("+new");

    allow = true;
    await executor.execute("write_script", { path: "ServerScriptService/Main", source: "new" });
    await executor.execute("write_script", { path: "ServerScriptService/Added", source: "x", className: "Script" });
    expect(studio.scripts.get("ServerScriptService/Main")?.source).toBe("new");

    const checkpoint = await store.loadCheckpoint();
    expect(checkpoint?.entries).toEqual([
      { path: "ServerScriptService/Main", existed: true, className: "Script", before: "old" },
      { path: "ServerScriptService/Added", existed: false, className: "Script", before: undefined },
    ]);
  });

  it("persists project memory", async () => {
    const executor = makeExecutor();
    await executor.execute("remember", { note: "Remotes live in ReplicatedStorage/Remotes" });
    expect(await store.readMemory()).toContain("ReplicatedStorage/Remotes");
  });
});
