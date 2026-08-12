export interface RuntimeResolution {
  root: string;
  source: "--runtime" | "PI_RUNTIME_ROOT" | "pi auf PATH";
}

export function resolveRuntimeRoot(options?: {
  runtime?: string;
  env?: NodeJS.ProcessEnv;
}): RuntimeResolution;
