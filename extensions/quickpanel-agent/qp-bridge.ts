/**
 * QuickPanel-Brücke für Pi: nicht blockierender Client für den Dienst `agent-control` (Unix-Socket, NDJSON).
 *
 * Reines Node-Modul (keine Pi-Importe, nur "erasable" TypeScript) – daher mit `node --experimental-strip-types` testbar.
 * Garantien:
 *  - `send()` blockiert nie und wirft nie; ohne Dienst werden Ereignisse in einer kleinen, begrenzten Warteschlange gehalten.
 *  - `beginApproval()` liefert nur dann ein Handle, wenn der Dienst erreichbar *und* hello bestätigt ist; Entscheidungen
 *    werden nur mit passender approval_id UND request_digest und erlaubter Wahl angenommen. Alles andere ⇒ keine Entscheidung.
 *  - Keine Persistenz, keine Prompts, keine Tool-Ausgaben.
 */
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export type Choice = "once" | "deny";
export type CapState = "supported" | "observed_only" | "unknown" | "unavailable";
export type Capabilities = Record<string, { state: CapState; reason?: string; verified_runtime_version?: string }>;

export interface BridgeOptions {
  socketPath: string;
  adapterInstanceId: string;
  runtimeVersion?: string;
  heartbeatMs?: number;
  maxQueue?: number;
  /** Test-/Diagnosehaken */
  onState?: (state: "connected" | "disconnected") => void;
}

export interface ApprovalRequest {
  sessionId: string;
  turnId?: string;
  toolName: string;
  summary: string;
  digest: string;
  workspacePath?: string;
  timeoutSeconds?: number;
}

export interface ApprovalHandle {
  /** Der Nutzer hat im Terminal entschieden (oder der Aufruf wurde abgebrochen): Dienst über Host-Fakt informieren. */
  cancel(nativeOutcome: "executed" | "denied" | "unknown"): void;
  /** Die externe Antwort wurde angewandt; es ist nichts weiter zu melden (Host-Quittung folgt über tool.completed). */
  settle(): void;
}

interface PendingApproval {
  digest: string;
  approvalId: string | null;
  onDecision: (choice: Choice) => void;
  done: boolean;
}

const ADAPTER_CAPS: Capabilities = {
  observe_lifecycle: { state: "supported", reason: "Pi-Extension-Events", verified_runtime_version: "0.84.3" },
  observe_tools: { state: "supported", reason: "Pi-Extension-Events", verified_runtime_version: "0.84.3" },
  request_approval: { state: "supported", reason: "Delegation an confirmAction()", verified_runtime_version: "0.84.3" },
};

export function procStartTicks(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(rest[19]);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

export function digestOf(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).sort();
  const canonical = JSON.stringify(Object.fromEntries(keys.map((k) => [k, fields[k]])));
  return createHash("sha256").update(canonical).digest("hex");
}

export class QuickPanelBridge {
  private opts: Required<Omit<BridgeOptions, "onState">> & { onState?: BridgeOptions["onState"] };
  private sock: net.Socket | null = null;
  private buf = "";
  private ready = false;
  private stopped = false;
  private seq = 0;
  private queue: Record<string, unknown>[] = [];
  private pending = new Map<string, PendingApproval>();
  /** Nativ beantwortet, bevor `approval.accepted` eintraf: Quittung nachreichen, sobald die ID bekannt ist. */
  private lateNative = new Map<string, { outcome: string; sessionId: string; turnId?: string }>();
  private reconnect: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private backoff = 500;
  private readonly pid = process.pid;
  private readonly startTicks = procStartTicks(process.pid);
  private readonly kittyPid = Number(process.env.KITTY_PID) || undefined;

  constructor(opts: BridgeOptions) {
    this.opts = {
      runtimeVersion: "",
      heartbeatMs: 30_000,
      maxQueue: 128,
      ...opts,
    };
  }

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (this.sock || this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.pending.clear();
    try {
      this.sock?.end();
      this.sock?.destroy();
    } catch {
      /* ignorieren */
    }
    this.sock = null;
    this.ready = false;
  }

  private connect(): void {
    const sock = net.createConnection({ path: this.opts.socketPath });
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      this.write({
        type: "hello", role: "adapter", schema_version: 1, agent_type: "pi",
        adapter_instance_id: this.opts.adapterInstanceId, runtime_version: this.opts.runtimeVersion,
        seq_mode: "strict", connection_bound: true, heartbeat_interval_s: Math.round(this.opts.heartbeatMs / 1000),
        capabilities: ADAPTER_CAPS,
      });
    });
    sock.on("data", (chunk: string) => {
      this.buf += chunk;
      if (this.buf.length > 256 * 1024) {
        this.buf = "";
        sock.destroy();
        return;
      }
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        this.onLine(line);
      }
    });
    sock.on("error", () => {
      /* close folgt */
    });
    sock.on("close", () => {
      const was = this.ready;
      this.ready = false;
      this.sock = null;
      this.buf = "";
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      // Offene Freigaben dieser Verbindung sind serverseitig storniert ⇒ keine Entscheidung mehr möglich
      for (const p of this.pending.values()) p.done = true;
      this.pending.clear();
      if (was) this.opts.onState?.("disconnected");
      if (!this.stopped) {
        this.reconnect = setTimeout(() => this.connect(), this.backoff);
        this.reconnect.unref?.();
        this.backoff = Math.min(this.backoff * 2, 10_000);
      }
    });
    sock.unref?.();
  }

  private write(obj: Record<string, unknown>): boolean {
    const s = this.sock;
    if (!s || s.destroyed || !s.writable) return false;
    try {
      s.write(JSON.stringify(obj) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  private onLine(line: string): void {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello.ok":
        this.ready = true;
        this.backoff = 500;
        this.opts.onState?.("connected");
        for (const ev of this.queue.splice(0)) this.write({ type: "event", ...ev });
        if (!this.heartbeat) {
          this.heartbeat = setInterval(() => this.heartbeatTick(), this.opts.heartbeatMs);
          this.heartbeat.unref?.();
        }
        break;
      case "approval.accepted": {
        const digest = String(msg.request_digest);
        const p = this.pending.get(digest);
        if (p && !p.done && typeof msg.approval_id === "string") p.approvalId = msg.approval_id;
        const late = this.lateNative.get(digest);
        if (!p && late && typeof msg.approval_id === "string") {
          this.lateNative.delete(digest);
          this.send("permission.resolved", late.sessionId, {
            ...(late.turnId ? { native_turn_id: late.turnId } : {}),
            payload: { approval_id: msg.approval_id, request_digest: digest, outcome: late.outcome },
          });
        }
        break;
      }
      case "approval.unavailable":
      case "approval.expired":
      case "approval.cancelled": {
        for (const [digest, p] of this.pending) {
          if (msg.type === "approval.unavailable" ? p.approvalId === null : p.approvalId === msg.approval_id) {
            p.done = true;
            this.pending.delete(digest);
          }
        }
        break;
      }
      case "approval.decision": {
        const p = this.pending.get(String(msg.request_digest));
        if (!p || p.done || p.approvalId === null) return;
        if (msg.approval_id !== p.approvalId) return;
        if (msg.choice !== "once" && msg.choice !== "deny") return;
        p.done = true;
        this.pending.delete(p.digest);
        try {
          p.onDecision(msg.choice);
        } catch {
          /* Dialog-Fehler dürfen den Dienst nicht stören */
        }
        break;
      }
      default:
        break;
    }
  }

  private heartbeatTick(): void {
    this.write({ type: "event", ...this.base("heartbeat", "*", {}) });
  }

  private base(eventType: string, sessionId: string, extra: Record<string, unknown>): Record<string, unknown> {
    this.seq += 1;
    const ev: Record<string, unknown> = {
      schema_version: 1,
      event_id: randomUUID().replace(/-/g, ""),
      seq: this.seq,
      timestamp: Date.now() / 1000,
      agent_type: "pi",
      adapter_instance_id: this.opts.adapterInstanceId,
      native_session_id: sessionId,
      session_epoch: 0,
      event_type: eventType,
      source: "plugin",
      event_confidence: "native",
      payload: {},
      pid: this.pid,
    };
    if (this.startTicks !== null) ev.process_start_time = this.startTicks;
    if (this.kittyPid) ev.kitty_pid = this.kittyPid;
    return { ...ev, ...extra };
  }

  /** Status-/Lebenszyklusereignis (nie blockierend). */
  send(eventType: string, sessionId: string, extra: Record<string, unknown> = {}): void {
    const ev = this.base(eventType, sessionId, extra);
    if (this.ready && this.write({ type: "event", ...ev })) return;
    if (this.queue.length >= this.opts.maxQueue) this.queue.shift();
    this.queue.push(ev);
  }

  /**
   * Meldet eine echte Host-Freigabeanfrage. Rückgabe `null` ⇒ kein externer Pfad (Dienst weg/ohne Hello): der Aufrufer
   * zeigt nur den eigenen TUI-Dialog. Mit Handle ⇒ `onDecision` darf höchstens einmal feuern.
   */
  beginApproval(req: ApprovalRequest, onDecision: (c: Choice) => void): ApprovalHandle | null {
    if (!this.ready) return null;
    const pending: PendingApproval = { digest: req.digest, approvalId: null, onDecision, done: false };
    this.pending.set(req.digest, pending);
    const ev = this.base("permission.requested", req.sessionId, {
      workspace_path: req.workspacePath ?? "",
      ...(req.turnId ? { native_turn_id: req.turnId } : {}),
      payload: {
        tool_name: req.toolName,
        approval: {
          request_digest: req.digest,
          allowed_choices: ["once", "deny"],
          timeout_seconds: req.timeoutSeconds ?? 122,
          requested_action_summary: req.summary.slice(0, 300) || req.toolName,
        },
      },
    });
    if (!this.write({ type: "event", ...ev })) {
      this.pending.delete(req.digest);
      return null;
    }
    const resolveNative = (outcome: "executed" | "denied" | "unknown") => {
      const id = pending.approvalId;
      const wasDone = pending.done;
      if (wasDone && id === null) return; // Verbindung/Dienst war weg: serverseitig bereits storniert
      pending.done = true;
      this.pending.delete(req.digest);
      if (id === null && !wasDone) {
        // approval.accepted noch nicht eingetroffen: Quittung beim Eintreffen nachreichen (begrenzte Merkliste)
        if (this.lateNative.size >= 32) this.lateNative.delete(this.lateNative.keys().next().value as string);
        this.lateNative.set(req.digest, { outcome, sessionId: req.sessionId, turnId: req.turnId });
        const t = setTimeout(() => this.lateNative.delete(req.digest), 10_000);
        t.unref?.();
      }
      if (id !== null && !wasDone) {
        this.send("permission.resolved", req.sessionId, {
          ...(req.turnId ? { native_turn_id: req.turnId } : {}),
          payload: { approval_id: id, request_digest: req.digest, outcome },
        });
      }
    };
    return {
      cancel: (outcome) => resolveNative(outcome),
      settle: () => {
        pending.done = true;
        this.pending.delete(req.digest);
      },
    };
  }
}
