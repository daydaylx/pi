import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import { confirmAction } from "../shared/permission-dialog.ts";
import {
  decideBash,
  isPlanModeDiagnosticCommand,
} from "../shared/permission-policy.ts";
import { requestRecoveryStatus } from "../shared/recovery-capabilities.ts";
import { requestVerificationCapabilities } from "../shared/verification-capabilities.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import type { PermissionSession } from "./session-state.ts";
import { decideTool } from "./tool-policy.ts";
import {
  assessBash,
  assessWorkflowTool,
  planModeInvestigatorSingleAllowed,
  planModeMutationGuard,
} from "./workflow-policy.ts";
import {
  assessDebuggerDelegation,
  assessGitCommitVerifierGate,
  assessVerifierDelegation,
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
  if (!armed) return false;
  if (event.toolName === "write" || event.toolName === "edit") return true;
  if (event.toolName !== "bash") return false;
  const command = String(
    (event.input as Record<string, unknown>).command ?? "",
  );
  return !isPlanModeDiagnosticCommand(command, cwd);
}

function recoveryBlockReason(reason: string | undefined): string {
  const cause =
    reason === "workspace-changed"
      ? "Der Workspace hat sich seit dem letzten Recovery-Check verändert."
      : "Der vorherige Turn wurde unterbrochen oder endete mit einem Fehler.";
  return `Recovery-Gate aktiv: ${cause} Schreibzugriffe sind gesperrt, bis recovery_check den Workspace geprüft hat. Lesen und recovery_check bleiben erlaubt.`;
}

// Custom-/MCP-Tools ohne path/filePath-Feld (z. B. subagent) hätten sonst ein
// leeres Subject und der Mensch würde blind bestätigen.
const MAX_INPUT_PREVIEW = 300;

function toolSubject(event: ToolCallEvent): string {
  if (event.toolName === "bash") {
    return String((event.input as Record<string, unknown>).command ?? "");
  }
  const path = toolPath(event);
  if (path !== undefined) return `${event.toolName}: ${path}`;
  const preview = JSON.stringify(event.input ?? {}).slice(0, MAX_INPUT_PREVIEW);
  return `${event.toolName}: ${preview}`;
}

export function registerPermissionGuards(
  pi: ExtensionAPI,
  session: PermissionSession,
): void {
  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    if (!ctx.isProjectTrusted() && !READ_ONLY_TOOLS.includes(event.toolName)) {
      return {
        block: true,
        reason:
          "Harte Trust-Grenze: mutierende oder externe Tools sind im nicht vertrauenswürdigen Projekt blockiert.",
      };
    }
    const workflow = requestWorkflowCapabilities(pi.events);
    const assessment = assessWorkflowTool(event, ctx.cwd);
    if (assessment.blocked) {
      return { block: true, reason: assessment.reason };
    }
    // Harte Web-Eingabegrenze: fetch_content nur http(s), kein auth.
    const webAssessment = assessWebToolInput(event);
    if (webAssessment.blocked) {
      return { block: true, reason: webAssessment.reason };
    }
    const verifierAssessment = assessVerifierDelegation(event);
    if (verifierAssessment.blocked) {
      return { block: true, reason: verifierAssessment.reason };
    }
    const debuggerAssessment = assessDebuggerDelegation(event);
    if (debuggerAssessment.blocked) {
      return { block: true, reason: debuggerAssessment.reason };
    }
    // Gilt wie das Recovery-Gate unabhängig vom Zugriffslevel — auch YOLO
    // hebt die Verifier-Pflicht für sicherheits-/permissionsrelevante Diffs
    // nicht auf, weil genau dort die beobachtete Lücke entstand.
    const verification = requestVerificationCapabilities(pi.events);
    const commitGate = assessGitCommitVerifierGate(
      event,
      ctx.cwd,
      verification,
    );
    if (commitGate.blocked) {
      return { block: true, reason: commitGate.reason };
    }
    // Das Recovery-Gate prüft vor der Planmodus-Freigabe, damit auch
    // Schreibzugriffe auf die Plandatei nach einem Fehlturn nicht
    // stillschweigend durchlaufen.
    const recovery = requestRecoveryStatus(pi.events);
    if (recoveryGateBlocks(recovery.armed, event, ctx.cwd)) {
      return { block: true, reason: recoveryBlockReason(recovery.reason) };
    }
    if (planModeInvestigatorSingleAllowed(workflow, session.level(), event)) {
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
      return { block: true, reason: planGuard.reason };
    }

    const decision = decideTool(
      session.level(),
      event,
      ctx.cwd,
      session.configured(),
    );
    if (decision.action === "allow") return;
    if (decision.action === "block") {
      return { block: true, reason: decision.reason };
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
  });

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
    const assessment = assessBash(event.command);
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
