import path from "node:path";

export interface RescoConfig {
  host: string;
  port: number;
  provider: "anthropic";
  model: string;
  apiKey?: string;
  maxSteps: number;
  projectDir: string;
  autoApprove: boolean;
  requireVerification: boolean;
}

export const DEFAULT_PORT = 47821;

export function loadConfig(overrides: Partial<RescoConfig> = {}): RescoConfig {
  const env = process.env;
  const projectDir = path.resolve(overrides.projectDir ?? env.RESCO_PROJECT_DIR ?? process.cwd());
  return {
    host: "127.0.0.1",
    port: Number(env.RESCO_PORT ?? DEFAULT_PORT),
    provider: "anthropic",
    model: env.RESCO_MODEL ?? "claude-opus-4-5",
    apiKey: env.ANTHROPIC_API_KEY,
    maxSteps: Number(env.RESCO_MAX_STEPS ?? 40),
    autoApprove: false,
    requireVerification: true,
    ...overrides,
    projectDir,
  };
}
