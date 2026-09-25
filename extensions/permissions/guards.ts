import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import { confirmAction } from "../shared/permission-dialog.ts";
import { decideBash, resolvePathScope } from "../shared/permission-policy.ts";
import {
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

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", ASK_USER_TOOL_NAME];

/**
 * Das Recovery-Gate sperrt nach einem fehlgeschlagenen oder unterbrochenen
 * Turn mit möglicher Mutation genau die Werkzeuge, die den Workspace weiter
 * verändern könnten. `recovery_check` bleibt als Entsperre frei. Die
 * Entscheidung gilt unabhängig von der Zugriffsstufe — auch YOLO hebt sie
 * nicht auf.
 */
function recoveryGateBlocks(
  armed: boolean,
  event: ToolCallEvent,
  cwd: string,
): boolean {
  return armed && recoveryEffect(event, cwd) === "potentially_mutating";
}

function recoveryBlockReason(reason: string | undefined): string {
  const cause =
    reason === "workspace-changed"
      ? "Der Workspace hat sich seit dem letzten Recovery-Check verändert."
      : reason === "unavailable"
        ? "Der Recovery-Status ist nicht verfügbar."
        : "Der vorherige Turn wurde unterbrochen oder endete mit einem Fehler.";
  return `Recovery-Gate aktiv: ${cause} Schreibzugriffe sind gesperrt, bis recovery_check den Workspace geprüft hat. Lesen und recovery_check bleiben erlaubt.`;
}

// Custom-/MCP-Tools ohne path/filePath-Feld (z. B. subagent) hätten sonst ein
// leeres Subject und der Mensch würde blind bestätigen.
const MAX_INPUT_PREVIEW = 300;

function stopNonInteractive(ctx: ExtensionContext): { terminate?: true } {
  return ctx.mode === "tui" ? {} : { terminate: true };
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
function normalizeNativeFileTarget(event: ToolCallEvent, cwd: string): void {
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

  const identity = resolvePathScope(rawPath, cwd);
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

export function registerPermissionGuards(
  pi: ExtensionAPI,
  session: PermissionSession,
): void {
  // Limit pro Parent-Lauf: der Zähler wird mit jedem neuen Nutzer-Turn und
  // jeder neuen Sitzung zurückgesetzt und zählt nur freigegebene Starts.
  const parentRunAgents = createParentRunAgentCounter();
  pi.on("agent_start", () => parentRunAgents.reset());
  pi.on("session_start", () => parentRunAgents.reset());

  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    const launches = subagentLaunchCount(event);
    const limitReason = parentRunAgents.check(launches);
    if (limitReason) {
      return { block: true, ...stopNonInteractive(ctx), reason: limitReason };
    }
    const outcome = await guardToolCall(event, ctx);
    if (!outcome?.block) parentRunAgents.commit(launches);
    return outcome;
  });

  const guardToolCall = async (event: ToolCallEvent, ctx: ExtensionContext) => {
    if (!ctx.isProjectTrusted()) {
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
        const identity = resolvePathScope(path, ctx.cwd);
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
    if (event.toolName === ASK_USER_TOOL_NAME && ctx.mode !== "tui") {
      return {
        block: true,
        terminate: true,
        reason: `ask_user ist im Modus "${ctx.mode}" nicht verfügbar; im TUI-Modus steht die interaktive Entscheidungskarte zur Verfügung. Keine Rückfrage starten oder wiederholen.`,
      };
    }
    // Profile preflight: a missing declaration has no safe command fallback.
    // This keeps the result visible and fail-closed without entering project
    // dependency preparation or falsely changing the verification ledger.
    if (
      event.toolName === "project_check" &&
      ctx.isProjectTrusted() &&
      !existsSync(join(ctx.cwd, ".pi", "verify.json"))
    ) {
      return {
        block: true,
        terminate: true,
        reason:
          "Kein Projekt-Prüfprofil definiert: .pi/verify.json fehlt. Es wird kein freies Prüfkommando geraten; zulässiger Prüfpfad: .pi/verify.json mit benanntem Profil anlegen und project_check erneut ausführen.",
      };
    }
    const workflow = requestWorkflowCapabilities(pi.events);
    const assessment = assessWorkflowTool(event, ctx.cwd, session.level());
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
    const verification = requestVerificationCapabilities(pi.events);
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
    const normalizedVerifierInput = normalizeVerifierDelegationInput(event);
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
    // Recovery ist eine Workspace-Integritätsgrenze, keine Permission-Rückfrage:
    // auch YOLO darf unbekannten Zustand nicht als sicher freigeben.
    const effect = recoveryEffect(event, ctx.cwd);
    const recoveryEpoch = session.epoch();
    const recovery =
      effect === "potentially_mutating"
        ? await requestRecoveryStatus(pi.events)
        : { armed: false as const };
    if (
      effect === "potentially_mutating" &&
      recoveryEpoch !== session.epoch()
    ) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason:
          "Recovery-Gate: Die Sitzung hat während der Zustandsabfrage gewechselt. Der veraltete Status wurde verworfen; den Aufruf in der aktuellen Sitzung erneut starten.",
      };
    }
    if (recoveryGateBlocks(recovery.armed, event, ctx.cwd)) {
      return {
        block: true,
        ...stopNonInteractive(ctx),
        reason: recoveryBlockReason(recovery.reason),
      };
    }
    if (
      planModeTemporarySpecAllowed(workflow, session.level(), event)
    ) {
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
      { allowOutsideProjectRead: assessment.allowOutsideProjectRead },
    );
    if (decision.action === "allow") {
      normalizeNativeFileTarget(event, ctx.cwd);
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
    if (ctx.mode !== "tui") {
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
    normalizeNativeFileTarget(event, ctx.cwd);
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
    if (!ctx.isProjectTrusted()) {
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
