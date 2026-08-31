/**
 * PiRpcManager: verwaltet genau einen `pi --mode rpc`-Kindprozess und
 * übersetzt JSON-Zeilen in Ereignisse. Bewusst frei von Electron-APIs,
 * damit die Bridge-Kernlogik headless mit echtem Pi getestet werden kann.
 *
 * Eigenschaften:
 * - Request-Korrelation über ids; Zeitüberschreitung pro Anfrage.
 * - stdout wird zeilenweise gepuffert und als JSON geparst (laut, nicht
 *   findig: unparsebare Zeilen werden als parse-error gemeldet).
 * - stderr läuft in einen Ringpuffer (Diagnose bei Exit).
 * - stop() beendet sauber: SIGTERM, nach 3s SIGKILL.
 */
"use strict";

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const REQUEST_TIMEOUT_MS = 10_000;
const STDERR_RING_SIZE = 20;
/** Nach einem Abort wartet die GUI kurz, bis der Core agent_settled liefert.
 * Ohne diese Drain-Phase würde ein stdio-Ende mitten im Turn die Extension-
 * Kontexte invalidieren (Phase-1-Fund, Testmatrix-Fall D). */
const ABORT_DRAIN_MS = 700;
/** stop() darf nicht den vollen Request-Timeout auf den Abort warten: sonst
 * hängt der Prozess bei einem hängenden Core bis zu REQUEST_TIMEOUT_MS lang
 * im Hintergrund, obwohl das Fenster längst geschlossen ist. */
const ABORT_STOP_TIMEOUT_MS = 2_500;

/**
 * Liest den RPC-Stdout strikt als JSONL: ausschließlich LF trennt Datensätze.
 * `readline` wäre hier falsch, weil es auch U+2028/U+2029 innerhalb eines
 * JSON-Strings als Zeilenende auffasst.
 */
function attachJsonlReader(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      onLine(line);
    }
  });
  stream.on("end", () => {
    if (!buffer) return;
    if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
    onLine(buffer);
  });
}

function buildPiArgs(options = {}) {
  const args = ["--mode", "rpc"];
  if (options.noSession) args.push("--no-session");
  if (options.model) args.push(...["--model", String(options.model)]);
  return args;
}

/** Extrahiert den sichtbaren Kurztext eines Tool-Aufrufs für kompakte Cards. */
function summarizeToolCall(toolName, args) {
  const a = args && typeof args === "object" ? args : {};
  switch (toolName) {
    case "read":
      return `READ ${String(a.path ?? "")}`;
    case "bash":
      return `BASH ${String(a.command ?? "").slice(0, 80)}`;
    case "edit":
      return `EDIT ${String(a.path ?? "")}`;
    case "write":
      return `WRITE ${String(a.path ?? "")}`;
    case "grep":
      return `GREP ${String(a.pattern ?? "")}`;
    case "find":
      return `FIND ${String(a.pattern ?? "")}`;
    case "ls":
      return `LS ${String(a.path ?? "")}`;
    case "subagent": {
      if (a.list) return "SUBAGENT list";
      const role = String(a.agent ?? "").trim();
      const task = String(a.task ?? "").slice(0, 60);
      return role
        ? `SUBAGENT ${role}: ${task}`.trim()
        : `SUBAGENT ${task}`.trim();
    }
    default: {
      const keys = Object.keys(a).slice(0, 2);
      const brief = keys.map((k) => String(a[k]).slice(0, 30)).join(" ");
      return `${String(toolName).toUpperCase()} ${brief}`.trim();
    }
  }
}

class PiRpcManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.piPath = options.piPath || "pi";
    this.cwd = options.cwd;
    this.requestTimeoutMs = options.requestTimeoutMs || REQUEST_TIMEOUT_MS;
    this.args = buildPiArgs(options);
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrRing = [];
    this.stopped = false;
    this.streaming = false;
  }

  start() {
    if (this.child) throw new Error("RPC-Prozess läuft bereits");
    this.stopped = false;
    const child = spawn(this.piPath, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    let finished = false;
    const finishExit = (info) => {
      if (finished) return;
      finished = true;
      const message =
        info.kind === "spawn-error"
          ? `Pi-Prozess konnte nicht gestartet werden: ${info.message}`
          : `Pi-Prozess beendet (code=${info.code})`;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(message));
      }
      this.pending.clear();
      if (this.child === child) this.child = null;
      this.emit("exit", { ...info, stderrTail: this.stderrTail() });
    };

    child.on("error", (err) => {
      this.emit("error", err);
      finishExit({ kind: "spawn-error", message: String(err) });
    });
    child.on("exit", (code, signal) => finishExit({ code, signal }));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderrRing.push(chunk);
      while (this.stderrRing.length > STDERR_RING_SIZE) this.stderrRing.shift();
    });
    attachJsonlReader(child.stdout, (line) => this.handleLine(line));
    return this;
  }

  get running() {
    return Boolean(this.child);
  }

  stderrTail() {
    return this.stderrRing.join("").slice(-2000);
  }

  handleLine(rawLine) {
    const line = rawLine.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.emit("parse-error", line.slice(0, 500));
      return;
    }
    if (msg.type === "agent_start") this.streaming = true;
    if (msg.type === "agent_settled") this.streaming = false;
    // Korrelierte Response auflösen — und zusätzlich als Event melden,
    // damit UI-Code (z. B. set_model-Ergebnis) darauf reagieren kann.
    if (msg.id && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id);
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      if (msg.success === false) {
        pending.reject(new Error(msg.error || "RPC-Anfrage fehlgeschlagen"));
      } else {
        pending.resolve(msg.data !== undefined ? msg.data : msg);
      }
    }
    if (msg.type === "response") {
      this.emit("event", msg);
      return;
    }
    if (msg.type === "extension_ui_request") {
      this.emit("ui-request", msg);
      this.emit("event", msg);
      return;
    }
    this.emit("event", msg);
  }

  request(commandObj, timeoutMs = this.requestTimeoutMs) {
    const child = this.child;
    if (!child) return Promise.reject(new Error("Pi läuft nicht"));
    const id = `gui-${this.nextId++}`;
    const payload = { id, ...commandObj };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout für ${commandObj.type}`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify(payload) + "\n");
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** Schreibt eine Rohzeile (z. B. extension_ui_response) ohne Korrelation. */
  sendRaw(obj) {
    if (!this.child) throw new Error("Pi läuft nicht");
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  /** Beantwortet einen Extension-UI-Dialog strikt nach RPC-Doku. */
  respondToUiRequest(payload) {
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new Error("UI-Antwort braucht die Request-Id");
    }
    const line = { type: "extension_ui_response", id: payload.id };
    if (payload.cancelled === true) {
      line.cancelled = true;
    } else if (payload.method === "confirm") {
      line.confirmed = payload.confirmed === true;
    } else if (payload.value !== undefined) {
      if (typeof payload.value !== "string") {
        throw new Error("UI-Wert muss ein String sein");
      }
      line.value = payload.value.slice(0, 2000);
    } else {
      throw new Error("UI-Antwort braucht value, confirmed oder cancelled");
    }
    this.sendRaw(line);
    return { delivered: true };
  }

  abort(timeoutMs) {
    this.streaming = false;
    return this.request({ type: "abort" }, timeoutMs).catch(() => undefined);
  }

  /** Beendet den Kindprozess sauber: laufende Turns werden zuerst
   * abgebrochen und gedraint, dann SIGTERM, nach 3s SIGKILL. Der Abort
   * selbst nutzt ein kurzes Timeout, damit ein hängender Core den
   * Fensterschluss nicht bis zum vollen Request-Timeout blockiert. */
  async stop() {
    if (!this.child || this.stopped) return Promise.resolve();
    this.stopped = true;
    if (this.streaming) {
      await this.abort(ABORT_STOP_TIMEOUT_MS);
      await new Promise((r) => setTimeout(r, ABORT_DRAIN_MS));
    }
    return new Promise((resolve) => {
      const child = this.child;
      const done = () => resolve();
      child.once("exit", done);
      try {
        child.stdin.end();
        child.kill("SIGTERM");
      } catch {
        done();
      }
      setTimeout(() => {
        try {
          if (child.exitCode === null) child.kill("SIGKILL");
        } catch {
          /* bereits tot */
        }
        resolve();
      }, 3000);
    });
  }
}

module.exports = {
  PiRpcManager,
  attachJsonlReader,
  buildPiArgs,
  summarizeToolCall,
};
