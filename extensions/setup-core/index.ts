import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { Type } from "typebox";
import { limitTextOutput } from "../shared/output-limits.ts";
import { loadVerifyProfiles, runProfile } from "./verify-profiles.ts";
import {
  compareMeasurements,
  fingerprint,
  loadPerformanceProfiles,
  measureProfile,
  recordExperiment,
  type ExperimentState,
  type MeasurementResult,
} from "./performance.ts";
import { loadProfilingProfiles, runProfilingProfile } from "./profiling.ts";
import { loadSetupConfig, type VerificationName } from "./config.ts";
import {
  collectContextDiagnostics,
  formatContextDiagnostics,
} from "./context-diagnostics.ts";

const CheckParams = Type.Object({
  check: Type.Union([
    Type.Literal("typecheck"),
    Type.Literal("test"),
    Type.Literal("verify"),
  ]),
});

const MAX_PROJECT_PROFILES_PER_CALL = 8;

const ProjectCheckParams = Type.Object({
  profile: Type.Optional(
    Type.String({
      minLength: 1,
      description: "ID eines einzelnen Projekt-Prüfprofils.",
    }),
  ),
  profiles: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: MAX_PROJECT_PROFILES_PER_CALL,
      description:
        "Kleine, geordnete Liste von Projekt-Prüfprofilen (maximal 8).",
    }),
  ),
});

const PerformanceMeasureParams = Type.Object({
  profile: Type.String({
    minLength: 1,
    description: "ID eines Performanceprofils aus .pi/performance.json.",
  }),
});

const PerformanceCompareParams = Type.Object({
  baseline: Type.String({ minLength: 1 }),
  candidate: Type.String({ minLength: 1 }),
});

const PerformanceStateParams = Type.Object({
  action: Type.Union([
    Type.Literal("show"),
    Type.Literal("record_attempt"),
    Type.Literal("reset"),
  ]),
  measurementId: Type.Optional(Type.String({ minLength: 1 })),
  correctness: Type.Optional(
    Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Literal("unknown"),
    ]),
  ),
  hypothesis: Type.Optional(Type.String({ maxLength: 240 })),
});

const PerformanceProfileParams = Type.Object({
  profile: Type.String({
    minLength: 1,
    description: "ID eines Profiling-Adapters aus .pi/profiling.json.",
  }),
});

interface ProjectCheckParamsValue {
  profile?: string;
  profiles?: string[];
}

function redactArgument(args: string[], index: number): string {
  const value = args[index] ?? "";
  const previous = args[index - 1] ?? "";
  const sensitiveName =
    /(?:token|secret|password|passwd|api[-_]?key|authorization)/i;
  if (
    sensitiveName.test(previous) ||
    sensitiveName.test(value.split("=", 1)[0])
  ) {
    return value.includes("=")
      ? `${value.split("=", 1)[0]}=[redacted]`
      : "[redacted]";
  }
  return value;
}

function profileCommandSummary(program: string, args: string[]): string {
  return [program, ...args.map((_, index) => redactArgument(args, index))]
    .map((part) => JSON.stringify(part))
    .join(" ");
}

function requestedProfileIds(
  params: ProjectCheckParamsValue,
): { ids: string[] } | { error: string } {
  if (params.profile !== undefined && params.profiles !== undefined) {
    return {
      error: "Bitte entweder 'profile' oder 'profiles' angeben, nicht beides.",
    };
  }
  const ids = params.profile !== undefined ? [params.profile] : params.profiles;
  if (!ids || ids.length === 0) {
    return { error: "Bitte mindestens ein Projekt-Prüfprofil angeben." };
  }
  if (ids.length > MAX_PROJECT_PROFILES_PER_CALL) {
    return {
      error: `Höchstens ${MAX_PROJECT_PROFILES_PER_CALL} Projekt-Prüfprofile pro Aufruf sind erlaubt.`,
    };
  }
  if (new Set(ids).size !== ids.length) {
    return {
      error: "Ein Projekt-Prüfprofil darf pro Aufruf nur einmal vorkommen.",
    };
  }
  return { ids };
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function packageVersion(path: string): string | undefined {
  const value = readJson(path)?.version;
  return typeof value === "string" ? value : undefined;
}

async function projectDiffFingerprint(
  pi: ExtensionAPI,
  cwd: string,
): Promise<{ fingerprint: string; changed: boolean }> {
  const result = await pi.exec("git", ["diff", "--no-ext-diff", "--binary"], {
    cwd,
    timeout: 10_000,
  });
  // Git may be unavailable or the directory may not be a repository. This is
  // intentionally conservative: no alleged check freshness in that case.
  if (result.code !== 0) return { fingerprint: "unavailable", changed: false };
  return {
    fingerprint: fingerprint(result.stdout),
    changed: result.stdout.length > 0,
  };
}

function compactMeasurement(result: MeasurementResult): string {
  const median =
    result.median === undefined ? "unavailable" : result.median.toFixed(3);
  return `${result.profileId}: median=${median} ${result.metric}, ${result.successfulRuns}/${result.plannedRuns} gültig${result.warnings.length ? `; ${result.warnings.join(" ")}` : ""}`;
}

export default function setupCore(pi: ExtensionAPI): void {
  let activeCwd = process.cwd();
  let trusted = false;
  const measurements = new Map<string, MeasurementResult>();
  let experiment: ExperimentState = { attempts: [] };
  let lastSuccessfulRequiredCheck:
    { diffFingerprint: string; profileIds: string[] } | undefined;

  pi.on("session_start", (_event, ctx) => {
    activeCwd = ctx.cwd;
    trusted = ctx.isProjectTrusted();
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    const profiles = loadVerifyProfiles(ctx.cwd, true);
    const required = Object.entries(profiles.profiles)
      .filter(([, profile]) => profile.classification === "required")
      .map(([id]) => id);
    if (required.length === 0) {
      if (profiles.source)
        ctx.ui.notify(
          "ℹ Projektprüfprofile enthalten keine Pflichtprüfung.",
          "info",
        );
      return;
    }
    const current = await projectDiffFingerprint(pi, ctx.cwd);
    if (!current.changed) return;
    if (!lastSuccessfulRequiredCheck) {
      ctx.ui.notify(
        "⚠ Projektänderungen vorhanden; seit der letzten Änderung wurde kein erfolgreicher Projekt-Check ausgeführt.",
        "warning",
      );
    } else if (
      lastSuccessfulRequiredCheck.diffFingerprint !== current.fingerprint
    ) {
      ctx.ui.notify(
        "⚠ Letzter Projekt-Check ist älter als der aktuelle Diff.",
        "warning",
      );
    }
  });

  pi.registerTool({
    name: "verify",
    label: "Verifizieren",
    description:
      "Führt ausschließlich einen vorkonfigurierten Typecheck, Testlauf oder die vollständige Verifikation aus. Akzeptiert keine freien Shell-Kommandos.",
    promptSnippet:
      "Run a configured typecheck, test, or full verification safely.",
    parameters: CheckParams,
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const loaded = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
      const spec = loaded.config.verification[params.check as VerificationName];
      // Verification is a capability of this setup, not a generic project
      // script runner. Keeping the cwd at the agent directory prevents an
      // active repository from replacing npm/package.json or lifecycle hooks.
      const result = await pi.exec(spec.command, spec.args, {
        cwd: getAgentDir(),
        timeout: spec.timeoutMs,
        signal,
      });
      const combined = [result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n");
      const limited = limitTextOutput(combined || "(keine Ausgabe)");
      return {
        content: [{ type: "text" as const, text: limited.text }],
        details: {
          check: params.check,
          exitCode: result.code,
          killed: result.killed,
          ...(limited.truncation ? { truncation: limited.truncation } : {}),
        },
        isError: result.code !== 0,
      };
    },
  });

  pi.registerTool({
    name: "performance_profile",
    label: "Performance profilieren",
    description:
      "Führt einen konfigurierten CPU- oder Compiler-Adapter aus und gibt nur verdichtete Befunde zurück.",
    promptSnippet:
      "Run a configured profiling adapter and return concise structured findings.",
    parameters: PerformanceProfileParams,
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const loaded = loadProfilingProfiles(ctx.cwd, ctx.isProjectTrusted());
      if (!ctx.isProjectTrusted() || !loaded.source)
        return {
          content: [
            {
              type: "text" as const,
              text: ctx.isProjectTrusted()
                ? "Kein Profilingprofil definiert: .pi/profiling.json fehlt."
                : ".pi/profiling.json wird nur in vertrauten Projekten ausgeführt.",
            },
          ],
          details: { diagnostics: loaded.diagnostics },
          isError: true,
        };
      const profile = loaded.profiles[params.profile];
      if (!profile)
        return {
          content: [
            {
              type: "text" as const,
              text: `Unbekanntes Profilingprofil: ${params.profile}`,
            },
          ],
          details: {
            availableProfileIds: Object.keys(loaded.profiles).sort(),
            diagnostics: loaded.diagnostics,
          },
          isError: true,
        };
      const diff = await projectDiffFingerprint(pi, ctx.cwd);
      const result = await runProfilingProfile(params.profile, profile, {
        projectRoot: ctx.cwd,
        inputFingerprint: fingerprint({ diff: diff.fingerprint, cwd: ctx.cwd }),
        signal,
        exec: (program, args, options) => pi.exec(program, args, options),
      });
      const headline = result.findings.length
        ? result.findings
            .map(
              (finding, index) =>
                `${index + 1}. ${finding.symbol} — ${finding.value} ${finding.unit}`,
            )
            .join("\n")
        : result.warnings.join(" ");
      return {
        content: [
          {
            type: "text" as const,
            text: `${result.adapter}: ${result.status}\n${headline}`,
          },
        ],
        details: result,
        isError: result.status !== "success",
      };
    },
  });

  pi.registerTool({
    name: "project_check",
    label: "Projekt prüfen",
    description:
      "Führt explizit angeforderte, vertrauensgebundene Profile aus .pi/verify.json aus. Akzeptiert keine freien Kommandos und ist kein Abschluss-Gate.",
    promptSnippet:
      "Run explicitly named trusted project verification profiles safely.",
    parameters: ProjectCheckParams,
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const requested = requestedProfileIds(params as ProjectCheckParamsValue);
      if ("error" in requested) {
        return {
          content: [{ type: "text" as const, text: requested.error }],
          details: { profiles: [] },
          isError: true,
        };
      }

      const loaded = loadVerifyProfiles(ctx.cwd, ctx.isProjectTrusted());
      const availableProfileIds = Object.keys(loaded.profiles).sort();
      if (!ctx.isProjectTrusted()) {
        return {
          content: [
            {
              type: "text" as const,
              text: ".pi/verify.json wird nur in vertrauten Projekten ausgeführt.",
            },
          ],
          details: {
            profiles: [],
            availableProfileIds: [],
            diagnostics: loaded.diagnostics,
          },
          isError: true,
        };
      }
      if (!loaded.source) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Kein Projekt-Prüfprofil definiert: .pi/verify.json fehlt. Dokumentation: docs/verify-profiles.md",
            },
          ],
          details: {
            profiles: [],
            availableProfileIds,
            diagnostics: loaded.diagnostics,
          },
          isError: true,
        };
      }

      const missingIds = requested.ids.filter((id) => !(id in loaded.profiles));
      if (missingIds.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unbekannte(s) Projekt-Prüfprofil(e): ${missingIds.join(", ")}. Verfügbar: ${availableProfileIds.join(", ") || "keine (Konfiguration prüfen)"}.`,
            },
          ],
          details: {
            profiles: [],
            availableProfileIds,
            diagnostics: loaded.diagnostics,
          },
          isError: true,
        };
      }

      const reports = [];
      for (const profileId of requested.ids) {
        const profile = loaded.profiles[profileId]!;
        const startedAt = new Date().toISOString();
        const result = await runProfile(profile, {
          projectRoot: ctx.cwd,
          signal,
          exec: (program, args, options) => pi.exec(program, args, options),
        });
        const finishedAt = new Date().toISOString();
        reports.push({
          profileId,
          command: {
            program: profile.program,
            args: profile.args.map((_, index) =>
              redactArgument(profile.args, index),
            ),
          },
          cwd: profile.cwd,
          classification: profile.classification,
          startedAt,
          finishedAt,
          status: result.ok ? "success" : (result.error?.kind ?? "failed"),
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          killed: result.killed,
          output: result.output,
          ...(result.truncation ? { truncation: result.truncation } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      }

      const text = reports
        .map((report) => {
          const exit =
            report.exitCode === null
              ? "kein Exit-Code"
              : `Exit-Code ${report.exitCode}`;
          return [
            `${report.profileId} [${report.classification}]: ${report.status} (${exit}, ${report.durationMs} ms)`,
            `  Kommando: ${profileCommandSummary(report.command.program, report.command.args)}`,
            `  cwd: ${report.cwd}`,
            `  Ausgabe: ${report.output}`,
          ].join("\n");
        })
        .join("\n\n");
      const limited = limitTextOutput(text);
      const blockingFailure = reports.some(
        (report) =>
          report.status !== "success" &&
          report.classification !== "advisory" &&
          !(
            report.classification === "recommended" &&
            report.status === "missing_binary"
          ),
      );
      const currentDiff = await projectDiffFingerprint(pi, ctx.cwd);
      const successfulRequired = reports.filter(
        (report) =>
          report.classification === "required" && report.status === "success",
      );
      if (
        !blockingFailure &&
        successfulRequired.length > 0 &&
        currentDiff.changed
      ) {
        lastSuccessfulRequiredCheck = {
          diffFingerprint: currentDiff.fingerprint,
          profileIds: successfulRequired.map((report) => report.profileId),
        };
      }
      return {
        content: [{ type: "text" as const, text: limited.text }],
        details: {
          profiles: reports,
          availableProfileIds,
          diagnostics: loaded.diagnostics,
          diffFingerprint: currentDiff.fingerprint,
          ...(limited.truncation ? { truncation: limited.truncation } : {}),
        },
        isError: blockingFailure,
      };
    },
  });

  pi.registerTool({
    name: "performance_measure",
    label: "Performance messen",
    description:
      "Führt ein vertrauensgebundenes Performanceprofil mit Warmups und einer Messserie shellfrei aus.",
    promptSnippet:
      "Measure a configured performance profile and return robust statistics.",
    parameters: PerformanceMeasureParams,
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const loaded = loadPerformanceProfiles(ctx.cwd, ctx.isProjectTrusted());
      if (!ctx.isProjectTrusted() || !loaded.source)
        return {
          content: [
            {
              type: "text" as const,
              text: ctx.isProjectTrusted()
                ? "Kein Performanceprofil definiert: .pi/performance.json fehlt."
                : ".pi/performance.json wird nur in vertrauten Projekten ausgeführt.",
            },
          ],
          details: { diagnostics: loaded.diagnostics },
          isError: true,
        };
      const profile = loaded.profiles[params.profile];
      if (!profile)
        return {
          content: [
            {
              type: "text" as const,
              text: `Unbekanntes Performanceprofil: ${params.profile}`,
            },
          ],
          details: {
            availableProfileIds: Object.keys(loaded.profiles).sort(),
            diagnostics: loaded.diagnostics,
          },
          isError: true,
        };
      const diff = await projectDiffFingerprint(pi, ctx.cwd);
      const result = await measureProfile(params.profile, profile, {
        projectRoot: ctx.cwd,
        sourceFingerprint: diff.fingerprint,
        signal,
        exec: (program, args, options) => pi.exec(program, args, options),
      });
      measurements.set(result.id, result);
      return {
        content: [{ type: "text" as const, text: compactMeasurement(result) }],
        details: result,
        isError: result.successfulRuns < 2,
      };
    },
  });

  pi.registerTool({
    name: "performance_compare",
    label: "Performance vergleichen",
    description:
      "Vergleicht zwei vorhandene, kompatible Messserien ohne freie Eingaben oder Shell-Aufrufe.",
    promptSnippet: "Compare two recorded performance measurements.",
    parameters: PerformanceCompareParams,
    executionMode: "sequential",
    async execute(_id, params) {
      const baseline = measurements.get(params.baseline);
      const candidate = measurements.get(params.candidate);
      if (!baseline || !candidate)
        return {
          content: [
            {
              type: "text" as const,
              text: "Baseline oder Kandidat ist in dieser Sitzung nicht vorhanden.",
            },
          ],
          details: {},
          isError: true,
        };
      try {
        const comparison = compareMeasurements(baseline, candidate);
        const change =
          comparison.percentChange === undefined
            ? "unavailable"
            : `${(comparison.percentChange * 100).toFixed(2)} %`;
        return {
          content: [
            {
              type: "text" as const,
              text: `Median: ${comparison.baselineMedian.toFixed(3)} → ${comparison.candidateMedian.toFixed(3)} (${change}); ${comparison.inconclusive ? "innerhalb der Messunsicherheit" : comparison.improved ? "Verbesserung" : "keine Verbesserung"}.${comparison.sourceChanged ? " Quelle unterschiedlich (bei Vorher/Nachher-Vergleich erwartet)." : ""}`,
            },
          ],
          details: comparison,
          isError: false,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                error instanceof Error
                  ? error.message
                  : "Messungen sind nicht vergleichbar.",
            },
          ],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "performance_state",
    label: "Performance-Experiment",
    description:
      "Verwaltet ausschließlich einen kleinen, sitzungslokalen Mess- und Entscheidungsstand.",
    promptSnippet:
      "Record or inspect the session-local performance experiment state.",
    parameters: PerformanceStateParams,
    executionMode: "sequential",
    async execute(_id, params) {
      if (params.action === "reset") {
        experiment = { attempts: [] };
        return {
          content: [
            {
              type: "text" as const,
              text: "Sitzungslokaler Experimentstand zurückgesetzt; Projektdateien bleiben unverändert.",
            },
          ],
          details: experiment,
          isError: false,
        };
      }
      if (params.action === "show")
        return {
          content: [
            {
              type: "text" as const,
              text: `Baseline: ${experiment.baseline?.id ?? "keine"}; best valid: ${experiment.best?.id ?? "keine"}; Versuche: ${experiment.attempts.length}.`,
            },
          ],
          details: experiment,
          isError: false,
        };
      const measurement = params.measurementId
        ? measurements.get(params.measurementId)
        : undefined;
      if (!measurement || !params.hypothesis || !params.correctness)
        return {
          content: [
            {
              type: "text" as const,
              text: "Für einen Versuch sind measurementId, hypothesis und correctness erforderlich.",
            },
          ],
          details: {},
          isError: true,
        };
      const attempt = recordExperiment(experiment, {
        hypothesis: params.hypothesis,
        measurement,
        correctness: params.correctness,
        diffFingerprint: measurement.sourceFingerprint,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `${attempt.id}: ${attempt.decision} – ${attempt.reason}`,
          },
        ],
        details: {
          attempt,
          baseline: experiment.baseline?.id,
          best: experiment.best?.id,
        },
        isError: false,
      };
    },
  });

  pi.registerCommand("setup-doctor", {
    description: catalogDescription("setup-doctor"),
    handler: async (args, ctx) => {
      const subcommand = args.trim();
      if (subcommand === "context") {
        const diagnostics = collectContextDiagnostics({
          registeredTools: pi.getAllTools(),
          activeToolNames: pi.getActiveTools(),
          systemPrompt: ctx.getSystemPrompt(),
          sessionEntries: ctx.sessionManager.getEntries(),
        });
        ctx.ui.notify(formatContextDiagnostics(diagnostics), "info");
        return;
      }
      if (subcommand) {
        ctx.ui.notify("Usage: /setup-doctor [context]", "error");
        return;
      }
      activeCwd = ctx.cwd;
      trusted = ctx.isProjectTrusted();
      const loaded = loadSetupConfig(activeCwd, trusted);
      const agentDir = getAgentDir();
      const devVersion = packageVersion(
        join(
          agentDir,
          "npm",
          "node_modules",
          "@earendil-works",
          "pi-coding-agent",
          "package.json",
        ),
      );
      const npmManifest = readJson(join(agentDir, "npm", "package.json"));
      const declaredVersion = (
        npmManifest?.devDependencies as Record<string, unknown> | undefined
      )?.["@earendil-works/pi-coding-agent"];
      const settings = readJson(join(agentDir, "settings.json"));
      const subagentSettings = readJson(
        join(agentDir, "extensions", "subagent", "config.json"),
      );
      const runtimeResult = await pi.exec("pi", ["--version"], {
        cwd: activeCwd,
        timeout: 5_000,
      });
      const runtimeVersion =
        runtimeResult.code === 0
          ? runtimeResult.stdout.trim().replace(/^v/, "")
          : undefined;
      const projectProfiles = loadVerifyProfiles(activeCwd, trusted);
      const profileCount = Object.keys(projectProfiles.profiles).length;
      const profileHint = projectProfiles.source
        ? trusted
          ? `${profileCount} Profil(e) geladen`
          : ".pi/verify.json ignoriert (untrusted)"
        : "keine .pi/verify.json";
      const hasVersionDrift =
        String(declaredVersion ?? "") !== String(devVersion ?? "") ||
        (runtimeVersion !== undefined &&
          runtimeVersion !== String(declaredVersion ?? ""));
      const consistencyErrors: string[] = [];
      const hasCommandRuntime =
        typeof (
          ctx.ui as typeof ctx.ui & {
            submitSlashCommand?: unknown;
          }
        ).submitSlashCommand === "function";
      if (!hasCommandRuntime) {
        consistencyErrors.push(
          "Der Runtime-Einstieg submitSlashCommand für Command Center und Shortcuts fehlt.",
        );
      }
      const enabledModels = Array.isArray(settings?.enabledModels)
        ? settings.enabledModels.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const subagentParallel = subagentSettings?.parallel as
        Record<string, unknown> | undefined;
      if (
        subagentParallel?.concurrency !== loaded.config.subagents.concurrency ||
        subagentSettings?.globalConcurrencyLimit !==
          loaded.config.subagents.concurrency
      ) {
        consistencyErrors.push(
          "Die aktive Paket-Parallelität weicht von der Setup-Basis ab.",
        );
      }
      const lines = [
        "Setup Doctor",
        `  config: ${loaded.sources.length ? loaded.sources.join(" → ") : "defaults"}`,
        `  project trust: ${trusted ? "trusted" : "untrusted"}`,
        `  theme/motion: ${loaded.config.ui.theme}/${loaded.config.ui.motion}`,
        `  permissions: unknown=${loaded.config.permissions.unknownTools}, bash=${loaded.config.permissions.bash}`,
        `  workflow defaults: work=${loaded.config.permissions.workflowDefaults.work}, simple_plan=${loaded.config.permissions.workflowDefaults.simple_plan}, detailed_plan=${loaded.config.permissions.workflowDefaults.detailed_plan}`,
        `  LSP: ${loaded.config.lsp.enabled ? loaded.config.lsp.mode : "off"}`,
        `  subagent baseline (setup.json): concurrency=${loaded.config.subagents.concurrency}`,
        `  active subagent package config: concurrency=${String(subagentParallel?.concurrency ?? "missing")}, globalConcurrencyLimit=${String(subagentSettings?.globalConcurrencyLimit ?? "missing")}`,
        `  scoped models: ${enabledModels.length || 0} Pattern(s) in settings.enabledModels`,
        `  Pi CLI/dev package: ${runtimeVersion ?? "unknown"}/${String(declaredVersion ?? "?")}`,
        `  installed dev package: ${devVersion ?? "missing"}`,
        `  configured extensions: ${Array.isArray(settings?.extensions) ? settings.extensions.length : "?"}`,
        `  command runtime: ${hasCommandRuntime ? "available" : "missing"}`,
        `  project verification profiles: ${profileHint}`,
      ];
      for (const diagnostic of loaded.diagnostics) {
        lines.push(
          `  ${diagnostic.level.toUpperCase()}: ${diagnostic.message} (${diagnostic.source})`,
        );
      }
      for (const diagnostic of projectProfiles.diagnostics) {
        lines.push(
          `  ${diagnostic.level.toUpperCase()}: ${diagnostic.message} (${diagnostic.source})`,
        );
      }
      for (const message of consistencyErrors)
        lines.push(`  ERROR: ${message}`);
      if (hasVersionDrift) {
        lines.push(
          "  ERROR: Pi CLI, Manifest und installiertes Dev-Paket sind nicht angeglichen.",
        );
      }
      ctx.ui.notify(
        lines.join("\n"),
        hasVersionDrift ||
          consistencyErrors.length > 0 ||
          loaded.diagnostics.some((d) => d.level === "error")
          ? "error"
          : "info",
      );
    },
  });
}
