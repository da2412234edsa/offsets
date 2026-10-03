import http from "node:http";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export interface StudioInfo {
  placeName?: string;
  placeId?: number;
  pluginVersion?: string;
}

interface PendingCall {
  id: string;
  command: string;
  args: unknown;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const LONG_POLL_MS = 20_000;
/** Playtests block the plugin's poll loop, so "connected" must tolerate long gaps. */
const CONNECTED_GRACE_MS = 150_000;

/**
 * Local HTTP bridge between the Resco agent and the Roblox Studio plugin.
 * The plugin long-polls GET /poll for commands and answers via POST /response.
 */
export class Bridge extends EventEmitter {
  private server?: http.Server;
  private queue: PendingCall[] = [];
  private inflight = new Map<string, PendingCall>();
  private waiters: http.ServerResponse[] = [];
  private lastSeen = 0;
  studio: StudioInfo = {};

  constructor(
    private host = "127.0.0.1",
    private port = 47821,
  ) {
    super();
  }

  get address(): string {
    return `http://${this.host}:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, this.host, () => resolve());
    });
    const addr = this.server.address();
    if (addr && typeof addr === "object") this.port = addr.port;
  }

  async stop(): Promise<void> {
    for (const w of this.waiters) w.end(JSON.stringify({ request: null }));
    this.waiters = [];
    for (const call of [...this.queue, ...this.inflight.values()]) {
      clearTimeout(call.timer);
      call.reject(new Error("Bridge stopped"));
    }
    this.queue = [];
    this.inflight.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  isConnected(): boolean {
    return this.inflight.size > 0 || Date.now() - this.lastSeen < CONNECTED_GRACE_MS;
  }

  async waitForStudio(timeoutMs: number): Promise<boolean> {
    if (this.lastSeen > 0) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off("connected", onConnect);
        resolve(false);
      }, timeoutMs);
      const onConnect = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.once("connected", onConnect);
    });
  }

  /** Send a command to Studio and wait for the plugin's answer. */
  call<T = unknown>(command: string, args: unknown = {}, timeoutMs = 60_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const call: PendingCall = {
        id,
        command,
        args,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer: setTimeout(() => {
          this.queue = this.queue.filter((c) => c.id !== id);
          this.inflight.delete(id);
          reject(new Error(`Studio did not answer "${command}" within ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs),
      };
      this.queue.push(call);
      this.flush();
    });
  }

  private flush(): void {
    while (this.queue.length > 0 && this.waiters.length > 0) {
      const call = this.queue.shift()!;
      const res = this.waiters.shift()!;
      this.inflight.set(call.id, call);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ request: { id: call.id, command: call.command, args: call.args } }));
    }
  }

  private markSeen(): void {
    const first = this.lastSeen === 0;
    this.lastSeen = Date.now();
    if (first) this.emit("connected");
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.address);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, connected: this.isConnected(), studio: this.studio }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/poll") {
      this.markSeen();
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== res);
        if (!res.writableEnded) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ request: null }));
        }
      }, LONG_POLL_MS);
      res.on("close", () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== res);
      });
      this.waiters.push(res);
      this.flush();
      return;
    }

    if (req.method === "POST" && (url.pathname === "/response" || url.pathname === "/hello")) {
      const body = await readJson(req);
      this.markSeen();
      if (url.pathname === "/hello") {
        this.studio = body as StudioInfo;
        this.emit("hello", this.studio);
      } else {
        const { id, ok, result, error } = body as { id: string; ok: boolean; result?: unknown; error?: string };
        const call = this.inflight.get(id);
        if (call) {
          this.inflight.delete(id);
          clearTimeout(call.timer);
          if (ok) call.resolve(result ?? null);
          else call.reject(new Error(error ?? "Unknown Studio error"));
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
