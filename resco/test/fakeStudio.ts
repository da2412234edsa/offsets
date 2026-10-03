/** Simulates the Studio plugin: long-polls the bridge and answers from an in-memory place. */
export class FakeStudio {
  scripts = new Map<string, { source: string; className: string }>();
  calls: { command: string; args: Record<string, unknown> }[] = [];
  playtestPasses = true;
  private running = false;

  constructor(private baseUrl: string) {}

  async start(): Promise<void> {
    this.running = true;
    await fetch(`${this.baseUrl}/hello`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placeName: "TestPlace", placeId: 1 }),
    });
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let data: { request: { id: string; command: string; args: Record<string, unknown> } | null };
      try {
        data = await (await fetch(`${this.baseUrl}/poll`)).json();
      } catch {
        return;
      }
      if (!data.request) continue;
      const { id, command, args } = data.request;
      this.calls.push({ command, args });
      let body: Record<string, unknown>;
      try {
        body = { id, ok: true, result: this.handle(command, args) };
      } catch (err) {
        body = { id, ok: false, error: (err as Error).message };
      }
      await fetch(`${this.baseUrl}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    }
  }

  private handle(command: string, args: Record<string, unknown>): unknown {
    switch (command) {
      case "get_tree":
        return { roots: [{ name: "ServerScriptService", className: "ServerScriptService", children: [] }] };
      case "read_script": {
        const s = this.scripts.get(String(args.path));
        if (!s) throw new Error(`Instance not found: ${args.path}`);
        return { path: args.path, ...s };
      }
      case "write_script":
        this.scripts.set(String(args.path), {
          source: String(args.source),
          className: String(args.className ?? this.scripts.get(String(args.path))?.className ?? "ModuleScript"),
        });
        return { path: args.path };
      case "delete_instance":
        this.scripts.delete(String(args.path));
        return { deleted: args.path };
      case "playtest":
        return this.playtestPasses
          ? { passed: true, serverErrors: [], clientErrors: [], failedChecks: [] }
          : { passed: false, serverErrors: ["ServerScriptService.Shop:3: attempt to index nil"], clientErrors: [] };
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
}
