/**
 * Trust-gated, shell-free performance measurement primitives (#127/#128).
 *
 * The extension owns orchestration; this module deliberately contains no Pi
 * API calls so the security and statistics rules are independently testable.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  resolveProfileCwd,
  type ExecFn,
  type RunProfileResult,
  type VerificationProfile,
} from "./verify-profiles.ts";

const FILE_NAME = "performance.json";
const MAX_WARMUPS = 8;
const MAX_RUNS = 30;
const MAX_TOTAL_RUNS = 32;
const MAX_TOTAL_TIMEOUT_MS = 1_800_000;
// Bumped whenever MeasurementResult's compatibility-relevant shape changes, so
// a hand-built or stale-process result fails closed instead of silently
// comparing against fields that no longer mean what they used to.
const MEASUREMENT_SCHEMA_VERSION = 2;

export type MetricSource = "process_duration_ms" | "json";
export type MetricDirection = "lower_is_better" | "higher_is_better";

export interface PerformanceProfile extends VerificationProfile {
  warmups: number;
  runs: number;
  metricSource: MetricSource;
  metric?: string;
  direction: MetricDirection;
  /**
   * Declared identity of the benchmarked input/dataset, distinct from the
   * source workspace's diff. Only ever read from trust-gated
   * `.pi/performance.json`, never from a free agent-supplied tool parameter.
   */
  inputId?: string;
}

export interface MeasurementSample {
  index: number;
  value?: number;
  durationMs: number;
  exitCode: number | null;
  status: "ok" | "failed" | "timeout" | "missing_binary" | "invalid_metric";
}

export interface MeasurementResult {
  id: string;
  profileId: string;
  metric: string;
  direction: MetricDirection;
  warmups: MeasurementSample[];
  samples: MeasurementSample[];
  successfulRuns: number;
  plannedRuns: number;
  median?: number;
  mean?: number;
  min?: number;
  max?: number;
  standardDeviation?: number;
  relativeDeviation?: number;
  totalDurationMs: number;
  timedOut: boolean;
  /** Exact profile config (command, args, protocol settings). */
  profileFingerprint: string;
  /**
   * Stable identity of what is being benchmarked: command, args, declared
   * dataset (`inputId`) and metric config. Deliberately excludes the source
   * workspace's diff — a benchmarked code change is expected to alter the
   * diff without making baseline and candidate incomparable.
   */
  benchmarkInputFingerprint: string;
  /**
   * Identity of the source/workspace state (commit/diff) at measurement
   * time. Shown for traceability but never part of the compatibility gate.
   */
  sourceFingerprint: string;
  resultSchemaVersion: number;
  warnings: string[];
}

export interface LoadedPerformanceProfiles {
  profiles: Record<string, PerformanceProfile>;
  diagnostics: string[];
  source?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * Identity of what is being benchmarked (command, args, declared dataset,
 * metric config) — everything a comparable before/after pair must share.
 * Deliberately independent of the source workspace's diff: a benchmarked
 * code change changes the diff without changing what is being measured.
 */
function benchmarkInputFingerprintOf(
  profileId: string,
  profile: PerformanceProfile,
): string {
  return fingerprint({
    profileId,
    program: profile.program,
    args: profile.args,
    cwd: profile.cwd,
    env: profile.env,
    metricSource: profile.metricSource,
    metric: profile.metric ?? null,
    inputId: profile.inputId ?? null,
  });
}

function parseProfile(
  id: string,
  value: unknown,
  diagnostics: string[],
): PerformanceProfile | null {
  if (!isRecord(value)) {
    diagnostics.push(`profiles.${id} muss ein Objekt sein`);
    return null;
  }
  const allowed = new Set([
    "program",
    "args",
    "cwd",
    "timeoutMs",
    "env",
    "warmups",
    "runs",
    "metricSource",
    "metric",
    "direction",
    "inputId",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    diagnostics.push(`profiles.${id} enthält unbekannte Schlüssel`);
    return null;
  }
  const program = value.program;
  const args = value.args;
  const cwd = value.cwd === undefined ? "." : value.cwd;
  const timeoutMs = value.timeoutMs === undefined ? 120_000 : value.timeoutMs;
  const env = value.env === undefined ? {} : value.env;
  const warmups = value.warmups === undefined ? 2 : value.warmups;
  const runs = value.runs === undefined ? 7 : value.runs;
  const metricSource =
    value.metricSource === undefined
      ? "process_duration_ms"
      : value.metricSource;
  const metric = value.metric;
  const inputId = value.inputId;
  const direction =
    value.direction === undefined ? "lower_is_better" : value.direction;
  const safeTimeoutMs = typeof timeoutMs === "number" ? timeoutMs : Number.NaN;
  const safeWarmups = typeof warmups === "number" ? warmups : Number.NaN;
  const safeRuns = typeof runs === "number" ? runs : Number.NaN;
  if (
    typeof program !== "string" ||
    !program.trim() ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string")
  ) {
    diagnostics.push(`profiles.${id} braucht program und string args`);
    return null;
  }
  if (
    typeof cwd !== "string" ||
    isAbsolute(cwd) ||
    !Number.isInteger(safeTimeoutMs) ||
    safeTimeoutMs < 1_000 ||
    safeTimeoutMs > 900_000
  ) {
    diagnostics.push(
      `profiles.${id} hat cwd oder timeoutMs außerhalb der Grenzen`,
    );
    return null;
  }
  if (
    !isRecord(env) ||
    Object.values(env).some((entry) => typeof entry !== "string")
  ) {
    diagnostics.push(`profiles.${id}.env muss ein String-Objekt sein`);
    return null;
  }
  if (
    !Number.isInteger(safeWarmups) ||
    safeWarmups < 0 ||
    safeWarmups > MAX_WARMUPS ||
    !Number.isInteger(safeRuns) ||
    safeRuns < 2 ||
    safeRuns > MAX_RUNS ||
    safeWarmups + safeRuns > MAX_TOTAL_RUNS
  ) {
    diagnostics.push(`profiles.${id} überschreitet die Laufgrenzen`);
    return null;
  }
  if (metricSource !== "process_duration_ms" && metricSource !== "json") {
    diagnostics.push(`profiles.${id}.metricSource ist ungültig`);
    return null;
  }
  if (
    metricSource === "json" &&
    (typeof metric !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(metric))
  ) {
    diagnostics.push(
      `profiles.${id}.metric ist für JSON erforderlich und ungültig`,
    );
    return null;
  }
  if (direction !== "lower_is_better" && direction !== "higher_is_better") {
    diagnostics.push(`profiles.${id}.direction ist ungültig`);
    return null;
  }
  if (
    inputId !== undefined &&
    (typeof inputId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(inputId))
  ) {
    diagnostics.push(`profiles.${id}.inputId ist ungültig`);
    return null;
  }
  return {
    program,
    args,
    cwd,
    timeoutMs: safeTimeoutMs,
    env: env as Record<string, string>,
    warmups: safeWarmups,
    runs: safeRuns,
    metricSource,
    metric: metric as string | undefined,
    direction,
    inputId: inputId as string | undefined,
    classification: "advisory",
    required: false,
    trustRequired: true,
  };
}

export function loadPerformanceProfiles(
  projectRoot: string,
  trusted: boolean,
): LoadedPerformanceProfiles {
  const source = join(projectRoot, ".pi", FILE_NAME);
  const diagnostics: string[] = [];
  if (!trusted)
    return {
      profiles: {},
      diagnostics: existsSync(source)
        ? [`${FILE_NAME} wird bis zur Projektfreigabe ignoriert`]
        : [],
    };
  if (!existsSync(source)) return { profiles: {}, diagnostics };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(source, "utf8"));
  } catch {
    return {
      profiles: {},
      diagnostics: [`${FILE_NAME} ist kein gültiges JSON`],
      source,
    };
  }
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.profiles) ||
    Object.keys(parsed).some((key) => key !== "profiles")
  ) {
    return {
      profiles: {},
      diagnostics: [`${FILE_NAME} erwartet ausschließlich ein profiles-Objekt`],
      source,
    };
  }
  const profiles: Record<string, PerformanceProfile> = {};
  for (const [id, raw] of Object.entries(parsed.profiles)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
      diagnostics.push(`ungültige Profil-ID ${id}`);
      continue;
    }
    const profile = parseProfile(id, raw, diagnostics);
    if (profile) profiles[id] = profile;
  }
  return { profiles, diagnostics, source };
}

function numberAtPath(value: unknown, path: string): number | undefined {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : undefined;
}

function statistic(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const median =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const standardDeviation = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
  return {
    median,
    mean,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    standardDeviation,
    relativeDeviation: mean === 0 ? 0 : standardDeviation / Math.abs(mean),
  };
}

function runValue(
  profile: PerformanceProfile,
  result: RunProfileResult,
): number | undefined {
  if (!result.ok) return undefined;
  if (profile.metricSource === "process_duration_ms") return result.durationMs;
  try {
    return numberAtPath(JSON.parse(result.output), profile.metric!);
  } catch {
    return undefined;
  }
}

function sampleStatus(
  result: RunProfileResult,
  value: number | undefined,
): MeasurementSample["status"] {
  if (value !== undefined) return "ok";
  if (result.error?.kind === "timeout") return "timeout";
  if (result.error?.kind === "missing_binary") return "missing_binary";
  return result.ok ? "invalid_metric" : "failed";
}

export async function measureProfile(
  profileId: string,
  profile: PerformanceProfile,
  options: {
    projectRoot: string;
    sourceFingerprint: string;
    exec: ExecFn;
    signal?: AbortSignal;
  },
): Promise<MeasurementResult> {
  const started = Date.now();
  const samples: MeasurementSample[] = [];
  const warmups: MeasurementSample[] = [];
  const boundedCwd = resolveProfileCwd(options.projectRoot, profile.cwd);
  if (!boundedCwd)
    throw new Error("Performance profile cwd escapes the project root.");
  const run = async (index: number): Promise<MeasurementSample> => {
    const began = Date.now();
    let result: RunProfileResult;
    try {
      const { runProfile } = await import("./verify-profiles.ts");
      result = await runProfile(profile, {
        projectRoot: options.projectRoot,
        signal: options.signal,
        exec: options.exec,
      });
    } catch {
      return {
        index,
        durationMs: Date.now() - began,
        exitCode: null,
        status: "failed",
      };
    }
    const value = runValue(profile, result);
    return {
      index,
      value,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      status: sampleStatus(result, value),
    };
  };
  for (let index = 0; index < profile.warmups; index += 1)
    warmups.push(await run(index));
  for (let index = 0; index < profile.runs; index += 1) {
    if (Date.now() - started > MAX_TOTAL_TIMEOUT_MS) break;
    samples.push(await run(index));
  }
  const values = samples.flatMap((sample) =>
    sample.status === "ok" && sample.value !== undefined ? [sample.value] : [],
  );
  const warnings: string[] = [];
  if (values.length < profile.runs)
    warnings.push(
      "Unvollständige Messserie; fehlgeschlagene Läufe werden nicht als Messwert gezählt.",
    );
  const stats = values.length >= 2 ? statistic(values) : undefined;
  if (stats && stats.relativeDeviation > 0.1)
    warnings.push(
      "Hohe relative Streuung (>10 %); kein kleiner Unterschied ist belastbar.",
    );
  if (
    values.length >= 4 &&
    stats &&
    stats.max - stats.min > 3 * stats.standardDeviation
  )
    warnings.push("Die Serie enthält mögliche Ausreißer.");
  if (samples.some((sample) => sample.status === "timeout"))
    warnings.push("Mindestens ein Lauf lief in ein Timeout.");
  return {
    id: `${profileId}-${started}`,
    profileId,
    metric: profile.metric ?? "process_duration_ms",
    direction: profile.direction,
    warmups,
    samples,
    successfulRuns: values.length,
    plannedRuns: profile.runs,
    ...stats,
    totalDurationMs: Date.now() - started,
    timedOut: samples.some((sample) => sample.status === "timeout"),
    profileFingerprint: fingerprint(profile),
    benchmarkInputFingerprint: benchmarkInputFingerprintOf(profileId, profile),
    sourceFingerprint: options.sourceFingerprint,
    resultSchemaVersion: MEASUREMENT_SCHEMA_VERSION,
    warnings,
  };
}

export function compareMeasurements(
  baseline: MeasurementResult,
  candidate: MeasurementResult,
) {
  if (
    baseline.resultSchemaVersion !== MEASUREMENT_SCHEMA_VERSION ||
    candidate.resultSchemaVersion !== MEASUREMENT_SCHEMA_VERSION
  ) {
    throw new Error(
      "Mindestens ein Messresultat hat eine veraltete oder unbekannte Schemaversion und ist nicht vergleichbar.",
    );
  }
  if (
    baseline.profileFingerprint !== candidate.profileFingerprint ||
    baseline.benchmarkInputFingerprint !==
      candidate.benchmarkInputFingerprint ||
    baseline.direction !== candidate.direction
  ) {
    throw new Error(
      "Messungen haben inkompatible Profil-, Benchmark-Eingabe- oder Richtungs-Fingerprints.",
    );
  }
  if (baseline.median === undefined || candidate.median === undefined)
    throw new Error("Beide Messungen brauchen einen Median.");
  const absoluteDifference = candidate.median - baseline.median;
  const percentChange =
    baseline.median === 0
      ? undefined
      : absoluteDifference / Math.abs(baseline.median);
  const improved =
    baseline.direction === "lower_is_better"
      ? absoluteDifference < 0
      : absoluteDifference > 0;
  const uncertainty = Math.max(
    baseline.relativeDeviation ?? 1,
    candidate.relativeDeviation ?? 1,
  );
  return {
    baselineMedian: baseline.median,
    candidateMedian: candidate.median,
    absoluteDifference,
    percentChange,
    speedup:
      baseline.direction === "lower_is_better"
        ? baseline.median / candidate.median
        : candidate.median / baseline.median,
    improved,
    uncertainty,
    inconclusive:
      percentChange === undefined || Math.abs(percentChange) <= uncertainty,
    // A code change is expected to alter the source fingerprint; this is
    // surfaced for traceability, never treated as an incompatibility.
    sourceChanged: baseline.sourceFingerprint !== candidate.sourceFingerprint,
    baselineSourceFingerprint: baseline.sourceFingerprint,
    candidateSourceFingerprint: candidate.sourceFingerprint,
  };
}

export interface ExperimentAttempt {
  id: string;
  hypothesis: string;
  measurementId: string;
  correctness: "passed" | "failed" | "unknown";
  decision: "kept" | "rejected" | "inconclusive" | "unverified";
  diffFingerprint: string;
  reason: string;
  at: string;
}
export interface ExperimentState {
  baseline?: MeasurementResult;
  best?: MeasurementResult;
  attempts: ExperimentAttempt[];
}

export function recordExperiment(
  state: ExperimentState,
  input: {
    hypothesis: string;
    measurement: MeasurementResult;
    correctness: ExperimentAttempt["correctness"];
    diffFingerprint: string;
  },
): ExperimentAttempt {
  if (input.hypothesis.length > 240)
    throw new Error("Hypothese ist auf 240 Zeichen begrenzt.");
  let decision: ExperimentAttempt["decision"] = "unverified";
  let reason = "Korrektheitsprüfung fehlt.";
  if (!state.baseline) {
    state.baseline = input.measurement;
    decision = "kept";
    reason = "Gültige Baseline registriert.";
  } else if (input.correctness === "failed") {
    decision = "rejected";
    reason = "Kandidat ist nicht korrekt.";
  } else if (input.correctness !== "passed") {
    decision = "unverified";
  } else {
    try {
      const comparison = compareMeasurements(state.baseline, input.measurement);
      if (comparison.inconclusive) {
        decision = "inconclusive";
        reason = "Unterschied liegt innerhalb der Messunsicherheit.";
      } else if (comparison.improved) {
        decision = "kept";
        reason = "Korrekt und gegenüber der Baseline schneller.";
        if (
          !state.best ||
          compareMeasurements(state.best, input.measurement).improved
        )
          state.best = input.measurement;
      } else {
        decision = "rejected";
        reason = "Korrekt, aber nicht schneller als die Baseline.";
      }
    } catch {
      decision = "inconclusive";
      reason = "Messung ist nicht mit der Baseline vergleichbar.";
    }
  }
  const attempt = {
    id: `attempt-${state.attempts.length + 1}`,
    hypothesis: input.hypothesis,
    measurementId: input.measurement.id,
    correctness: input.correctness,
    decision,
    diffFingerprint: input.diffFingerprint,
    reason,
    at: new Date().toISOString(),
  };
  state.attempts.push(attempt);
  return attempt;
}
