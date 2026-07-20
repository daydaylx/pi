import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type MotionMode = "contextual" | "reduced" | "off";
export type PolicyAction = "block" | "ask" | "allow";
export type LspMode = "off" | "auto" | "force";
export type VerificationName = "typecheck" | "test" | "verify";

export interface VerificationCommand {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface SetupConfig {
  ui: { theme: "aurora-night"; motion: MotionMode };
  permissions: { unknownTools: PolicyAction; bash: PolicyAction };
  lsp: {
    enabled: boolean;
    mode: LspMode;
    requestTimeoutMs: number;
    idleShutdownMs: number;
  };
  subagents: { concurrency: number; freshContext: boolean };
  models: { primary: string; fast: string; deep: string };
  verification: Record<VerificationName, VerificationCommand>;
}

export interface ConfigDiagnostic {
  level: "error" | "warning";
  source: string;
  message: string;
}

export interface LoadedSetupConfig {
  config: SetupConfig;
  diagnostics: ConfigDiagnostic[];
  sources: string[];
}

const DEFAULT_CONFIG: SetupConfig = {
  ui: { theme: "aurora-night", motion: "contextual" },
  permissions: { unknownTools: "ask", bash: "ask" },
  lsp: {
    enabled: true,
    mode: "auto",
    requestTimeoutMs: 10_000,
    idleShutdownMs: 600_000,
  },
  subagents: { concurrency: 4, freshContext: true },
  models: {
    primary: "openai-codex/gpt-5.4",
    fast: "openai-codex/gpt-5.4-mini",
    deep: "openai-codex/gpt-5.5",
  },
  verification: {
    typecheck: {
      command: "npm",
      args: ["--prefix", "npm", "run", "typecheck"],
      timeoutMs: 120_000,
    },
    test: {
      command: "npm",
      args: ["--prefix", "npm", "run", "test"],
      timeoutMs: 300_000,
    },
    verify: {
      command: "npm",
      args: ["--prefix", "npm", "run", "verify"],
      timeoutMs: 420_000,
    },
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
  prefix: string,
  diagnostics: ConfigDiagnostic[],
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    diagnostics.push({
      level: "error",
      source,
      message: `unbekannter Schlüssel ${prefix}${key}`,
    });
  }
}

function readObject(path: string, diagnostics: ConfigDiagnostic[]) {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(parsed)) throw new Error("Root-Wert muss ein Objekt sein");
    return parsed;
  } catch (error) {
    diagnostics.push({
      level: "error",
      source: path,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  source: string,
  key: string,
  diagnostics: ConfigDiagnostic[],
): T {
  if (value === undefined) return fallback;
  if (typeof value === "string" && allowed.includes(value as T))
    return value as T;
  diagnostics.push({
    level: "error",
    source,
    message: `${key} has an invalid value`,
  });
  return fallback;
}

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  source: string,
  key: string,
  diagnostics: ConfigDiagnostic[],
): number {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && Number(value) >= min && Number(value) <= max)
    return Number(value);
  diagnostics.push({
    level: "error",
    source,
    message: `${key} must be ${min}..${max}`,
  });
  return fallback;
}

function applyUserLayer(
  base: SetupConfig,
  raw: Record<string, unknown>,
  source: string,
  diagnostics: ConfigDiagnostic[],
): SetupConfig {
  const next = structuredClone(base);
  reportUnknownKeys(
    raw,
    [
      "$schema",
      "ui",
      "permissions",
      "lsp",
      "subagents",
      "models",
      "verification",
    ],
    source,
    "",
    diagnostics,
  );
  const ui = isObject(raw.ui) ? raw.ui : undefined;
  const permissions = isObject(raw.permissions) ? raw.permissions : undefined;
  const lsp = isObject(raw.lsp) ? raw.lsp : undefined;
  const subagents = isObject(raw.subagents) ? raw.subagents : undefined;
  const models = isObject(raw.models) ? raw.models : undefined;
  const verification = isObject(raw.verification)
    ? raw.verification
    : undefined;

  if (ui)
    reportUnknownKeys(ui, ["theme", "motion"], source, "ui.", diagnostics);
  if (permissions)
    reportUnknownKeys(
      permissions,
      ["unknownTools", "bash"],
      source,
      "permissions.",
      diagnostics,
    );
  if (lsp)
    reportUnknownKeys(
      lsp,
      ["enabled", "mode", "requestTimeoutMs", "idleShutdownMs"],
      source,
      "lsp.",
      diagnostics,
    );
  if (subagents)
    reportUnknownKeys(
      subagents,
      ["concurrency", "freshContext"],
      source,
      "subagents.",
      diagnostics,
    );
  if (models)
    reportUnknownKeys(
      models,
      ["primary", "fast", "deep"],
      source,
      "models.",
      diagnostics,
    );
  if (verification)
    reportUnknownKeys(
      verification,
      ["typecheck", "test", "verify"],
      source,
      "verification.",
      diagnostics,
    );

  if (ui?.theme !== undefined && ui.theme !== "aurora-night") {
    diagnostics.push({
      level: "error",
      source,
      message: "ui.theme muss aurora-night sein",
    });
  }

  next.ui.motion = enumValue(
    ui?.motion,
    ["contextual", "reduced", "off"],
    next.ui.motion,
    source,
    "ui.motion",
    diagnostics,
  );
  next.permissions.unknownTools = enumValue(
    permissions?.unknownTools,
    ["block", "ask", "allow"],
    next.permissions.unknownTools,
    source,
    "permissions.unknownTools",
    diagnostics,
  );
  next.permissions.bash = enumValue(
    permissions?.bash,
    ["block", "ask", "allow"],
    next.permissions.bash,
    source,
    "permissions.bash",
    diagnostics,
  );
  if (typeof lsp?.enabled === "boolean") next.lsp.enabled = lsp.enabled;
  next.lsp.mode = enumValue(
    lsp?.mode,
    ["off", "auto", "force"],
    next.lsp.mode,
    source,
    "lsp.mode",
    diagnostics,
  );
  next.lsp.requestTimeoutMs = boundedInt(
    lsp?.requestTimeoutMs,
    next.lsp.requestTimeoutMs,
    1_000,
    120_000,
    source,
    "lsp.requestTimeoutMs",
    diagnostics,
  );
  next.lsp.idleShutdownMs = boundedInt(
    lsp?.idleShutdownMs,
    next.lsp.idleShutdownMs,
    10_000,
    3_600_000,
    source,
    "lsp.idleShutdownMs",
    diagnostics,
  );
  next.subagents.concurrency = boundedInt(
    subagents?.concurrency,
    next.subagents.concurrency,
    1,
    8,
    source,
    "subagents.concurrency",
    diagnostics,
  );
  if (typeof subagents?.freshContext === "boolean")
    next.subagents.freshContext = subagents.freshContext;

  for (const role of ["primary", "fast", "deep"] as const) {
    const value = models?.[role];
    if (typeof value === "string" && value.trim())
      next.models[role] = value.trim();
  }

  for (const name of ["typecheck", "test", "verify"] as const) {
    const rawCheck = verification?.[name];
    if (!isObject(rawCheck)) continue;
    reportUnknownKeys(
      rawCheck,
      ["command", "args", "timeoutMs"],
      source,
      `verification.${name}.`,
      diagnostics,
    );
    const command = rawCheck.command;
    const args = rawCheck.args;
    const timeoutMs = rawCheck.timeoutMs;
    if (
      typeof command === "string" &&
      command.trim() &&
      Array.isArray(args) &&
      args.every((arg) => typeof arg === "string")
    ) {
      next.verification[name] = {
        command,
        args: [...args],
        timeoutMs: boundedInt(
          timeoutMs,
          next.verification[name].timeoutMs,
          1_000,
          900_000,
          source,
          `verification.${name}.timeoutMs`,
          diagnostics,
        ),
      };
    } else {
      diagnostics.push({
        level: "error",
        source,
        message: `verification.${name} must contain command and string args`,
      });
    }
  }
  return next;
}

const ACTION_RANK: Record<PolicyAction, number> = {
  block: 0,
  ask: 1,
  allow: 2,
};

function applyTrustedProjectLayer(
  base: SetupConfig,
  raw: Record<string, unknown>,
  source: string,
  diagnostics: ConfigDiagnostic[],
): SetupConfig {
  const candidate = applyUserLayer(base, raw, source, diagnostics);
  const projectPermissions = isObject(raw.permissions)
    ? raw.permissions
    : undefined;
  for (const key of ["unknownTools", "bash"] as const) {
    if (
      projectPermissions?.[key] !== undefined &&
      ACTION_RANK[candidate.permissions[key]] >
        ACTION_RANK[base.permissions[key]]
    ) {
      diagnostics.push({
        level: "warning",
        source,
        message: `Projektkonfiguration darf Berechtigungen.${key} nicht lockern; globaler Wert beibehalten`,
      });
      candidate.permissions[key] = base.permissions[key];
    }
  }
  // A repository must never choose commands that execute on the host.
  candidate.verification = structuredClone(base.verification);
  candidate.models = structuredClone(base.models);
  candidate.subagents = structuredClone(base.subagents);
  return candidate;
}

export function loadSetupConfig(
  cwd: string,
  trusted: boolean,
): LoadedSetupConfig {
  const diagnostics: ConfigDiagnostic[] = [];
  const sources: string[] = [];
  const globalPath = join(getAgentDir(), "setup.json");
  const global = readObject(globalPath, diagnostics);
  let config = structuredClone(DEFAULT_CONFIG);
  if (global) {
    sources.push(globalPath);
    config = applyUserLayer(config, global, globalPath, diagnostics);
  }

  const projectPath = join(cwd, ".pi", "setup.json");
  if (trusted) {
    const project = readObject(projectPath, diagnostics);
    if (project) {
      sources.push(projectPath);
      config = applyTrustedProjectLayer(
        config,
        project,
        projectPath,
        diagnostics,
      );
    }
  } else if (existsSync(projectPath)) {
    diagnostics.push({
      level: "warning",
      source: projectPath,
      message: "ignored until the project is trusted",
    });
  }
  return { config, diagnostics, sources };
}

export function defaultSetupConfig(): SetupConfig {
  return structuredClone(DEFAULT_CONFIG);
}
