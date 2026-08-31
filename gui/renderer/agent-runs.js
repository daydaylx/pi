/**
 * AgentRun & AgentRunStore: Zentrales Datenmodell und Event-Normalisierung
 * für Subagentenläufe und Session-Aktivitäten in der Pi-GUI.
 *
 * Modelliert Subagenten als vollwertige Ausführungsprozesse mit vollständiger
 * Timeline, Tool-Aufrufen, Dateiänderungen, Laufzeiten und Parent/Child-Beziehungen.
 *
 * Domänenfrei und DOM-unabhängig für 100% Testbarkeit in Node.js und Browser.
 */
"use strict";

/**
 * Mögliche Lifecycle-Zustände eines Runs.
 */
const RUN_STATES = {
  QUEUED: "queued",
  STARTING: "starting",
  RUNNING: "running",
  WAITING: "waiting",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Ein einzelner Agenten-Lauf (Hauptchat oder Subagent).
 */
class AgentRun {
  constructor(options = {}) {
    this.id = String(
      options.id ||
        `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    this.parentRunId = options.parentRunId ? String(options.parentRunId) : null;
    this.sessionId = options.sessionId ? String(options.sessionId) : null;
    this.agentId = String(
      options.agentId || options.agentName || "main",
    ).toLowerCase();
    this.agentName = String(options.agentName || options.agentId || "Agent");
    this.role = String(options.role || options.agentName || this.agentName);
    this.task = String(options.task || "");
    this.model = options.model ? String(options.model) : "";
    this.thinking = options.thinking ? String(options.thinking) : "";
    this.state = options.state || RUN_STATES.STARTING;
    this.startedAt =
      typeof options.startedAt === "number" ? options.startedAt : Date.now();
    this.finishedAt =
      typeof options.finishedAt === "number" ? options.finishedAt : null;
    this.toolCallId = options.toolCallId ? String(options.toolCallId) : null;

    /** Chronologische Liste normalisierter Ereignisse */
    this.events = [];
    /** Nach ID indizierte Tool-Aufrufe */
    this.toolCalls = new Map();
    /** Modifizierte Dateien in diesem Run (Pfad -> { path, additions, deletions, hunks, toolName }) */
    this.fileChanges = new Map();
    /** Statistiken & Tokenverbrauch */
    this.usage = {
      tokens: 0,
      cost: null,
      toolCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    /** Strukturiertes Endergebnis */
    this.result = options.result || null;
    /** Fehlertext falls fehlgeschlagen */
    this.error = options.error ? String(options.error) : null;
    /** Untergeordnete Child-Run-IDs */
    this.childRunIds = [];

    // Initiales Event aufzeichnen
    this.recordEvent({
      type: "run.started",
      timestamp: this.startedAt,
      data: {
        agentName: this.agentName,
        task: this.task,
        model: this.model,
        parentRunId: this.parentRunId,
      },
    });
  }

  get isFinished() {
    return (
      this.state === RUN_STATES.COMPLETED ||
      this.state === RUN_STATES.FAILED ||
      this.state === RUN_STATES.CANCELLED
    );
  }

  get isRunning() {
    return (
      this.state === RUN_STATES.RUNNING || this.state === RUN_STATES.STARTING
    );
  }

  get durationMs() {
    const end = this.finishedAt || Date.now();
    return Math.max(0, end - this.startedAt);
  }

  /**
   * Zeichnet ein normalisiertes Event in der Timeline auf.
   */
  recordEvent(event) {
    const normalized = {
      id: `ev-${this.events.length + 1}`,
      timestamp:
        typeof event.timestamp === "number" ? event.timestamp : Date.now(),
      type: event.type,
      ...event,
    };
    this.events.push(normalized);
    return normalized;
  }

  /**
   * Registriert den Start eines Tool-Aufrufs in diesem Run.
   */
  recordToolStart(toolCall) {
    const id = String(
      toolCall.toolCallId ||
        `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const record = {
      toolCallId: id,
      toolName: String(toolCall.toolName || "tool"),
      summary: String(toolCall.summary || toolCall.toolName || ""),
      args:
        toolCall.args && typeof toolCall.args === "object" ? toolCall.args : {},
      startedAt:
        typeof toolCall.startedAt === "number"
          ? toolCall.startedAt
          : Date.now(),
      finishedAt: null,
      durationMs: null,
      running: true,
      isError: false,
      result: null,
      partialResult: null,
    };
    this.toolCalls.set(id, record);
    this.usage.toolCount = this.toolCalls.size;

    this.recordEvent({
      type: "tool.started",
      timestamp: record.startedAt,
      toolCallId: id,
      toolName: record.toolName,
      summary: record.summary,
      args: record.args,
    });

    return record;
  }

  /**
   * Aktualisiert Teilergebnisse eines laufenden Tool-Aufrufs (Streaming/Progress).
   */
  recordToolUpdate(toolCallId, partialResult) {
    const record = this.toolCalls.get(toolCallId);
    if (!record) return null;
    record.partialResult = partialResult;
    return record;
  }

  /**
   * Registriert den Abschluss eines Tool-Aufrufs.
   */
  recordToolEnd(toolCallId, result, isError = false) {
    const record = this.toolCalls.get(toolCallId);
    const now = Date.now();
    if (record) {
      record.finishedAt = now;
      record.durationMs = Math.max(0, now - record.startedAt);
      record.running = false;
      record.isError = Boolean(isError);
      record.result = result;

      // Dateiänderungen erkennen und speichern
      if (
        !isError &&
        ["edit", "write"].includes(record.toolName.toLowerCase())
      ) {
        const filePath = record.args?.path ? String(record.args.path) : "";
        if (filePath) {
          const change = {
            path: filePath,
            toolName: record.toolName,
            timestamp: now,
          };
          this.fileChanges.set(filePath, change);
          this.recordEvent({
            type: "file.changed",
            timestamp: now,
            path: filePath,
            toolName: record.toolName,
          });
        }
      }

      this.recordEvent({
        type: isError ? "tool.failed" : "tool.completed",
        timestamp: now,
        toolCallId,
        toolName: record.toolName,
        summary: record.summary,
        durationMs: record.durationMs,
        isError: Boolean(isError),
        result,
      });

      return record;
    }
    return null;
  }

  /**
   * Zeichnet Zwischenausgabe / Gedanken des Agenten auf.
   */
  recordProgress(text, kind = "progress") {
    const now = Date.now();
    return this.recordEvent({
      type: kind === "thinking" ? "assistant.thinking" : "assistant.progress",
      timestamp: now,
      text: String(text || ""),
    });
  }

  /**
   * Beendet den Run erfolgreich oder mit Fehler.
   */
  complete(resultOrError, { isError = false, cancelled = false } = {}) {
    if (this.isFinished) return;
    this.finishedAt = Date.now();
    if (cancelled) {
      this.state = RUN_STATES.CANCELLED;
      this.error =
        typeof resultOrError === "string" ? resultOrError : "Lauf abgebrochen";
      this.recordEvent({
        type: "run.cancelled",
        timestamp: this.finishedAt,
        error: this.error,
      });
    } else if (isError) {
      this.state = RUN_STATES.FAILED;
      this.error =
        typeof resultOrError === "string"
          ? resultOrError
          : resultOrError?.message || "Lauf fehlgeschlagen";
      this.result = resultOrError;
      this.recordEvent({
        type: "run.failed",
        timestamp: this.finishedAt,
        error: this.error,
        result: resultOrError,
      });
    } else {
      this.state = RUN_STATES.COMPLETED;
      this.result = resultOrError;
      this.recordEvent({
        type: "run.completed",
        timestamp: this.finishedAt,
        result: resultOrError,
      });
    }
  }

  /**
   * Aggregierte Zusammenfassung der Tool-Nutzung (z.B. { Read: 8, Search: 4, Bash: 2 }).
   */
  getToolBreakdown() {
    const counts = {};
    for (const tool of this.toolCalls.values()) {
      const name = tool.toolName || "other";
      const key = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  /**
   * Gibt eine formatiertes Status-Objekt zurück.
   */
  getStatusBadge() {
    switch (this.state) {
      case RUN_STATES.RUNNING:
      case RUN_STATES.STARTING:
        return { marker: "●", label: "Running", cls: "running" };
      case RUN_STATES.COMPLETED:
        return { marker: "✓", label: "Done", cls: "ok" };
      case RUN_STATES.FAILED:
        return { marker: "✕", label: "Failed", cls: "err" };
      case RUN_STATES.CANCELLED:
        return { marker: "⊘", label: "Cancelled", cls: "muted" };
      case RUN_STATES.PAUSED:
        return { marker: "○", label: "Paused", cls: "muted" };
      case RUN_STATES.WAITING:
        return { marker: "⏳", label: "Waiting", cls: "warn" };
      default:
        return { marker: "○", label: String(this.state), cls: "muted" };
    }
  }
}

/**
 * Speicher und Verwaltung aller AgentRuns innerhalb einer Session.
 */
class AgentRunStore {
  constructor() {
    this.runs = new Map();
    this.rootRunId = null;
    this.activeRunId = null; // null bedeutet 'main' Chat
    this.openTabs = ["chat"]; // 'chat' ist immer vorhanden
    this.listeners = new Set();
  }

  onChange(listener) {
    if (typeof listener === "function") {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    return () => {};
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch {
        /* UI-Callback-Fehler fangen */
      }
    }
  }

  clear() {
    this.runs.clear();
    this.rootRunId = null;
    this.activeRunId = null;
    this.openTabs = ["chat"];
    this.notify();
  }

  /**
   * Erstellt oder aktualisiert den Haupt-Run der Session.
   */
  ensureMainRun(sessionId, options = {}) {
    const id = `main-${sessionId || "default"}`;
    let mainRun = this.runs.get(id);
    if (!mainRun) {
      mainRun = new AgentRun({
        id,
        sessionId,
        agentName: "Main",
        role: "Main",
        task: options.task || "Hauptsitzung",
        model: options.model || "",
        thinking: options.thinking || "",
        state: RUN_STATES.RUNNING,
      });
      this.runs.set(id, mainRun);
      this.rootRunId = id;
    }
    return mainRun;
  }

  /**
   * Startet einen neuen Subagenten-Lauf.
   */
  startSubagentRun(options = {}) {
    const id =
      options.id ||
      `subagent-${options.toolCallId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const parentRunId = options.parentRunId || this.rootRunId;

    const run = new AgentRun({
      id,
      parentRunId,
      sessionId: options.sessionId,
      agentId: options.agentId || options.agentName,
      agentName: options.agentName || "Subagent",
      role: options.role || options.agentName,
      task: options.task || "",
      model: options.model || "",
      thinking: options.thinking || "",
      toolCallId: options.toolCallId || null,
      state: RUN_STATES.RUNNING,
      startedAt: options.startedAt || Date.now(),
    });

    this.runs.set(id, run);

    if (parentRunId && this.runs.has(parentRunId)) {
      const parent = this.runs.get(parentRunId);
      if (!parent.childRunIds.includes(id)) {
        parent.childRunIds.push(id);
      }
      parent.recordEvent({
        type: "agent.child.started",
        timestamp: run.startedAt,
        childRunId: id,
        agentName: run.agentName,
        task: run.task,
      });
    }

    this.notify();
    return run;
  }

  getRun(runId) {
    if (!runId || runId === "chat" || runId === "main") {
      return this.rootRunId ? this.runs.get(this.rootRunId) : null;
    }
    return this.runs.get(runId) || null;
  }

  getRunByToolCallId(toolCallId) {
    if (!toolCallId) return null;
    for (const run of this.runs.values()) {
      if (run.toolCallId === toolCallId) return run;
    }
    return null;
  }

  getAllRuns() {
    return Array.from(this.runs.values());
  }

  getSubagentRuns() {
    return Array.from(this.runs.values()).filter(
      (run) => run.id !== this.rootRunId,
    );
  }

  getActiveSubagents() {
    return this.getSubagentRuns().filter((run) => run.isRunning);
  }

  getCompletedSubagents() {
    return this.getSubagentRuns().filter((run) => run.isFinished);
  }

  getChildrenOf(parentRunId) {
    return Array.from(this.runs.values()).filter(
      (run) => run.parentRunId === parentRunId,
    );
  }

  /**
   * Tab-Verwaltung
   */
  openTab(runId) {
    if (!runId) return;
    if (!this.openTabs.includes(runId)) {
      this.openTabs.push(runId);
    }
    this.activeRunId = runId === "chat" ? null : runId;
    this.notify();
  }

  closeTab(runId) {
    if (!runId || runId === "chat") return;
    const index = this.openTabs.indexOf(runId);
    if (index >= 0) {
      this.openTabs.splice(index, 1);
      if (this.activeRunId === runId) {
        // Wechsle zum vorherigen Tab oder Chat
        const nextActive = this.openTabs[Math.max(0, index - 1)] || "chat";
        this.activeRunId = nextActive === "chat" ? null : nextActive;
      }
      this.notify();
    }
  }

  setActiveTab(tabId) {
    if (tabId === "chat" || !tabId) {
      this.activeRunId = null;
    } else if (this.runs.has(tabId)) {
      this.activeRunId = tabId;
      if (!this.openTabs.includes(tabId)) {
        this.openTabs.push(tabId);
      }
    }
    this.notify();
  }
}

/**
 * Formatiert eine Dauer in ms menschenlesbar (z.B. "320ms", "14s", "1m 42s", "2h 15m").
 */
function formatDuration(ms) {
  if (typeof ms !== "number" || isNaN(ms) || ms < 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Formatiert eine Uhrzeit (z.B. "14:52:03").
 */
function formatTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  return date.toTimeString().split(" ")[0] || "";
}

/**
 * Export für Node.js (Tests) und Browser (Window).
 */
if (typeof window !== "undefined") {
  window.piGuiAgentRuns = {
    RUN_STATES,
    AgentRun,
    AgentRunStore,
    formatDuration,
    formatTime,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RUN_STATES,
    AgentRun,
    AgentRunStore,
    formatDuration,
    formatTime,
  };
}
