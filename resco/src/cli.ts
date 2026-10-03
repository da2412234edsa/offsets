#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { AgentEvent, AgentResult } from "./agent/loop.js";
import type { Bridge } from "./bridge/server.js";
import { loadConfig, type RescoConfig } from "./config.js";
import { runMcpServer } from "./mcp/server.js";
import { ProjectStore } from "./memory/project.js";
import { createProvider, Session, startBridge } from "./session.js";
import type { Approver } from "./tools/executor.js";

const VERSION = "0.1.0";
const PLUGIN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugin/Resco.server.lua");

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const HELP = `${c.bold("resco")} ${VERSION} — AI agent that builds, playtests and fixes Roblox games in Studio

Usage:
  resco                       Interactive chat with the agent (default)
  resco run "<prompt>"        Run a single task and exit
  resco mcp                   MCP server over stdio for Claude Code / Cursor / Codex
  resco serve                 Only run the Studio bridge (debugging)
  resco status                Check whether Studio is connected
  resco undo [runId]          Restore scripts changed by the last (or given) run
  resco install-plugin        Copy the Studio plugin into your Roblox Plugins folder

Options:
  --yes, -y                   Apply changes without asking
  --no-verify                 Allow finishing without a passing playtest
  --model <id>                Model id (default $RESCO_MODEL or claude-opus-4-5)
  --max-steps <n>             Max agent turns per task (default 40)
  --project <dir>             Where .resco memory/checkpoints live (default cwd)

Env: ANTHROPIC_API_KEY (required for chat/run), RESCO_MODEL, RESCO_PORT`;

interface Args {
  command: string;
  positional: string[];
  overrides: Partial<RescoConfig>;
}

function parseArgs(argv: string[]): Args {
  const overrides: Partial<RescoConfig> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") overrides.autoApprove = true;
    else if (a === "--no-verify") overrides.requireVerification = false;
    else if (a === "--model") overrides.model = argv[++i];
    else if (a === "--max-steps") overrides.maxSteps = Number(argv[++i]);
    else if (a === "--project") overrides.projectDir = argv[++i];
    else if (a === "--help" || a === "-h") positional.unshift("help");
    else positional.push(a);
  }
  const commands = ["chat", "run", "mcp", "serve", "status", "undo", "install-plugin", "help"];
  const command = commands.includes(positional[0]) ? positional.shift()! : "chat";
  return { command, positional, overrides };
}

function printEvent(e: AgentEvent): void {
  switch (e.type) {
    case "text":
      console.log(`\n${e.text}`);
      break;
    case "tool_call": {
      const hint = (e.input.path ?? e.input.parentPath ?? e.input.query ?? "") as string;
      console.log(c.cyan(`  ▸ ${e.name}`) + (hint ? c.dim(` ${hint}`) : ""));
      break;
    }
    case "tool_result":
      if (e.name === "playtest") {
        const passed = /"passed":\s*true/.test(e.content);
        console.log(passed ? c.green("    ✓ playtest passed") : c.red("    ✗ playtest failed"));
      } else if (e.isError) {
        console.log(c.red(`    ✗ ${e.content.split("\n")[0].slice(0, 200)}`));
      }
      break;
    case "usage":
      break;
  }
}

function printResult(r: AgentResult): void {
  if (r.status === "finished") {
    const badge = r.verified ? c.green("✓ verified by playtest") : c.yellow("⚠ not verified");
    console.log(`\n${c.bold("Done")} ${badge}\n${r.summary ?? ""}`);
  } else if (r.status === "max_steps") {
    console.log(c.yellow(`\nStopped after ${r.steps} steps. Say "continue" to keep going.`));
  }
}

function makeApprover(config: RescoConfig, rl?: readline.Interface): Approver {
  return async (req) => {
    if (config.autoApprove || !rl) return true;
    console.log(`\n${c.yellow("●")} ${c.bold(req.summary)}`);
    if (req.diff) {
      for (const line of req.diff.split("\n").slice(4, 120)) {
        if (line.startsWith("+")) console.log(c.green(line));
        else if (line.startsWith("-")) console.log(c.red(line));
        else console.log(c.dim(line));
      }
    }
    const answer = (await rl.question(`${c.bold("Apply?")} [Y/n/a=always] `)).trim().toLowerCase();
    if (answer === "a") {
      config.autoApprove = true;
      return true;
    }
    return answer === "" || answer === "y" || answer === "yes";
  };
}

async function connect(config: RescoConfig, quiet = false): Promise<Bridge> {
  const bridge = await startBridge(config);
  const log = quiet ? (s: string) => process.stderr.write(s + "\n") : console.log;
  log(c.dim(`Bridge listening on ${bridge.address}. Waiting for Roblox Studio (enable the Resco plugin)...`));
  bridge.on("hello", (info) => log(c.green(`Connected to Studio: ${info.placeName ?? "place"}`)));
  return bridge;
}

async function chat(config: RescoConfig, firstPrompt?: string, once = false): Promise<void> {
  const provider = createProvider(config);
  const bridge = await connect(config);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!(await bridge.waitForStudio(120_000))) {
      console.log(c.red("Studio did not connect within 2 minutes. Run `resco install-plugin`, restart Studio and allow HTTP access."));
      return;
    }
    const session = new Session(config, bridge, provider, makeApprover(config, rl));
    let prompt = firstPrompt;
    for (;;) {
      if (!prompt) {
        prompt = (await rl.question(`\n${c.bold("resco›")} `)).trim();
        if (!prompt) continue;
        if (prompt === "exit" || prompt === "quit") break;
      }
      try {
        printResult(await session.send(prompt, printEvent));
      } catch (err) {
        console.log(c.red(`Error: ${(err as Error).message}`));
      }
      if (session.executor.checkpointSize > 0) console.log(c.dim(`Undo with: resco undo ${session.runId}`));
      prompt = undefined;
      if (once) break;
    }
  } finally {
    rl.close();
    await bridge.stop();
  }
}

async function undo(config: RescoConfig, runId?: string): Promise<void> {
  const checkpoint = await new ProjectStore(config.projectDir).loadCheckpoint(runId);
  if (!checkpoint) {
    console.log("No checkpoint found.");
    return;
  }
  const bridge = await connect(config);
  try {
    if (!(await bridge.waitForStudio(60_000))) throw new Error("Studio did not connect.");
    for (const entry of [...checkpoint.entries].reverse()) {
      if (entry.existed) {
        await bridge.call("write_script", { path: entry.path, source: entry.before ?? "", className: entry.className });
        console.log(c.green(`restored ${entry.path}`));
      } else {
        await bridge.call("delete_instance", { path: entry.path }).catch(() => undefined);
        console.log(c.green(`removed ${entry.path}`));
      }
    }
  } finally {
    await bridge.stop();
  }
}

function pluginsDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Roblox", "Plugins");
  }
  return path.join(os.homedir(), "Documents", "Roblox", "Plugins");
}

async function installPlugin(): Promise<void> {
  const dir = pluginsDir();
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, "Resco.lua");
  await fs.copyFile(PLUGIN_FILE, dest);
  console.log(`Installed plugin to ${dest}`);
  console.log("Restart Roblox Studio, open your place, and allow HTTP requests to 127.0.0.1 when Studio asks.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.overrides);

  switch (args.command) {
    case "help":
      console.log(HELP);
      return;
    case "run": {
      const prompt = args.positional.join(" ").trim();
      if (!prompt) throw new Error('Usage: resco run "<prompt>"');
      return chat(config, prompt, true);
    }
    case "chat":
      return chat(config, args.positional.join(" ").trim() || undefined);
    case "mcp": {
      const bridge = await connect(config, true);
      await runMcpServer(bridge, config.projectDir, VERSION);
      await bridge.stop();
      return;
    }
    case "serve": {
      await connect(config);
      await new Promise(() => undefined);
      return;
    }
    case "status": {
      const res = await fetch(`http://${config.host}:${config.port}/health`).catch(() => undefined);
      if (!res) console.log("Resco is not running.");
      else console.log(JSON.stringify(await res.json(), null, 2));
      return;
    }
    case "undo":
      return undo(config, args.positional[0]);
    case "install-plugin":
      return installPlugin();
  }
}

main().catch((err) => {
  console.error(c.red((err as Error).message));
  process.exit(1);
});
