import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { limitTextOutput } from "../shared/output-limits.ts";
import { loadSetupConfig, type VerificationName } from "./config.ts";

const CheckParams = Type.Object({
  check: Type.Union([
    Type.Literal("typecheck"),
    Type.Literal("test"),
    Type.Literal("verify"),
  ]),
});

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

  pi.on("session_start", (_event, ctx) => {
    activeCwd = ctx.cwd;
    trusted = ctx.isProjectTrusted();
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

  pi.registerCommand("setup-doctor", {
    description: "Effektive Setup-Konfiguration und Runtime-Konsistenz prüfen",
    handler: async (_args, ctx) => {
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
      const hasVersionDrift =
        String(declaredVersion ?? "") !== String(devVersion ?? "") ||
        (runtimeVersion !== undefined &&
          runtimeVersion !== String(declaredVersion ?? ""));
      const consistencyErrors: string[] = [];
      const enabledModels = Array.isArray(settings?.enabledModels)
        ? settings.enabledModels.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const modelRoles = Object.values(loaded.config.models);
      if (modelRoles.some((model) => !enabledModels.includes(model))) {
        consistencyErrors.push(
          "Zentrale Modellrollen fehlen in settings.enabledModels.",
        );
      }
      if (
        `${String(settings?.defaultProvider ?? "")}/${String(settings?.defaultModel ?? "")}` !==
        loaded.config.models.primary
      ) {
        consistencyErrors.push(
          "Das aktive Default-Modell entspricht nicht models.primary.",
        );
      }
      const subagentParallel = subagentSettings?.parallel as
        Record<string, unknown> | undefined;
      if (
        subagentParallel?.concurrency !== loaded.config.subagents.concurrency ||
        subagentSettings?.globalConcurrencyLimit !==
          loaded.config.subagents.concurrency
      ) {
        consistencyErrors.push(
          "Die aktive Subagenten-Parallelität weicht von setup.json ab.",
        );
      }
      const lines = [
        "Setup Doctor",
        `  config: ${loaded.sources.length ? loaded.sources.join(" → ") : "defaults"}`,
        `  project trust: ${trusted ? "trusted" : "untrusted"}`,
        `  theme/motion: ${loaded.config.ui.theme}/${loaded.config.ui.motion}`,
        `  permissions: unknown=${loaded.config.permissions.unknownTools}, bash=${loaded.config.permissions.bash}`,
        `  LSP: ${loaded.config.lsp.enabled ? loaded.config.lsp.mode : "off"}`,
        `  model roles: ${Object.values(loaded.config.models).join(" | ")}`,
        `  Pi CLI/dev package: ${runtimeVersion ?? "unknown"}/${String(declaredVersion ?? "?")}`,
        `  installed dev package: ${devVersion ?? "missing"}`,
        `  configured extensions: ${Array.isArray(settings?.extensions) ? settings.extensions.length : "?"}`,
      ];
      for (const diagnostic of loaded.diagnostics) {
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
