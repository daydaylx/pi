/**
 * Trust-gated project verification profiles (issue #105).
 *
 * This is the data-model + execution foundation for the universal verification
 * gate (#102). It is deliberately SEPARATE from the inviolable setup
 * verification in `extensions/setup-core/index.ts` (the `verify` tool that
 * always runs at the agent directory): a project — even a trusted one — can
 * never replace those setup commands. Instead, a trusted project may declare
 * its OWN project-level checks here, consumed by the future gate.
 *
 * Security properties:
 *   - `.pi/verify.json` is read ONLY when the project is trusted
 *     (same trust gate as `.pi/lsp.json`).
 *   - Execution uses `program` + an `args[]` array — never a shell string.
 *   - `cwd` must be relative and stay under the project root (no traversal).
 *   - `timeoutMs` is bounded; `env` is an additive map on top of `process.env`.
 *   - Schema validation is fail-closed: unknown keys or bad types drop the
 *     offending profile and produce a diagnostic.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { limitTextOutput } from "../shared/output-limits.ts";

const CONFIG_DIR_NAME = ".pi";
const CONFIG_FILE_NAME = "verify.json";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 900_000;
const MAX_ARGS = 64;

export interface VerificationProfile {
  /** Executable name, resolved via PATH. Never a shell string. */
  program: string;
  /** Arguments, passed verbatim and separately (no shell construction). */
  args: string[];
  /** Working directory, relative to the project root. Defaults to ".". */
  cwd: string;
  /** Hard timeout in milliseconds. Bounded to [1000, 900000]. */
  timeoutMs: number;
  /** If true, the future gate treats a failure as blocking. Default true. */
  required: boolean;
  /** Additive environment overrides on top of `process.env`. */
  env: Record<string, string>;
  /**
   * If true, the profile only runs in trusted projects. Default true.
   * (Redundant with the load-time trust gate, but explicit and auditable.)
   */
  trustRequired: boolean;
}

export interface ProfileDiagnostic {
  level: "error" | "warning";
  source: string;
  message: string;
}

export interface LoadedProfiles {
  profiles: Record<string, VerificationProfile>;
  diagnostics: ProfileDiagnostic[];
  source?: string;
}

export interface ExecOptions {
  cwd: string;
  timeout: number;
  env: Record<string, string>;
  signal?: unknown;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

/**
 * Spawn-like function. Injected so tests stay deterministic; production wires
 * `pi.exec` (or a thin adapter) in. Must never construct a shell string.
 */
export type ExecFn = (
  program: string,
  args: string[],
  options: ExecOptions,
) => Promise<ExecResult> | ExecResult;

export interface RunProfileOptions {
  projectRoot: string;
  signal?: unknown;
  exec: ExecFn;
}

export interface RunProfileResult {
  ok: boolean;
  exitCode: number | null;
  killed: boolean;
  durationMs: number;
  output: string;
  error?: { kind: "missing_binary" | "timeout" | "spawn_failed"; message: string };
  truncation?: ReturnType<typeof limitTextOutput>["truncation"];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/** Resolve and bound a profile cwd; reject absolute or escaping paths. */
export function resolveProfileCwd(
  projectRoot: string,
  cwd: string,
): string | null {
  if (isAbsolute(cwd)) return null;
  const resolved = resolve(projectRoot, cwd);
  const rel = relative(projectRoot, resolved);
  // rel === "" means the project root itself (allowed). ".." means escape.
  if (rel !== "" && rel.startsWith("..")) return null;
  // Also reject path segments that resolve outside via symlink-ish ".." parts.
  if (rel.split(/[\\/]/).some((segment) => segment === "..")) return null;
  return resolved;
}

/**
 * Validate a single raw profile entry. Returns the normalized profile, or
 * `null` plus a pushed diagnostic on any schema violation (fail-closed).
 */
function validateProfile(
  id: string,
  raw: unknown,
  source: string,
  diagnostics: ProfileDiagnostic[],
): VerificationProfile | null {
  if (!isObject(raw)) {
    diagnostics.push({
      level: "error",
      source,
      message: `profiles.${id} must be an object`,
    });
    return null;
  }
  // Fail-closed on unknown keys (auditability). Drop the whole profile if
  // it declares anything outside the schema — a typo must not silently run.
  const allowed = [
    "program",
    "args",
    "cwd",
    "timeoutMs",
    "required",
    "env",
    "trustRequired",
  ];
  let hadUnknownKey = false;
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      hadUnknownKey = true;
      diagnostics.push({
        level: "error",
        source,
        message: `profiles.${id}: unbekannter Schlüssel '${key}'`,
      });
    }
  }
  if (hadUnknownKey) return null;

  const program = raw.program;
  if (typeof program !== "string" || program.trim() === "") {
    diagnostics.push({
      level: "error",
      source,
      message: `profiles.${id}.program muss ein nicht-leerer String sein`,
    });
    return null;
  }

  const args = raw.args;
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    diagnostics.push({
      level: "error",
      source,
      message: `profiles.${id}.args muss ein String-Array sein`,
    });
    return null;
  }
  if (args.length > MAX_ARGS) {
    diagnostics.push({
      level: "error",
      source,
      message: `profiles.${id}.args überschreitet die Maximallänge ${MAX_ARGS}`,
    });
    return null;
  }

  let cwd = ".";
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== "string" || raw.cwd.trim() === "") {
      diagnostics.push({
        level: "error",
        source,
        message: `profiles.${id}.cwd muss ein nicht-leerer String sein`,
      });
      return null;
    }
    cwd = raw.cwd;
  }

  let timeoutMs = 120_000;
  if (raw.timeoutMs !== undefined) {
    if (
      typeof raw.timeoutMs !== "number" ||
      !Number.isInteger(raw.timeoutMs) ||
      raw.timeoutMs < MIN_TIMEOUT_MS ||
      raw.timeoutMs > MAX_TIMEOUT_MS
    ) {
      diagnostics.push({
        level: "error",
        source,
        message: `profiles.${id}.timeoutMs muss eine ganze Zahl ${MIN_TIMEOUT_MS}..${MAX_TIMEOUT_MS} sein`,
      });
      return null;
    }
    timeoutMs = raw.timeoutMs;
  }

  const required = raw.required === undefined ? true : Boolean(raw.required);

  let env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (!isStringRecord(raw.env)) {
      diagnostics.push({
        level: "error",
        source,
        message: `profiles.${id}.env muss ein String→String-Objekt sein`,
      });
      return null;
    }
    env = { ...raw.env };
  }

  const trustRequired = raw.trustRequired === undefined ? true : Boolean(raw.trustRequired);

  return {
    program,
    args: [...args],
    cwd,
    timeoutMs,
    required,
    env,
    trustRequired,
  };
}

/**
 * Load project verification profiles. The file is consulted ONLY when
 * `trusted` is true; otherwise it is reported and ignored.
 */
export function loadVerifyProfiles(
  cwd: string,
  trusted: boolean,
): LoadedProfiles {
  const diagnostics: ProfileDiagnostic[] = [];
  const profiles: Record<string, VerificationProfile> = {};
  const configPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    return { profiles, diagnostics };
  }
  if (!trusted) {
    diagnostics.push({
      level: "warning",
      source: configPath,
      message: `${CONFIG_FILE_NAME} ignored until the project is trusted`,
    });
    return { profiles, diagnostics };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    diagnostics.push({
      level: "error",
      source: configPath,
      message: `failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { profiles, diagnostics, source: configPath };
  }
  if (!isObject(parsed)) {
    diagnostics.push({
      level: "error",
      source: configPath,
      message: `${CONFIG_FILE_NAME} muss ein JSON-Objekt sein`,
    });
    return { profiles, diagnostics, source: configPath };
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "profiles") {
      diagnostics.push({
        level: "error",
        source: configPath,
        message: `unbekannter Schlüssel '${key}'`,
      });
    }
  }
  const rawProfiles = isObject(parsed.profiles) ? parsed.profiles : undefined;
  if (rawProfiles === undefined) {
    if (parsed.profiles !== undefined) {
      diagnostics.push({
        level: "error",
        source: configPath,
        message: "'profiles' muss ein Objekt sein",
      });
    }
    return { profiles, diagnostics, source: configPath };
  }
  for (const [id, raw] of Object.entries(rawProfiles)) {
    const profile = validateProfile(id, raw, configPath, diagnostics);
    if (profile) profiles[id] = profile;
  }
  return { profiles, diagnostics, source: configPath };
}

/**
 * Execute a single profile. Uses the injected `exec` (spawn-like, no shell).
 * Captures exit code, timeout, duration and limited output deterministically.
 */
export async function runProfile(
  profile: VerificationProfile,
  options: RunProfileOptions,
): Promise<RunProfileResult> {
  const boundedCwd = resolveProfileCwd(options.projectRoot, profile.cwd);
  if (boundedCwd === null) {
    return {
      ok: false,
      exitCode: null,
      killed: false,
      durationMs: 0,
      output: "",
      error: {
        kind: "spawn_failed",
        message: `cwd '${profile.cwd}' verlässt den Projekt-Root`,
      },
    };
  }
  const env: Record<string, string> = {};
  // process.env may contain undefined values; keep only string entries so the
  // exec contract stays Record<string, string>, then overlay profile env.
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  for (const [k, v] of Object.entries(profile.env)) {
    env[k] = v;
  }
  const start = Date.now();
  let result: ExecResult;
  try {
    result = await options.exec(profile.program, profile.args, {
      cwd: boundedCwd,
      timeout: profile.timeoutMs,
      env,
      signal: options.signal,
    });
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const kind: "missing_binary" | "spawn_failed" =
      lower.includes("enoent") || lower.includes("spawn")
        ? "missing_binary"
        : "spawn_failed";
    return {
      ok: false,
      exitCode: null,
      killed: false,
      durationMs,
      output: "",
      error: { kind, message },
    };
  }
  const durationMs = Date.now() - start;
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const limited = limitTextOutput(combined || "(keine Ausgabe)");
  const killed = Boolean(result.killed);
  const ok = result.code === 0 && !killed;
  const error: RunProfileResult["error"] = killed
    ? { kind: "timeout", message: `Zeitlimit ${profile.timeoutMs}ms überschritten` }
    : result.code !== 0
      ? { kind: "spawn_failed", message: `Exit-Code ${result.code}` }
      : undefined;
  return {
    ok,
    exitCode: result.code,
    killed,
    durationMs,
    output: limited.text,
    ...(limited.truncation ? { truncation: limited.truncation } : {}),
    ...(error ? { error } : {}),
  };
}
