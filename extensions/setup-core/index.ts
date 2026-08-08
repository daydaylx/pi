import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { collectWorkspaceSnapshot } from "../../shared/workspace-snapshot.mjs";
import { Type } from "typebox";
import { limitTextOutput } from "../shared/output-limits.ts";
import { loadVerifyProfiles, runProfile } from "./verify-profiles.ts";
import { classifyCheckFailure } from "./check-baseline.ts";
import { loadSetupConfig, type VerificationName } from "./config.ts";
import {
  collectContextDiagnostics,
  formatContextDiagnostics,
} from "./context-diagnostics.ts";
import {
  evaluateCheckRun,
  formatVerificationStatus,
  mergeCheckRun,
  requiredCoverage,
  verificationStatus,
  type VerificationLedger,
  type VerificationStatus,
} from "./verification-status.ts";
import type { LoadedProfiles } from "./verify-profiles.ts";

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

/**
 * Every required profile the project declares — the set `verified` is measured
 * against. Untrusted projects declare nothing, so no run can ever verify them.
 */
function declaredRequiredIds(loaded: LoadedProfiles, trusted: boolean): string[] {
  if (!trusted) return [];
  return Object.entries(loaded.profiles)
    .filter(([, profile]) => profile.classification === "required")
    .map(([id]) => id)
    .sort();
}

function coverageLine(covered: number, total: number, missing: string[]): string {
  if (total === 0)
    return "Pflichtabdeckung: keine Pflichtprüfung deklariert (kein Lauf kann verifizieren).";
  const head = `Pflichtabdeckung: ${covered}/${total}`;
  return missing.length === 0 ? head : `${head} — offen: ${missing.join(", ")}`;
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

export default function setupCore(pi: ExtensionAPI): void {
  let activeCwd = process.cwd();
  let trusted = false;
  let verificationLedger: VerificationLedger = {};
  let lastSettledStatus: VerificationStatus | undefined;
  // Session-scoped record of which profile ids have ever been observed
  // passing, independent of the workspace fingerprint (unlike
  // verificationLedger.lastRequiredCheck, which is discarded whenever the
  // fingerprint changes). This is the one genuine baseline
  // check-baseline.ts's `introduced` classification relies on: if a profile
  // passed earlier this session and now fails, that is a recorded
  // regression, not a guess. Same lifecycle as verificationLedger — reset on
  // session_start/session_shutdown, never persisted.
  let passedProfileIds: Set<string> = new Set();

  function workspaceSnapshot(cwd: string) {
    try {
      return collectWorkspaceSnapshot(cwd);
    } catch {
      return undefined;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    activeCwd = ctx.cwd;
    trusted = ctx.isProjectTrusted();
    verificationLedger = {};
    passedProfileIds = new Set();
    lastSettledStatus = undefined;
    if (ctx.hasUI) ctx.ui.setStatus("verification", undefined);
  });

  pi.on("agent_settled", (_event, ctx) => {
    const statusEnabled = loadSetupConfig(
      ctx.cwd,
      ctx.isProjectTrusted(),
    ).config.verificationStatus.enabled;
    if (!statusEnabled) {
      if (lastSettledStatus !== undefined && ctx.hasUI)
        ctx.ui.setStatus("verification", undefined);
      lastSettledStatus = undefined;
      return;
    }
    const profiles = loadVerifyProfiles(ctx.cwd, ctx.isProjectTrusted());
    const status = verificationStatus(
      workspaceSnapshot(ctx.cwd),
      verificationLedger,
      {
        declaredRequiredIds: declaredRequiredIds(
          profiles,
          ctx.isProjectTrusted(),
        ),
        workspaceRoot: ctx.cwd,
      },
    );
    if (status === lastSettledStatus || !ctx.hasUI) return;
    lastSettledStatus = status;
    ctx.ui.setStatus("verification", formatVerificationStatus(status));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    verificationLedger = {};
    passedProfileIds = new Set();
    lastSettledStatus = undefined;
    if (ctx.hasUI) ctx.ui.setStatus("verification", undefined);
  });

  pi.registerTool({
    name: "verify",
    label: "Verifizieren",
    description:
      "Führt ausschließlich einen vorkonfigurierten Typecheck, Testlauf oder die vollständige Verifikation dieses Setups aus. Akzeptiert keine freien Shell-Kommandos. Aktualisiert nicht den Verifikations-Footer/-Ledger eines Projekts — dafür ist project_check({ profile: \"verify\" }) der kanonische Weg.",
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

      // Capture before execution: a later workspace change must make this
      // check stale even if the command itself succeeds.
      const checkSnapshot = workspaceSnapshot(ctx.cwd);
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
        if (result.ok) passedProfileIds.add(profileId);
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
          ...(result.ok
            ? {}
            : {
                baseline: classifyCheckFailure(
                  result.output,
                  checkSnapshot?.changedFiles,
                  passedProfileIds.has(profileId),
                ),
              }),
        });
      }

      const required = declaredRequiredIds(loaded, ctx.isProjectTrusted());
      const evaluation = evaluateCheckRun(reports, required);
      if (checkSnapshot) {
        verificationLedger = mergeCheckRun(
          verificationLedger,
          evaluation,
          ctx.cwd,
          checkSnapshot.fingerprint,
        );
      }
      // Report accumulated coverage, not just this call's: the agent needs to
      // know what is still open. Nothing here runs a check on its own.
      const coverage = requiredCoverage(
        checkSnapshot ? verificationLedger.lastRequiredCheck : undefined,
        required,
      );

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
      const limited = limitTextOutput(
        `${text}\n\n${coverageLine(coverage.covered.length, coverage.total, coverage.missing)}`,
      );
      return {
        content: [{ type: "text" as const, text: limited.text }],
        details: {
          profiles: reports,
          availableProfileIds,
          diagnostics: loaded.diagnostics,
          verification: {
            declaredRequiredIds: required,
            coveredRequiredIds: coverage.covered,
            missingRequiredIds: coverage.missing,
            blockingRecommendedIds: evaluation.blockingRecommendedIds,
            blocking: evaluation.blocking,
          },
          ...(limited.truncation ? { truncation: limited.truncation } : {}),
        },
        isError: evaluation.blocking,
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
      // P1-08: completeness of required profiles used to be visible only as
      // a passive agent_end notification (line ~231), gated on the project
      // having *changed*, and silent entirely when .pi/verify.json was
      // missing outright. /setup-doctor now surfaces both cases explicitly,
      // any time it is run.
      if (trusted && !projectProfiles.source) {
        lines.push(
          "  WARNING: Kein Projekt-Prüfprofil definiert (.pi/verify.json fehlt) — project_check kann nichts gegenprüfen.",
        );
      } else if (
        trusted &&
        projectProfiles.source &&
        declaredRequiredIds(projectProfiles, trusted).length === 0
      ) {
        lines.push(
          "  WARNING: Projekt-Prüfprofile enthalten keine Pflichtprüfung (classification: required) — kein Lauf kann als verifiziert gelten.",
        );
      }
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
