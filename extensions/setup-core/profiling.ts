/** Small, configured profiling adapters (#130). Raw artefacts stay in tmp. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProfileCwd, type ExecFn } from "./verify-profiles.ts";
import { fingerprint } from "./performance.ts";

export type ProfilerAdapterId = "node-cpu" | "compiler-diagnostics";
export interface ProfilingProfile { adapter: ProfilerAdapterId; program: string; args: string[]; cwd: string; timeoutMs: number; maxFindings: number; env: Record<string, string>; }
export interface ProfilingFinding { symbol: string; value: number; unit: string; location?: string; }
export interface ProfilingResult { profileId: string; adapter: ProfilerAdapterId; available: boolean; platform: string; status: "success" | "missing_binary" | "timeout" | "failed" | "no_data" | "unsupported"; durationMs: number; findings: ProfilingFinding[]; warnings: string[]; profileFingerprint: string; inputFingerprint: string; }

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export function loadProfilingProfiles(projectRoot: string, trusted: boolean): { profiles: Record<string, ProfilingProfile>; diagnostics: string[]; source?: string } {
  const source = join(projectRoot, ".pi", "profiling.json"); const diagnostics: string[] = [];
  if (!trusted) return { profiles: {}, diagnostics: existsSync(source) ? ["profiling.json wird bis zur Projektfreigabe ignoriert"] : [] };
  if (!existsSync(source)) return { profiles: {}, diagnostics };
  let data: unknown; try { data = JSON.parse(readFileSync(source, "utf8")); } catch { return { profiles: {}, diagnostics: ["profiling.json ist kein gültiges JSON"], source }; }
  if (!record(data) || !record(data.profiles) || Object.keys(data).some((key) => key !== "profiles")) return { profiles: {}, diagnostics: ["profiling.json erwartet ausschließlich ein profiles-Objekt"], source };
  const profiles: Record<string, ProfilingProfile> = {};
  for (const [id, raw] of Object.entries(data.profiles)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id) || !record(raw)) { diagnostics.push(`ungültiges Profil ${id}`); continue; }
    const allowed = new Set(["adapter", "program", "args", "cwd", "timeoutMs", "maxFindings", "env"]);
    if (Object.keys(raw).some((key) => !allowed.has(key))) { diagnostics.push(`profiles.${id} enthält unbekannte Schlüssel`); continue; }
    const adapter = raw.adapter; const program = raw.program; const args = raw.args;
    const cwd = raw.cwd === undefined ? "." : raw.cwd;
    const timeoutMs = raw.timeoutMs === undefined ? 120_000 : raw.timeoutMs;
    const maxFindings = raw.maxFindings === undefined ? 12 : raw.maxFindings;
    const env = raw.env === undefined ? {} : raw.env;
    const safeTimeoutMs = typeof timeoutMs === "number" ? timeoutMs : Number.NaN;
    const safeMaxFindings = typeof maxFindings === "number" ? maxFindings : Number.NaN;
    if ((adapter !== "node-cpu" && adapter !== "compiler-diagnostics") || typeof program !== "string" || !program || !Array.isArray(args) || args.some((arg) => typeof arg !== "string") || typeof cwd !== "string" || !Number.isInteger(safeTimeoutMs) || safeTimeoutMs < 1_000 || safeTimeoutMs > 900_000 || !Number.isInteger(safeMaxFindings) || safeMaxFindings < 1 || safeMaxFindings > 30 || !record(env) || Object.values(env).some((value) => typeof value !== "string")) { diagnostics.push(`profiles.${id} ist ungültig`); continue; }
    if (adapter === "node-cpu" && !/(?:^|\/)node(?:\.exe)?$/.test(program)) { diagnostics.push(`profiles.${id}: node-cpu verlangt das Node-Programm`); continue; }
    profiles[id] = { adapter, program, args, cwd, timeoutMs: safeTimeoutMs, maxFindings: safeMaxFindings, env: env as Record<string, string> };
  }
  return { profiles, diagnostics, source };
}

function summarizeNodeCpu(directory: string, maxFindings: number): ProfilingFinding[] {
  const file = readdirSync(directory).find((name) => name.endsWith(".cpuprofile"));
  if (!file) return [];
  let profile: { nodes?: Array<{ id?: number; callFrame?: { functionName?: string; url?: string; lineNumber?: number } }>; samples?: number[] };
  try { profile = JSON.parse(readFileSync(join(directory, file), "utf8")); } catch { return []; }
  const frames = new Map((profile.nodes ?? []).map((node) => [node.id, node.callFrame])); const counts = new Map<string, { value: number; location?: string }>();
  for (const id of profile.samples ?? []) { const frame = frames.get(id); const symbol = frame?.functionName || "(anonymous)"; const current = counts.get(symbol) ?? { value: 0, location: frame?.url ? `${frame.url}:${(frame.lineNumber ?? 0) + 1}` : undefined }; current.value += 1; counts.set(symbol, current); }
  return [...counts.entries()].map(([symbol, info]) => ({ symbol, value: info.value, unit: "samples", ...(info.location ? { location: info.location } : {}) })).sort((a, b) => b.value - a.value).slice(0, maxFindings);
}

function summarizeCompiler(text: string, maxFindings: number): ProfilingFinding[] {
  const findings: ProfilingFinding[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^(.+?:\d+(?::\d+)?):\s*(?:remark|note|warning):\s*(.+)$/i);
    if (match) findings.push({ symbol: match[2]!.slice(0, 180), value: 1, unit: "diagnostic", location: match[1] });
  }
  return findings.slice(0, maxFindings);
}

export async function runProfilingProfile(profileId: string, profile: ProfilingProfile, options: { projectRoot: string; inputFingerprint: string; signal?: AbortSignal; exec: ExecFn }): Promise<ProfilingResult> {
  const cwd = resolveProfileCwd(options.projectRoot, profile.cwd);
  if (!cwd) throw new Error("Profiling cwd escapes the project root.");
  if (profile.adapter === "node-cpu" && process.platform !== "linux" && process.platform !== "darwin" && process.platform !== "win32") return { profileId, adapter: profile.adapter, available: false, platform: process.platform, status: "unsupported", durationMs: 0, findings: [], warnings: ["Node CPU profiling wird auf dieser Plattform nicht unterstützt."], profileFingerprint: fingerprint(profile), inputFingerprint: options.inputFingerprint };
  const started = Date.now(); const rawDirectory = mkdtempSync(join(tmpdir(), "pi-profile-"));
  try {
    const args = profile.adapter === "node-cpu" ? [`--cpu-prof`, `--cpu-prof-dir=${rawDirectory}`, ...profile.args] : profile.args;
    let result;
    try { result = await options.exec(profile.program, args, { cwd, timeout: profile.timeoutMs, env: { ...profile.env }, signal: options.signal }); }
    catch (error) { const text = error instanceof Error ? error.message : String(error); const missing = /enoent|not found/i.test(text); return { profileId, adapter: profile.adapter, available: !missing, platform: process.platform, status: missing ? "missing_binary" : "failed", durationMs: Date.now() - started, findings: [], warnings: [missing ? "Profiler-Binary fehlt." : "Profilerprozess konnte nicht gestartet werden."], profileFingerprint: fingerprint(profile), inputFingerprint: options.inputFingerprint }; }
    const durationMs = Date.now() - started;
    if (result.killed) return { profileId, adapter: profile.adapter, available: true, platform: process.platform, status: "timeout", durationMs, findings: [], warnings: ["Profiler lief in ein Timeout."], profileFingerprint: fingerprint(profile), inputFingerprint: options.inputFingerprint };
    if (result.code !== 0) return { profileId, adapter: profile.adapter, available: true, platform: process.platform, status: "failed", durationMs, findings: [], warnings: ["Zielprogramm oder Profiler lieferte einen Fehlerstatus."], profileFingerprint: fingerprint(profile), inputFingerprint: options.inputFingerprint };
    const findings = profile.adapter === "node-cpu" ? summarizeNodeCpu(rawDirectory, profile.maxFindings) : summarizeCompiler(`${result.stdout}\n${result.stderr}`, profile.maxFindings);
    return { profileId, adapter: profile.adapter, available: true, platform: process.platform, status: findings.length ? "success" : "no_data", durationMs, findings, warnings: findings.length ? [] : ["Profiler lieferte keine auswertbaren Befunde."], profileFingerprint: fingerprint(profile), inputFingerprint: options.inputFingerprint };
  } finally { rmSync(rawDirectory, { recursive: true, force: true }); }
}
