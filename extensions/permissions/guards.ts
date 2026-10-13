import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import { confirmAction } from "../shared/permission-dialog.ts";
import { decideBash, resolvePathScope } from "../shared/permission-policy.ts";
import {
  RECOVERY_CAPABILITY_EVENTS,
  recoveryEffect,
  requestRecoveryStatus,
} from "../shared/recovery-capabilities.ts";
import { requestVerificationCapabilities } from "../shared/verification-capabilities.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import {
  INTERACTIVE_SHELL_TOOL_NAME,
  interactiveShellCommand,
} from "../shared/interactive-shell-policy.ts";
import type { PermissionSession } from "./session-state.ts";
import {
  assessTemporaryAgentSpec,
  createParentRunAgentCounter,
  subagentLaunchCount,
  planModeTemporarySpecAllowed,
  rewriteVerifySpecToVerifier,
} from "./temporary-agent-policy.ts";
import { decideTool } from "./tool-policy.ts";
import {
  assessBash,
  assessWorkflowTool,
  planModeMutationGuard,
} from "./workflow-policy.ts";
import {
  assessGitCommitVerifierGate,
  assessVerifierDelegation,
  normalizeVerifierDelegationInput,
} from "./verifier-policy.ts";
import { assessWebToolInput } from "./web-tools.ts";
import { toolPath } from "./tool-event.ts";
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
  "recovery_check",
];

/**
 * Das Recovery-Gate sperrt nach einem fehlgeschlagenen oder unterbrochenen
 * Turn mit möglicher Mutation genau die Werkzeuge, die den Workspace weiter
 * verändern könnten. `recovery_check` bleibt als Entsperre frei. YOLO 3
 * übergeht dieses Gate ausdrücklich; alle anderen Stufen müssen den Zustand
 * zuerst prüfen.
 */
function recoveryGateBlocks(
  armed: boolean,
  event: ToolCallEvent,
  cwd: string,
): boolean {
  return armed && recoveryEffect(event, cwd) === "potentially_mutating";
}

function recoveryBlockReason(
  reason: string | undefined,
  workspaceRoot?: string,
): string {
  const cause =
    reason === "workspace-changed"
      ? "Der Workspace hat sich seit dem letzten Recovery-Check verändert."
      : reason === "unavailable"
        ? "Der Recovery-Status ist nicht verfügbar."
        : "Der vorherige Turn wurde unterbrochen oder endete mit einem Fehler.";
  const rootHint = workspaceRoot
    ? ` Betroffene Projektwurzel: ${workspaceRoot}.`
    : "";
  return `Recovery-Gate aktiv: ${cause}${rootHint} Schreibzugriffe sind gesperrt, bis recovery_check die betroffene Wurzel geprüft hat. Rufe recovery_check auf, um fortzufahren. Lesen bleibt erlaubt.`;
}

// Custom-/MCP-Tools ohne path/filePath-Feld (z. B. subagent) hätten sonst ein
// leeres Subject und der Mensch würde blind bestätigen.
const MAX_INPUT_PREVIEW = 300;

function stopNonInteractive(ctx: ExtensionContext): { terminate?: true } {
  return ctx.mode !== "tui" && !ctx.hasUI ? { terminate: true } : {};
}

function stopRecoveryNonInteractive(
  ctx: ExtensionContext,
  reason: string | undefined,
): { terminate?: true } {
  // In RPC/print a real gate can still be resolved by calling recovery_check.
  // If the provider itself is missing, terminate to avoid an impossible loop.
  return ctx.mode !== "tui" && reason === "unavailable"
    ? { terminate: true }
    : {};
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
): void {
  if (
    event.toolName !== "read" &&
    event.toolName !== "write" &&
    event.toolName !== "edit"
  ) {
    return;
  }
  const input = event.input as Record<string, unknown>;
  const field = typeof input.path === "string" ? "path" : "filePath";
  const rawPath = input[field];
  if (typeof rawPath !== "string") return;

  const identity = resolvePathScope(rawPath, cwd, additionalRoots);
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
  pi.on("agent_start", () => parentRunAgents.reset());
  pi.on("session_start", () => {
    parentRunAgents.reset();
    previousBlockedAction = undefined;
    repeatedBlockedActionCount = 0;
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    const launches = subagentLaunchCount(event);
    const limitReason = parentRunAgents.check(launches);
    if (limitReason) {
      return { block: true, ...stopNonInteractive(ctx), reason: limitReason };
    }
    let outcome = await guardToolCall(event, ctx);
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
            `zuerst den Blockgrund oder führe den dafür genannten ` +
            `Recovery-Schritt aus.`,
        };
      }
    } else {
      previousBlockedAction = undefined;
      repeatedBlockedActionCount = 0;
    }
    if (!outcome?.block) {
      parentRunAgents.commit(launches);
      const additionalRoots = session.additionalWorkspaceRoots();
      const path = toolPath(event);
      const pathRoot = path
        ? resolvePathScope(path, ctx.cwd, additionalRoots).workspaceRoot
        : undefined;
      const explicitRoot = (event.input as Record<string, unknown> | undefined)
        ?.workspaceRoot;
      pi.events.emit(RECOVERY_CAPABILITY_EVENTS.mutationApproved, {
        toolName: event.toolName,
        input: event.input,
        toolCallId: event.toolCallId,
        workspaceRoot:
          (pathRoot
            ? (canonicalWorkspaceRoot(pathRoot) ?? resolve(pathRoot))
            : undefined) ??
          (typeof explicitRoot === "string" ? explicitRoot : undefined) ??
          canonicalWorkspaceRoot(ctx.cwd) ??
          resolve(ctx.cwd),
      });
    }
    return outcome;
  });

  const guardToolCall = async (event: ToolCallEvent, ctx: ExtensionContext) => {
    let additionalRoots = session.additionalWorkspaceRoots();
    let scopedProjectRoot = ctx.cwd;
    let targetIdentity = toolPath(event)
      ? resolvePathScope(toolPath(event)!, ctx.cwd, additionalRoots)
      : undefined;

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
    if (
      !ctx.isProjectTrusted() &&
      session.level() !== "yolo-full" &&
      event.toolName !== "workspace_add" &&
      !targetRootTrusted &&
      !projectCheckRootTrusted
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
    const workflow = requestWorkflowCapabilities(pi.events);
    const assessment = assessWorkflowTool(
      event,
      ctx.cwd,
      session.level(),
      additionalRoots,
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
    // Die Vollständigkeits- und Dedup-Prüfung einer Verifier-Delegation
    // selbst gilt unabhängig vom Zugriffslevel — auch YOLO befreit einen
    // Prüfauftrag nicht von Ziel/Scope/Diff/Baseline. Vor die
    // Delegationsprüfung gezogen, damit assessVerifierDelegation denselben
    // Snapshot auch für den Dedup-Check gegen einen bereits abgeschlossenen
    // Verifier-Lauf nutzen kann.
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
      event.toolName === "project_check" ? scopedProjectRoot : ctx.cwd,
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
    // Recovery ist eine Workspace-Integritätsgrenze, keine Permission-Rückfrage.
    // YOLO 3 übergeht sie ausdrücklich als Vollzugriffsstufe.
    const effect = recoveryEffect(event, ctx.cwd);
    const recoveryEpoch = session.epoch();
    const recovery =
      effect === "potentially_mutating" &&
      session.level() !== "yolo-full" &&
      session.level() !== "readonly"
        ? await requestRecoveryStatus(
            pi.events,
            targetIdentity?.workspaceRoot
              ? (canonicalWorkspaceRoot(targetIdentity.workspaceRoot) ??
                  resolve(targetIdentity.workspaceRoot))
              : event.toolName === "project_check"
                ? (canonicalWorkspaceRoot(scopedProjectRoot) ??
                  resolve(scopedProjectRoot))
                : undefined,
          )
        : { armed: false as const };
    if (
      effect === "potentially_mutating" &&
      session.level() !== "yolo-full" &&
      session.level() !== "readonly" &&
      recoveryEpoch !== session.epoch()
    ) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason:
          "Recovery-Gate: Die Sitzung hat während der Zustandsabfrage gewechselt. Der veraltete Status wurde verworfen; den Aufruf in der aktuellen Sitzung erneut starten.",
      };
    }
    if (
      session.level() !== "yolo-full" &&
      session.level() !== "readonly" &&
      recoveryGateBlocks(recovery.armed, event, ctx.cwd)
    ) {
      return {
        block: true,
        ...stopRecoveryNonInteractive(ctx, recovery.reason),
        reason: recoveryBlockReason(recovery.reason, recovery.workspaceRoot),
      };
    }
    if (planModeTemporarySpecAllowed(workflow, session.level(), event)) {
      // The package would otherwise write debug artifacts below ctx.cwd.
      (event.input as Record<string, unknown>).artifacts = false;
      return;
    }

    const planGuard = planModeMutationGuard(
      workflow,
      session.level(),
      event,
      ctx.cwd,
    );
    if (planGuard.blocked) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: planGuard.reason,
      };
    }

    const decision = decideTool(
      session.level(),
      event,
      ctx.cwd,
      session.configured(),
      {
        allowOutsideProjectRead: assessment.allowOutsideProjectRead,
        additionalRoots,
      },
    );
    if (decision.action === "allow") {
      normalizeNativeFileTarget(event, ctx.cwd, additionalRoots);
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
    normalizeNativeFileTarget(event, ctx.cwd, additionalRoots);
  };

  // user_bash fires only for a `!`/`!!`-prefixed command the human types
  // directly (see @earendil-works/pi-coding-agent's UserBashEvent doc
  // comment) — never for the agent's own `bash` tool calls, which go
  // through tool_call above. The hard boundaries (assessBash) and the
  // chosen permission level (decideBash) still apply, same as any other
  // mode; planModeMutationGuard/planModeBashGuard deliberately do not run
  // here — Plan Mode exists to keep the agent from quietly implementing
  // during a planning turn, not to restrict what the operator types at
  // their own keyboard.
  pi.on("user_bash", async (event, ctx: ExtensionContext) => {
    if (!ctx.isProjectTrusted() && session.level() !== "yolo-full") {
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
    if (decision.action === "allow") return;
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
