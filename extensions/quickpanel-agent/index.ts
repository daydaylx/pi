/**
 * QuickPanel-Agentenanbindung für Pi (optional; ohne diese Extension verhält sich Pi unverändert).
 *
 * - Meldet Status (Sitzung, Turn, Werkzeug) an den Dienst `agent-control` – nie blockierend, nie mit Inhalten.
 * - Registriert den Hook, über den `shared/permission-dialog.ts::confirmAction()` dieselbe, bereits vom Guard als `ask`
 *   entschiedene Anfrage zusätzlich extern (QuickPanel) beantworten lässt. Der Guard bleibt alleiniger Policy-Eigentümer:
 *   die externe Antwort ersetzt nur den Tastendruck im TUI-Dialog (`once` ⇒ wie [a], `deny` ⇒ wie [d]).
 * - Harte Warnungen (`decision.hard`) werden NICHT extern angeboten: nur im Terminal bestätigbar.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { digestOf, QuickPanelBridge } from "./qp-bridge.ts";
import type { ApprovalHandle, Choice } from "./qp-bridge.ts";

const HOOK_KEY = Symbol.for("quickpanel.agent.approval-hook");

interface ConfirmInfo {
  ctx: { mode?: string; cwd?: string; sessionManager?: { getSessionId?: () => string } };
  decision: { reason?: string; hard?: boolean };
  subject: string;
  toolName?: string;
}

function socketPath(): string {
  const override = process.env.QP_AGENTS_RUNTIME_DIR;
  if (override) return join(override, "adapter.sock");
  const base = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
  return join(base, "quickpanel-agents", "adapter.sock");
}

export default function quickpanelAgent(pi: ExtensionAPI): void {
  if (process.env.QP_AGENTS_DISABLE === "1") return;

  const bridge = new QuickPanelBridge({
    socketPath: socketPath(),
    adapterInstanceId: `pi-${process.pid}`,
    runtimeVersion: "0.84.3",
  });
  let turnCounter = 0;
  let turnId = "";
  let mode = "";
  let sessionId = "";

  const sid = (ctx: any): string => {
    try {
      const id = ctx?.sessionManager?.getSessionId?.();
      if (typeof id === "string" && id) sessionId = id;
    } catch {
      /* ignorieren */
    }
    return sessionId;
  };
  const cwdOf = (ctx: any): string => (typeof ctx?.cwd === "string" ? ctx.cwd : "");
  const approvalCaps = () => ({
    request_approval:
      mode === "tui"
        ? { state: "supported", reason: "TUI: Delegation an confirmAction()", verified_runtime_version: "0.84.3" }
        : { state: "unavailable", reason: `Modus ${mode || "unbekannt"}: Pi blockiert ask außerhalb der TUI`,
            verified_runtime_version: "0.84.3" },
  });
  const subjectKey = (toolName: string, subject: string) => digestOf({ agent: "pi", tool: toolName, subject });

  pi.on("session_start", (_e: any, ctx: any) => {
    mode = String(ctx?.mode ?? "");
    bridge.start();
    const id = sid(ctx);
    if (id) bridge.send("session.started", id, { workspace_path: cwdOf(ctx), capabilities: approvalCaps(),
                                                 payload: { summary: `Pi (${mode})` } });
  });

  pi.on("agent_start", (_e: any, ctx: any) => {
    turnCounter += 1;
    const id = sid(ctx);
    turnId = `${id.slice(0, 12)}:${turnCounter}`;
    if (id) bridge.send("turn.started", id, { workspace_path: cwdOf(ctx), native_turn_id: turnId,
                                              capabilities: approvalCaps() });
  });

  pi.on("agent_end", (_e: any, ctx: any) => {
    const id = sid(ctx);
    if (id) bridge.send("turn.finished", id, { native_turn_id: turnId || undefined });
  });

  // Rückgabe immer undefined: diese Extension blockiert oder verändert niemals einen Werkzeugaufruf.
  pi.on("tool_call", (e: any, ctx: any) => {
    const id = sid(ctx);
    if (!id) return undefined;
    const input = e?.input ?? {};
    const summary = typeof input.command === "string" ? input.command
      : typeof input.path === "string" ? input.path : typeof input.filePath === "string" ? input.filePath : "";
    bridge.send("tool.started", id, {
      native_turn_id: turnId || undefined, tool_call_id: typeof e?.toolCallId === "string" ? e.toolCallId : undefined,
      payload: { tool_name: String(e?.toolName ?? "").slice(0, 64), summary: summary.slice(0, 200) },
    });
    return undefined;
  });

  pi.on("tool_result", (e: any, ctx: any) => {
    const id = sid(ctx);
    if (!id) return undefined;
    const input = e?.input ?? {};
    const subject = typeof input.command === "string" ? input.command
      : typeof input.path === "string" ? `${e?.toolName}: ${input.path}` : "";
    bridge.send("tool.completed", id, {
      native_turn_id: turnId || undefined, tool_call_id: typeof e?.toolCallId === "string" ? e.toolCallId : undefined,
      payload: { tool_name: String(e?.toolName ?? "").slice(0, 64),
                 ...(subject ? { request_digest: subjectKey(String(e?.toolName ?? ""), subject) } : {}) },
      ...(e?.isError ? { status_detail: "Werkzeug fehlgeschlagen" } : {}),
    });
    return undefined;
  });

  pi.on("session_shutdown", (_e: any, ctx: any) => {
    const id = sid(ctx);
    if (id) bridge.send("session.ended", id, {});
    setTimeout(() => bridge.stop(), 150).unref?.();
  });

  // ---- Hook für confirmAction(): nur die bereits entschiedene `ask`-Anfrage, nie eine eigene Policy
  (globalThis as any)[HOOK_KEY] = {
    begin(info: ConfirmInfo, answer: (c: Choice) => void): ApprovalHandle | null {
      try {
        const id = sid(info.ctx);
        if (!id) return null;
        const toolName = info.toolName ?? "bash";
        if (info.decision?.hard) {
          bridge.send("user_input.requested", id, { native_turn_id: turnId || undefined,
            payload: { summary: "Harte Warnung – nur im Terminal bestätigen" } });
          return null;
        }
        const subject = info.subject ?? "";
        const key = subjectKey(toolName, subject);
        return bridge.beginApproval(
          { sessionId: id, turnId: turnId || undefined, toolName, summary: subject, digest: key,
            workspacePath: cwdOf(info.ctx) }, answer);
      } catch {
        return null; // jede Störung ⇒ nur der native Dialog
      }
    },
  };
}
