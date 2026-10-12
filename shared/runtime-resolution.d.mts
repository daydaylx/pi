export interface RuntimeResolution {
  root: string;
  source:
    "--runtime" | "PI_RUNTIME_ROOT" | "pi auf PATH" | "PI_CODING_AGENT_DIR";
}

export function resolveRuntimeRoot(options?: {
  runtime?: string;
  env?: NodeJS.ProcessEnv;
}): RuntimeResolution;
