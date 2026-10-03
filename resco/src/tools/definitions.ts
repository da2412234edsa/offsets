export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Changes the place; goes through approval and checkpointing. */
  mutating?: boolean;
  /** Handled by Resco itself rather than forwarded to the Studio plugin. */
  local?: boolean;
}

const PATH_HINT =
  'Instance path separated by "/", starting at a service, e.g. "ServerScriptService/Systems/Shop".';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

export const TOOLS: ToolDef[] = [
  {
    name: "get_tree",
    description:
      "List the instance hierarchy under a path. Omit path to get an overview of the main services. Use this before editing so new code references real instances.",
    input_schema: obj({
      path: { type: "string", description: PATH_HINT },
      depth: { type: "integer", minimum: 0, maximum: 8, description: "How many levels to expand (default 2)." },
    }),
  },
  {
    name: "get_instance",
    description: "Read common properties and attributes of one instance.",
    input_schema: obj({ path: { type: "string", description: PATH_HINT } }, ["path"]),
  },
  {
    name: "read_script",
    description: "Read the full source of a Script, LocalScript or ModuleScript.",
    input_schema: obj({ path: { type: "string", description: PATH_HINT } }, ["path"]),
  },
  {
    name: "search_scripts",
    description: "Find scripts whose source contains a plain-text query. Returns paths and matching lines.",
    input_schema: obj({ query: { type: "string" }, limit: { type: "integer", default: 50 } }, ["query"]),
  },
  {
    name: "write_script",
    description:
      "Create or fully replace a script's source. If the script does not exist it is created under its parent path with the given className. Always send the complete file.",
    mutating: true,
    input_schema: obj(
      {
        path: { type: "string", description: PATH_HINT },
        source: { type: "string", description: "Complete Luau source." },
        className: { type: "string", enum: ["Script", "LocalScript", "ModuleScript"] },
      },
      ["path", "source"],
    ),
  },
  {
    name: "create_instance",
    description:
      'Create a non-script instance (Folder, RemoteEvent, Part, ScreenGui, Frame, TextButton...). Property values may be primitives or typed objects like {"type":"Vector3","value":[0,5,0]}, {"type":"Color3RGB","value":[255,0,0]}, {"type":"UDim2","value":[0.5,0,0.5,0]}, {"type":"Enum","value":["Material","Neon"]}.',
    mutating: true,
    input_schema: obj(
      {
        parentPath: { type: "string", description: PATH_HINT },
        className: { type: "string" },
        name: { type: "string" },
        properties: { type: "object" },
      },
      ["parentPath", "className", "name"],
    ),
  },
  {
    name: "set_properties",
    description: "Set properties on an existing instance. Uses the same typed value format as create_instance.",
    mutating: true,
    input_schema: obj({ path: { type: "string", description: PATH_HINT }, properties: { type: "object" } }, [
      "path",
      "properties",
    ]),
  },
  {
    name: "delete_instance",
    description: "Delete an instance. Script deletions can be undone with `resco undo`; other instances cannot.",
    mutating: true,
    input_schema: obj({ path: { type: "string", description: PATH_HINT } }, ["path"]),
  },
  {
    name: "run_luau",
    description:
      "Run Luau in edit mode (plugin context) and return the result plus printed output. Good for bulk edits or inspecting data. Changes made here are not checkpointed.",
    mutating: true,
    input_schema: obj({ code: { type: "string" } }, ["code"]),
  },
  {
    name: "playtest",
    description:
      "Start a real Play session (server + one client), wait, then stop and return server and client output, errors and check results. testCode runs on the server as the body of function(t) where t.check(name, condition, detail?) records an assertion, t.waitForPlayer() returns the first Player, t.wait(seconds) yields. A playtest passes when there are no errors and every check passes.",
    input_schema: obj({
      durationSec: { type: "number", minimum: 1, maximum: 120, description: "Total session length (default 6)." },
      testCode: { type: "string", description: "Optional server-side Luau assertions." },
    }),
  },
  {
    name: "get_output",
    description: "Return recent lines from the Studio Output window (edit mode).",
    input_schema: obj({ limit: { type: "integer", default: 100 } }),
  },
  {
    name: "remember",
    description:
      "Save a durable note about this project (architecture, conventions, decisions) so future Resco sessions follow it.",
    local: true,
    input_schema: obj({ note: { type: "string" } }, ["note"]),
  },
  {
    name: "finish",
    description:
      "End the task. Call only after a passing playtest that covers your changes, unless verification is impossible (then set verified=false and explain).",
    local: true,
    input_schema: obj(
      {
        summary: { type: "string", description: "What changed and how it was verified." },
        verified: { type: "boolean" },
      },
      ["summary", "verified"],
    ),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
