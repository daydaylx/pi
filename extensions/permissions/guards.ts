import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import { confirmAction } from "../shared/permission-dialog.ts";
import {
  decideBash,
  isSensitivePathIdentity,
  resolvePathScope,
} from "../shared/permission-policy.ts";
import { requestVerificationCapabilities } from "../shared/verification-capabilities.ts";
import {
  INTERACTIVE_SHELL_TOOL_NAME,
  interactiveShellCommand,
} from "../shared/interactive-shell-policy.ts";
import type { PermissionSession } from "./session-state.ts";
import {
  assessTemporaryAgentSpec,
  createParentRunAgentCounter,
  subagentLaunchCount,
  rewriteVerifySpecToVerifier,
} from "./temporary-agent-policy.ts";
import { decideTool } from "./tool-policy.ts";
import { assessBash, assessWorkflowTool } from "./workflow-policy.ts";
import {
  assessGitCommitVerifierGate,
  assessVerifierDelegation,
  normalizeVerifierDelegationInput,
} from "./verifier-policy.ts";
import { assessWebToolInput } from "./web-tools.ts";
import {
  systemOpenBashRisk,
  systemOpenFileRisk,
  type SystemOpenRisk,
} from "./system-open-policy.ts";
import { toolPath } from "./tool-event.ts";
import { loadVerifyProfiles } from "../setup-core/verify-profiles.ts";
import {
  getPiLaunchProfile,
  hasFrontendConfirmChannel,
  resolveSystemWorkspaceRoot,
} from "../shared/profile.ts";
import { systemBashNeedsApproval } from "../system-control/policy.ts";
import { auditSystemDenial } from "../system-control/audit.ts";
import { SYSTEM_CONTROL_TOOL_NAME_SET } from "../system-control/tool-names.ts";
import {
  canonicalWorkspaceRoot,
  gitWorkspaceRootForPath,
} from "../shared/workspace-scope.ts";

const READ_ONLY_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  ASK_USER_TOOL_NAME,
  "workspace_add",
];
/**
 * Stufen, auf denen das Systemprofil (`pis`) offen arbeitet: keine Trust-,
 * Scope- oder Pfadgrenzen, nur Vorab-Bestätigung für Löschen und andere
 * Risiken (system-open-policy.ts). readonly, confirm-all und headless bleiben
 * als ausdrücklich strengere Wahl unverändert.
 */
const SYSTEM_OPEN_LEVELS = new Set([
  "project-write",
  "yolo",
  "yolo-ask",
  "yolo-full",
]);
const NATIVE_FILE_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
]);
const NATIVE_WRITE_TOOLS = new Set(["write", "edit"]);
const SYSTEM_PROJECT_POLICY_CONFIGS = new Set([
  ".pi/setup.json",
  ".pi/verify.json",
]);

function isSystemProjectPolicyConfig(root: string, target: string): boolean {
  return SYSTEM_PROJECT_POLICY_CONFIGS.has(
    relative(root, target).split(sep).join("/"),
  );
}
// Custom-/MCP-Tools ohne path/filePath-Feld (z. B. subagent) hätten sonst ein
// leeres Subject und der Mensch würde blind bestätigen.
const MAX_INPUT_PREVIEW = 300;

function stopNonInteractive(ctx: ExtensionContext): { terminate?: true } {
  return ctx.mode !== "tui" && !ctx.hasUI ? { terminate: true } : {};
}

function quoteShellWord(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toolSubject(event: ToolCallEvent): string {
  if (
    event.toolName === "bash" ||
    event.toolName === INTERACTIVE_SHELL_TOOL_NAME
  ) {
    return event.toolName === INTERACTIVE_SHELL_TOOL_NAME
      ? interactiveShellCommand(event)
      : String((event.input as Record<string, unknown>).command ?? "");
  }
  const path = toolPath(event);
  if (path !== undefined) return `${event.toolName}: ${path}`;
  const preview = JSON.stringify(event.input ?? {}).slice(0, MAX_INPUT_PREVIEW);
  return `${event.toolName}: ${preview}`;
}

/**
 * Keep the native file operation on the identity that the policy inspected.
 * For an allowed in-project symlink (including a missing leaf below one),
 * passing the canonical target avoids reopening the alias after the check.
 * Hard-boundary failures return before this normalisation. This narrows, but
 * cannot eliminate, the residual TOCTOU window documented by the resolver.
 */
function normalizeNativeFileTarget(
  event: ToolCallEvent,
  cwd: string,
  additionalRoots: readonly string[] = [],
  systemFileRoots: readonly string[] = [],
): void {
  if (!NATIVE_FILE_TOOLS.has(event.toolName)) return;
  const input = event.input as Record<string, unknown>;
  const field = typeof input.path === "string" ? "path" : "filePath";
  const rawPath = input[field];
  if (typeof rawPath !== "string") return;

  const identity = resolvePathScope(rawPath, cwd, [
    ...additionalRoots,
    ...systemFileRoots,
  ]);
  if (
    identity.canonicalPath === undefined ||
    identity.canonicalPath === identity.lexicalPath
  ) {
    return;
  }
  if (event.toolName !== "read" && identity.scope !== "project") {
    return;
  }
  input[field] = identity.canonicalPath;
}

function stableInputIdentity(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableInputIdentity).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableInputIdentity(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

export function registerPermissionGuards(
  pi: ExtensionAPI,
  session: PermissionSession,
): void {
  // Limit pro Parent-Lauf: der Zähler wird mit jedem neuen Nutzer-Turn und
  // jeder neuen Sitzung zurückgesetzt und zählt nur freigegebene Starts.
  const parentRunAgents = createParentRunAgentCounter();
  let previousBlockedAction: string | undefined;
  let repeatedBlockedActionCount = 0;
  // Ein Block ohne UI beendet den Lauf (kein Dialog möglich). Im Print-Modus
  // bliebe sonst nur der Satz vor dem Tool-Aufruf als Ergebnis stehen.
  let headlessStop: string | undefined;
  pi.on("agent_start", () => {
    parentRunAgents.reset();
    headlessStop = undefined;
  });
  pi.on("agent_end", () => {
    if (headlessStop === undefined) return;
    const reason = headlessStop;
    headlessStop = undefined;
    process.stderr.write(
      `[pi] Lauf ohne UI wegen einer blockierten Aktion beendet: ${reason}\n`,
    );
    pi.appendEntry("permissions.headless-stop", { reason });
  });
  pi.on("session_start", () => {
    parentRunAgents.reset();
    previousBlockedAction = undefined;
    repeatedBlockedActionCount = 0;
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    const launches = subagentLaunchCount(event);
    if (getPiLaunchProfile() === "system") {
      parentRunAgents.commit(launches);
      return;
    }
    const limitReason = parentRunAgents.check(launches);
    if (limitReason) {
      const stop = stopNonInteractive(ctx);
      if (stop.terminate) headlessStop ??= `${event.toolName}: ${limitReason}`;
      return { block: true, ...stop, reason: limitReason };
    }
    let outcome = await guardToolCall(event, ctx);
    if (outcome?.block && SYSTEM_CONTROL_TOOL_NAME_SET.has(event.toolName)) {
      const auditError = await auditSystemDenial(event.toolName, event.input);
      if (auditError)
        outcome = {
          ...outcome,
          reason: `${outcome.reason ?? "Aktion abgelehnt."} ${auditError}`,
        };
    }
    if (outcome?.block) {
      let inputIdentity: string;
      try {
        inputIdentity = stableInputIdentity(event.input);
      } catch {
        inputIdentity = "<unserializable-input>";
      }
      const identity = createHash("sha256")
        .update(event.toolName)
        .update("\0")
        .update(inputIdentity)
        .update("\0")
        .update(outcome.reason ?? "")
        .digest("hex");
      repeatedBlockedActionCount =
        identity === previousBlockedAction ? repeatedBlockedActionCount + 1 : 1;
      previousBlockedAction = identity;
      if (repeatedBlockedActionCount >= 3) {
        outcome = {
          ...outcome,
          terminate: true,
          reason:
            `${outcome.reason} ` +
            `Derselbe Aufruf wurde ${repeatedBlockedActionCount} Mal ` +
            `identisch blockiert; dieser Tool-Lauf wird beendet. Behebe ` +
            `zuerst den Blockgrund oder nutze die genannte Alternative.`,
        };
      }
    } else {
      previousBlockedAction = undefined;
      repeatedBlockedActionCount = 0;
    }
    if (
      outcome?.block &&
      outcome.terminate &&
      ctx.mode !== "tui" &&
      !ctx.hasUI
    ) {
      headlessStop ??= `${event.toolName}: ${outcome.reason ?? "Aktion abgelehnt."}`;
    }
    if (!outcome?.block) parentRunAgents.commit(launches);
    return outcome;
  });

  /**
   * Vertragsprüfung von Delegationen (Verifier-Pflichtfelder, Spec-Grenzen).
   * Sie schützt kein Zielsystem, sondern die Form der Delegation, und gilt
   * deshalb unabhängig von Stufe und Profil.
   */
  const guardDelegationContract = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
    verificationRoot: string,
  ) => {
    // Ein verify-Spec wird vor der Verifier-Prüfung in den geprüften
    // Verifier-Aufruf übersetzt, damit Ticket, Dedup und Commit-Gate greifen.
    const verifyRewrite = rewriteVerifySpecToVerifier(event);
    if (verifyRewrite.kind === "blocked") {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: verifyRewrite.reason,
      };
    }
    if (verifyRewrite.kind === "rewritten") {
      const target = event.input as Record<string, unknown>;
      delete target.spec;
      Object.assign(target, verifyRewrite.input);
    }
    const verification = requestVerificationCapabilities(
      pi.events,
      verificationRoot,
    );
    const verifierAssessment = await assessVerifierDelegation(
      event,
      ctx.cwd,
      verification,
    );
    if (verifierAssessment.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: verifierAssessment.reason,
      };
    }
    const normalizedVerifierInput = await normalizeVerifierDelegationInput(
      event,
      ctx.cwd,
    );
    if (normalizedVerifierInput) {
      Object.assign(
        event.input as Record<string, unknown>,
        normalizedVerifierInput,
      );
    }
    const temporarySpecAssessment = assessTemporaryAgentSpec(event);
    if (temporarySpecAssessment.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: temporarySpecAssessment.reason,
      };
    }
    return undefined;
  };

  /** Fragt vorab nach; ohne Bestätigungskanal wird strukturiert blockiert. */
  const confirmSystemRisk = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
    risk: SystemOpenRisk,
  ) => {
    if (!ctx.hasUI) {
      return {
        block: true,
        terminate: true,
        reason: `Freigabe benötigt, aber im Modus "${ctx.mode}" nicht erfüllbar (kein Bestätigungsdialog verfügbar): ${risk.reason}`,
      };
    }
    const confirmed = await confirmAction(
      ctx,
      { action: "ask", reason: risk.reason },
      toolSubject(event),
      event.toolName,
    );
    return confirmed
      ? undefined
      : { block: true, reason: "Aktion vom Benutzer abgelehnt." };
  };

  /**
   * Systemprofil (`pis`): offen, nur Löschen und andere Risiken werden vorab
   * bestätigt. Trust-, Scope- und Pfadgrenzen entfallen bewusst.
   */
  const guardSystemOpen = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
  ) => {
    if (event.toolName === ASK_USER_TOOL_NAME && !ctx.hasUI) {
      return {
        block: true,
        terminate: true,
        reason: `ask_user ist im Modus "${ctx.mode}" nicht verfügbar; es steht kein interaktiver UI-Kanal zur Verfügung. Keine Rückfrage starten oder wiederholen.`,
      };
    }
    const webAssessment = assessWebToolInput(event);
    if (webAssessment.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: webAssessment.reason,
      };
    }
    const contractOutcome = await guardDelegationContract(event, ctx, ctx.cwd);
    if (contractOutcome) return contractOutcome;

    let risk: SystemOpenRisk | undefined;
    if (
      event.toolName === "bash" ||
      event.toolName === INTERACTIVE_SHELL_TOOL_NAME
    ) {
      risk = systemOpenBashRisk(
        event.toolName === INTERACTIVE_SHELL_TOOL_NAME
          ? interactiveShellCommand(event)
          : String((event.input as Record<string, unknown>).command ?? ""),
      );
    } else if (NATIVE_FILE_TOOLS.has(event.toolName)) {
      risk = systemOpenFileRisk(
        NATIVE_WRITE_TOOLS.has(event.toolName) ? "write" : "read",
        toolPath(event) ?? ".",
        ctx.cwd,
      );
    } else if (event.toolName === "project_check") {
      const input = event.input as Record<string, unknown>;
      if (typeof input.workspaceRoot === "string") {
        const root = canonicalWorkspaceRoot(
          resolve(ctx.cwd, input.workspaceRoot),
        );
        if (root) {
          const profiles = loadVerifyProfiles(root, true).profiles;
          const requestedIds =
            typeof input.profile === "string"
              ? [input.profile]
              : Array.isArray(input.profiles)
                ? input.profiles.filter(
                    (profileId): profileId is string =>
                      typeof profileId === "string",
                  )
                : [];
          const profileAssessments = requestedIds.flatMap((profileId) => {
            const profile = profiles[profileId];
            if (!profile) return [];
            const command = [profile.program, ...profile.args]
              .map(quoteShellWord)
              .join(" ");
            return [
              {
                commandRisk: systemOpenBashRisk(command),
                decision: decideBash("project-write", command, root),
              },
            ];
          });
          const blockedProfile = profileAssessments.find(
            ({ decision }) => decision.action === "block",
          );
          if (blockedProfile) {
            return {
              block: true,
              ...stopNonInteractive(ctx),
              reason: `Projekt-Prüfprofil blockiert: ${blockedProfile.decision.reason}`,
            };
          }
          const riskyProfiles = profileAssessments.flatMap(
            ({ commandRisk, decision }) => [
              ...(commandRisk ? [commandRisk.reason] : []),
              ...(decision.action === "ask" ? [decision.reason] : []),
            ],
          );
          if (riskyProfiles.length > 0) {
            risk = {
              reason: `Projekt-Prüfprofil erfordert Bestätigung: ${[...new Set(riskyProfiles)].join("; ")}`,
            };
          }
        }
      }
    } else if (SYSTEM_CONTROL_TOOL_NAME_SET.has(event.toolName)) {
      const decision = decideTool(
        session.level(),
        event,
        ctx.cwd,
        session.configured(),
      );
      if (decision.action === "block") {
        return {
          block: true,
          ...stopNonInteractive(ctx),
          reason: decision.reason,
        };
      }
      if (decision.action === "ask") risk = { reason: decision.reason };
    }
    return risk ? confirmSystemRisk(event, ctx, risk) : undefined;
  };

  const guardToolCall = async (event: ToolCallEvent, ctx: ExtensionContext) => {
    if (
      getPiLaunchProfile() === "system" &&
      SYSTEM_OPEN_LEVELS.has(session.level())
    ) {
      return guardSystemOpen(event, ctx);
    }
    let additionalRoots = session.additionalWorkspaceRoots();
    const systemProfile = getPiLaunchProfile() === "system";
    const systemWorkspaceRoot = systemProfile
      ? resolveSystemWorkspaceRoot(ctx.cwd)
      : undefined;
    let systemFileRoots = systemProfile ? session.systemFileRoots() : [];
    let scopedProjectRoot = ctx.cwd;
    let targetIdentity = toolPath(event)
      ? resolvePathScope(toolPath(event)!, ctx.cwd, additionalRoots)
      : NATIVE_FILE_TOOLS.has(event.toolName)
        ? resolvePathScope(".", ctx.cwd, additionalRoots)
        : undefined;

    if (
      systemProfile &&
      NATIVE_FILE_TOOLS.has(event.toolName) &&
      !systemWorkspaceRoot
    ) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason:
          "System-Dateizugriff gesperrt: ctx.cwd, PI_SYSTEM_WORKSPACE und der private Launcher-Workspace stimmen nicht kanonisch überein oder der Workspace ist nicht privat.",
      };
    }
    if (systemProfile && event.toolName === "workspace_add") {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason:
          "workspace_add erteilt im Systemprofil keinen Projekt-Trust. Einen externen Git-Root nur über den sichtbaren, sitzungsgebundenen Datei-Scope für native Dateiwerkzeuge freigeben.",
      };
    }
    if (
      systemProfile &&
      event.toolName === "project_check" &&
      !ctx.isProjectTrusted()
    ) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason:
          "project_check benötigt echten Projekt-Trust; ein System-Datei-Scope autorisiert weder Projekt-Setup noch Verifikationsprofile.",
      };
    }

    if (systemProfile && NATIVE_FILE_TOOLS.has(event.toolName)) {
      const path =
        toolPath(event) ??
        (event.toolName === "grep" ||
        event.toolName === "find" ||
        event.toolName === "ls"
          ? "."
          : undefined);
      if (!path || !targetIdentity) {
        return {
          block: true,
          ...stopNonInteractive(ctx),
          reason:
            "System-Datei-Scope benötigt ein eindeutig aufgelöstes natives Dateiziel.",
        };
      }
      const targetPath =
        targetIdentity.canonicalPath ?? targetIdentity.lexicalPath;
      const initialRoot =
        targetIdentity.workspaceRoot ??
        (targetIdentity.scope === "external"
          ? gitWorkspaceRootForPath(targetPath)
          : undefined);
      if (
        NATIVE_WRITE_TOOLS.has(event.toolName) &&
        initialRoot &&
        isSystemProjectPolicyConfig(initialRoot, targetPath)
      ) {
        return {
          block: true,
          ...stopNonInteractive(ctx),
          reason:
            "System-Datei-Scopes dürfen keine Projekt-Setup- oder Verifikationskonfiguration ändern.",
        };
      }
      if (targetIdentity.scope === "external") {
        if (!ctx.hasUI) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "Externer Datei-Scope benötigt eine sichtbare UI-Freigabe; dieser Modus hat keinen Bestätigungsdialog.",
          };
        }
        if (
          NATIVE_WRITE_TOOLS.has(event.toolName) &&
          session.level() === "readonly"
        ) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason: "Readonly erlaubt keinen externen Datei-Schreibscope.",
          };
        }
        if (session.level() === "headless") {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "Headless erlaubt keine externe Datei-Scope-Erweiterung, auch wenn ein UI-Kanal verfügbar ist.",
          };
        }
        if (
          isSensitivePathIdentity(path, targetIdentity) ||
          targetIdentity.symlinkEscape ||
          targetIdentity.targetKind === "other" ||
          (NATIVE_WRITE_TOOLS.has(event.toolName) &&
            targetIdentity.targetKind === "directory") ||
          targetIdentity.targetKind === "dangling-symlink"
        ) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "Externer Datei-Scope blockiert: Secret, Spezialdatei, Symlink-Escape oder nicht sicher aufgelöstes Ziel.",
          };
        }
        const candidateRoot = gitWorkspaceRootForPath(targetPath);
        if (!candidateRoot) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "Externer Datei-Scope benötigt einen erreichbaren Git-Root; Fremdroots ohne eindeutige Git-Wurzel bleiben gesperrt.",
          };
        }
        const approval = await session.authorizeSystemFileRoot(
          candidateRoot,
          ctx,
        );
        if (!approval.approved) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              approval.reason ?? "Externer Datei-Scope nicht freigegeben.",
          };
        }
        systemFileRoots = session.systemFileRoots();
        targetIdentity = resolvePathScope(path, ctx.cwd, [
          ...additionalRoots,
          ...systemFileRoots,
        ]);
        if (
          targetIdentity.workspaceRoot !== approval.root ||
          targetIdentity.scope !== "project" ||
          targetIdentity.symlinkEscape
        ) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "Externer Datei-Scope verworfen: Das native Ziel gehört nach der kanonischen Prüfung nicht zur bestätigten Git-Wurzel.",
          };
        }
      }
    }

    const systemFileScopeAllowed = Boolean(
      systemProfile &&
      systemWorkspaceRoot &&
      NATIVE_FILE_TOOLS.has(event.toolName) &&
      targetIdentity &&
      !targetIdentity.symlinkEscape &&
      targetIdentity.scope === "project" &&
      (targetIdentity.workspaceRoot === resolve(ctx.cwd) ||
        session.isSystemFileRoot(targetIdentity.workspaceRoot ?? "")),
    );

    if (event.toolName === "project_check") {
      const input = event.input as Record<string, unknown>;
      if (typeof input.workspaceRoot === "string") {
        const requestedRoot = canonicalWorkspaceRoot(
          resolve(ctx.cwd, input.workspaceRoot),
        );
        if (!requestedRoot) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "project_check benötigt eine erreichbare Verzeichniswurzel. Zusätzliche Projektwurzeln vorher mit workspace_add freigeben.",
          };
        }
        const currentRoot = canonicalWorkspaceRoot(ctx.cwd) ?? resolve(ctx.cwd);
        if (
          requestedRoot !== currentRoot &&
          !session.isAdditionalWorkspaceRoot(requestedRoot)
        ) {
          const approval = await session.authorizeWorkspaceRoot(
            requestedRoot,
            ctx,
          );
          if (!approval.approved || !approval.root) {
            return {
              block: true,
              ...stopNonInteractive(ctx),
              reason:
                approval.reason ??
                "Zusätzliche Projektwurzel wurde nicht freigegeben.",
            };
          }
        }
        input.workspaceRoot = requestedRoot;
        scopedProjectRoot = requestedRoot;
        additionalRoots = session.additionalWorkspaceRoots();
      }
    }

    if (
      (event.toolName === "write" || event.toolName === "edit") &&
      targetIdentity?.scope === "external" &&
      session.level() !== "yolo-full"
    ) {
      if (session.level() !== "readonly") {
        const candidateRoot = gitWorkspaceRootForPath(
          targetIdentity.canonicalPath ?? targetIdentity.lexicalPath,
        );
        if (candidateRoot && ctx.hasUI) {
          const approval = await session.authorizeWorkspaceRoot(
            candidateRoot,
            ctx,
          );
          if (!approval.approved) {
            return {
              block: true,
              reason: approval.reason ?? "Projektwurzel nicht freigegeben.",
            };
          }
          additionalRoots = session.additionalWorkspaceRoots();
          targetIdentity = resolvePathScope(
            toolPath(event)!,
            ctx.cwd,
            additionalRoots,
          );
        }
      }
    }

    const targetRootTrusted = Boolean(
      targetIdentity?.workspaceRoot &&
      session.isAdditionalWorkspaceRoot(targetIdentity.workspaceRoot),
    );
    const projectCheckRootTrusted =
      event.toolName === "project_check" &&
      (scopedProjectRoot ===
        (canonicalWorkspaceRoot(ctx.cwd) ?? resolve(ctx.cwd)) ||
        session.isAdditionalWorkspaceRoot(scopedProjectRoot));
    const systemFullAccessBypass =
      !systemProfile && session.level() === "yolo-full";
    // The System profile's private workspace is never project-trusted, which
    // used to block its shell outright. Behind a frontend host a person can
    // confirm (not headless/readonly), so the shell stays available there: the
    // permission level and the protected-command check below still ask for
    // everything risky. The terminal profile (`pis`) keeps the hard boundary.
    const systemShellWithConfirmChannel =
      systemProfile &&
      hasFrontendConfirmChannel() &&
      Boolean(systemWorkspaceRoot) &&
      (event.toolName === "bash" ||
        event.toolName === INTERACTIVE_SHELL_TOOL_NAME) &&
      session.level() !== "headless" &&
      session.level() !== "readonly";
    if (
      !ctx.isProjectTrusted() &&
      !systemShellWithConfirmChannel &&
      !SYSTEM_CONTROL_TOOL_NAME_SET.has(event.toolName) &&
      !systemFullAccessBypass &&
      event.toolName !== "workspace_add" &&
      !targetRootTrusted &&
      !projectCheckRootTrusted &&
      !systemFileScopeAllowed
    ) {
      if (!READ_ONLY_TOOLS.includes(event.toolName)) {
        return {
          block: true,
          ...stopNonInteractive(ctx),
          reason:
            "Harte Trust-Grenze: mutierende oder externe Tools sind im nicht vertrauenswürdigen Projekt blockiert.",
        };
      }
      const path = toolPath(event);
      if (path) {
        const identity = resolvePathScope(
          path,
          ctx.cwd,
          session.additionalWorkspaceRoots(),
        );
        if (identity.scope !== "project" || identity.symlinkEscape) {
          return {
            block: true,
            ...stopNonInteractive(ctx),
            reason:
              "Harte Trust-Grenze: Dateizugriff außerhalb des Projekts ist im nicht vertrauenswürdigen Projekt blockiert.",
          };
        }
      }
    }
    // Capability preflight: RPC/JSON/print have no channel for the native
    // ask_user dialog. Block before execution and terminate this tool batch so
    // the model cannot spend turns repeating an impossible question.
    if (event.toolName === ASK_USER_TOOL_NAME && !ctx.hasUI) {
      return {
        block: true,
        terminate: true,
        reason: `ask_user ist im Modus "${ctx.mode}" nicht verfügbar; es steht kein interaktiver UI-Kanal zur Verfügung. Keine Rückfrage starten oder wiederholen.`,
      };
    }
    if (event.toolName === "workspace_add" && !ctx.hasUI) {
      return {
        block: true,
        terminate: true,
        reason:
          "workspace_add benötigt eine interaktive UI-Freigabe; dieser Modus hat keinen Bestätigungsdialog.",
      };
    }
    // Profile preflight: a missing declaration has no safe command fallback.
    // This keeps the result visible and fail-closed without entering project
    // dependency preparation or falsely changing the verification ledger.
    if (
      event.toolName === "project_check" &&
      (ctx.isProjectTrusted() || projectCheckRootTrusted) &&
      !existsSync(join(scopedProjectRoot, ".pi", "verify.json"))
    ) {
      // Interaktiv (TUI) endet nur dieser Aufruf: der Agent arbeitet mit gezielten
      // Checks weiter und meldet die fehlende Verifikation. Nicht interaktiv
      // endet der Batch wie bei den anderen Sperren.
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason:
          'Kein Projekt-Prüfprofil definiert: .pi/verify.json fehlt. Es wird kein freies Prüfkommando geraten; zulässiger Prüfpfad: .pi/verify.json mit benanntem Profil anlegen und project_check erneut ausführen. Ohne Profil nicht erneut project_check aufrufen: mit gezielten Checks (direkt zugehöriger Test, Syntax-/Typecheck) weiterarbeiten und im Abschluss ausdrücklich "nicht über project_check verifiziert (kein Profil)" melden.',
      };
    }
    const filePolicyLevel =
      systemProfile &&
      NATIVE_FILE_TOOLS.has(event.toolName) &&
      session.level() === "yolo-full"
        ? "project-write"
        : session.level();
    const assessment = assessWorkflowTool(
      event,
      ctx.cwd,
      filePolicyLevel,
      additionalRoots,
      NATIVE_FILE_TOOLS.has(event.toolName) ? systemFileRoots : [],
    );
    if (assessment.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: assessment.reason,
      };
    }
    // Harte Web-Eingabegrenze: fetch_content nur http(s), kein auth.
    const webAssessment = assessWebToolInput(event);
    if (webAssessment.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: webAssessment.reason,
      };
    }
    const contractOutcome = await guardDelegationContract(
      event,
      ctx,
      event.toolName === "project_check" ? scopedProjectRoot : ctx.cwd,
    );
    if (contractOutcome) return contractOutcome;
    const verification = requestVerificationCapabilities(
      pi.events,
      event.toolName === "project_check" ? scopedProjectRoot : ctx.cwd,
    );
    // YOLO hebt die technische Commit-Gate-Pflicht (ADR 021) auf — bewusste
    // Lockerung, analog zu Claude Codes bypassPermissions-Modus. Die
    // Vollständigkeits-/Dedup-Prüfung der Delegation selbst (oben) bleibt
    // davon unberührt.
    const commitGate = await assessGitCommitVerifierGate(
      event,
      ctx.cwd,
      verification,
      session.level(),
    );
    if (commitGate.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: commitGate.reason,
      };
    }
    const decision = decideTool(
      filePolicyLevel,
      event,
      ctx.cwd,
      session.configured(),
      {
        allowOutsideProjectRead: assessment.allowOutsideProjectRead,
        additionalRoots,
        systemFileRoots: NATIVE_FILE_TOOLS.has(event.toolName)
          ? systemFileRoots
          : [],
      },
    );
    if (decision.action === "allow") {
      normalizeNativeFileTarget(
        event,
        ctx.cwd,
        additionalRoots,
        systemFileRoots,
      );
      return;
    }
    if (decision.action === "block") {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: decision.reason,
      };
    }
    // "ask" needs an interactive confirm dialog. Outside the TUI there is no
    // channel to show one on: confirmAction would fall through to
    // ctx.ui.confirm with an unspecified non-interactive answer instead of a
    // clear, structured outcome. Fail closed with a distinct, actionable
    // reason instead - this applies regardless of which permission level
    // produced the "ask" (the dedicated "headless" level converts most of
    // its own asks to block()/allow() already; this is the general net for
    // every level and every "ask" path, present and future).
    if (!ctx.hasUI) {
      return {
        block: true,
        terminate: true,
        reason: `Freigabe benötigt, aber im Modus "${ctx.mode}" nicht erfüllbar (kein Bestätigungsdialog verfügbar): ${decision.reason}`,
      };
    }
    const subject = toolSubject(event);
    const confirmed = await confirmAction(
      ctx,
      decision,
      subject,
      event.toolName,
    );
    if (!confirmed) {
      return { block: true, reason: "Aktion vom Benutzer abgelehnt." };
    }
    normalizeNativeFileTarget(event, ctx.cwd, additionalRoots, systemFileRoots);
  };

  // user_bash fires only for a `!`/`!!`-prefixed command the human types
  // directly (see @earendil-works/pi-coding-agent's UserBashEvent doc
  // comment) — never for the agent's own `bash` tool calls, which go
  // through tool_call above. The hard boundaries (assessBash) and the
  // chosen permission level (decideBash) still apply, same as any other
  // mode.
  pi.on("user_bash", async (event, ctx: ExtensionContext) => {
    if (getPiLaunchProfile() === "system") return;
    if (
      getPiLaunchProfile() === "system" &&
      SYSTEM_OPEN_LEVELS.has(session.level())
    ) {
      const risk = systemOpenBashRisk(event.command);
      if (!risk) return;
      const declined = (output: string) => ({
        result: {
          output,
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      });
      if (!ctx.hasUI)
        return declined(
          `Freigabe benötigt, aber nicht erfüllbar (kein Bestätigungsdialog): ${risk.reason}`,
        );
      const approved = await confirmAction(
        ctx,
        { action: "ask", reason: risk.reason },
        event.command,
        "bash",
      );
      return approved ? undefined : declined("Aktion vom Benutzer abgelehnt.");
    }
    if (
      !ctx.isProjectTrusted() &&
      (getPiLaunchProfile() === "system" || session.level() !== "yolo-full")
    ) {
      return {
        result: {
          output:
            "Harte Trust-Grenze: Shell-Zugriff ist im nicht vertrauenswürdigen Projekt blockiert.",
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
    const assessment = assessBash(event.command, session.level());
    if (assessment.blocked) {
      return {
        result: {
          output: assessment.reason,
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
    const decision = decideBash(session.level(), event.command, event.cwd);
    if (decision.action === "block") {
      return {
        result: {
          output: decision.reason,
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
    if (
      getPiLaunchProfile() === "system" &&
      systemBashNeedsApproval(event.command)
    ) {
      if (session.level() === "readonly" || session.level() === "headless") {
        return {
          result: {
            output: "Geschütztes Systemkommando ist in diesem Modus gesperrt.",
            exitCode: 126,
            cancelled: true,
            truncated: false,
          },
        };
      }
      if (!ctx.hasUI) {
        return {
          result: {
            output:
              "Geschütztes Systemkommando benötigt eine interaktive Freigabe.",
            exitCode: 126,
            cancelled: true,
            truncated: false,
          },
        };
      }
      const approval = await confirmAction(
        ctx,
        {
          action: "ask",
          reason:
            "Geschütztes Systemkommando benötigt eine ausdrückliche Freigabe.",
        },
        event.command,
        "bash",
      );
      if (!approval)
        return {
          result: {
            output: "Aktion vom Benutzer abgelehnt.",
            exitCode: 126,
            cancelled: true,
            truncated: false,
          },
        };
      return;
    }
    if (decision.action === "allow") return;
    const confirmed = await confirmAction(ctx, decision, event.command, "bash");
    if (!confirmed) {
      return {
        result: {
          output: "Aktion vom Benutzer abgelehnt.",
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
  });
}
