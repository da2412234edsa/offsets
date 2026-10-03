import fs from "node:fs/promises";
import path from "node:path";

/** Per-project state stored in `<projectDir>/.resco`. */
export class ProjectStore {
  readonly root: string;

  constructor(projectDir: string) {
    this.root = path.join(projectDir, ".resco");
  }

  private get memoryFile(): string {
    return path.join(this.root, "memory.md");
  }

  private checkpointFile(runId: string): string {
    return path.join(this.root, "checkpoints", `${runId}.json`);
  }

  async readMemory(): Promise<string> {
    try {
      return await fs.readFile(this.memoryFile, "utf8");
    } catch {
      return "";
    }
  }

  async remember(note: string): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.appendFile(this.memoryFile, `- ${note.trim().replace(/\n+/g, " ")}\n`);
  }

  async saveCheckpoint(runId: string, entries: CheckpointEntry[]): Promise<void> {
    const file = this.checkpointFile(runId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ runId, createdAt: new Date().toISOString(), entries }, null, 2));
  }

  async loadCheckpoint(runId?: string): Promise<Checkpoint | undefined> {
    const dir = path.join(this.root, "checkpoints");
    let id = runId;
    if (!id) {
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      const stats = await Promise.all(
        files.filter((f) => f.endsWith(".json")).map(async (f) => ({ f, t: (await fs.stat(path.join(dir, f))).mtimeMs })),
      );
      const latest = stats.sort((a, b) => b.t - a.t)[0];
      if (!latest) return undefined;
      id = latest.f.replace(/\.json$/, "");
    }
    try {
      return JSON.parse(await fs.readFile(this.checkpointFile(id), "utf8")) as Checkpoint;
    } catch {
      return undefined;
    }
  }
}

export interface CheckpointEntry {
  path: string;
  existed: boolean;
  className?: string;
  before?: string;
}

export interface Checkpoint {
  runId: string;
  createdAt: string;
  entries: CheckpointEntry[];
}
