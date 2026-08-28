/**
 * IPC-Whitelist: die einzige Verbindung zwischen Renderer und Pi.
 * Jeder Kanal validiert seine Payload; es gibt keinen generischen
 * Passthrough und keine freien Shell-Aufrufe aus dem Renderer (R14).
 */
"use strict";

const path = require("node:path");
const os = require("node:os");
const { existsSync, realpathSync } = require("node:fs");
const fsPromises = require("node:fs/promises");
const { PiRpcManager, summarizeToolCall } = require("./pi-rpc-manager.js");

const MAX_PROMPT_LENGTH = 100_000;
const MAX_CLIPBOARD_LENGTH = 500_000;

/** Sessions-Basisverzeichnis — einzige Quelle für Listing UND Validierung
 * beim Wechseln (R14: kein Kanal darf großzügiger sein als sein Listing). */
function sessionsBaseDir() {
  return (
    process.env.PI_CODING_AGENT_SESSION_DIR ||
    path.join(process.env.HOME ?? os.homedir(), ".pi", "agent", "sessions")
  );
}

/**
 * Akzeptiert nur echte Session-Dateien innerhalb des echten Session-Roots.
 * Ein Lexical-Check allein würde einen Symlink innerhalb des Roots zulassen,
 * der auf eine beliebige Datei außerhalb zeigt.
 */
function resolveSessionPath(sessionPath) {
  if (
    typeof sessionPath !== "string" ||
    !path.isAbsolute(sessionPath) ||
    !sessionPath.endsWith(".jsonl")
  ) {
    return undefined;
  }
  try {
    const baseDir = realpathSync(sessionsBaseDir());
    const resolved = realpathSync(sessionPath);
    if (!resolved.endsWith(".jsonl")) return undefined;
    return resolved.startsWith(baseDir + path.sep) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Die letzten Sitzungsdateien (mtime-absteigend) für session.resume.
 * Asynchrones I/O (R21): das Durchlaufen vieler Sitzungsverzeichnisse darf
 * den Main-Prozess nicht blockieren.
 */
async function listRecentSessions() {
  const baseDir = sessionsBaseDir();
  if (!existsSync(baseDir)) return [];
  const found = [];
  async function walk(dir, depth) {
    if (depth > 3 || found.length > 80) return;
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const stat = await fsPromises.stat(full);
          found.push({ path: full, mtimeMs: stat.mtimeMs });
        } catch {
          /* verschwundene Datei überspringen */
        }
      }
    }
  }
  await walk(baseDir, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return Promise.all(
    found.slice(0, 20).map(async (entry) => {
      let title = path.basename(entry.path);
      try {
        const content = await fsPromises.readFile(entry.path, "utf8");
        const header = JSON.parse(content.split("\n")[0]);
        title = header.title || header.displayName || title;
      } catch {
        /* Dateiname bleibt Titel */
      }
      return { path: entry.path, mtimeMs: entry.mtimeMs, title };
    }),
  );
}

const FORWARDABLE_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "extension_ui_request",
  "extension_error",
  "response",
  // Session-Einträge (Custom-Entries der frontend-bridge):
  "entry_appended",
  "custom",
]);

/** Formt ein Tool-Ereignis in das kompakte Card-Format für den Renderer. */
function toolCardFromEvent(msg) {
  const card = {
    toolCallId: msg.toolCallId,
    toolName: String(msg.toolName ?? ""),
    summary: summarizeToolCall(
      msg.toolName,
      msg.args && typeof msg.args === "object" ? msg.args : {},
    ),
    isError: false,
    running: true,
  };
  return card;
}

class GuiSession {
  constructor(win) {
    this.win = win;
    this.manager = null;
    this.noSession = false;
    this.stopping = false;
  }

  sendToRenderer(channel, payload) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  forwardEvent(msg) {
    if (!FORWARDABLE_EVENT_TYPES.has(msg.type)) return;
    // Kompakte Tool-Cards werden zusätzlich zum Rohereignis mitgeliefert,
    // damit der Renderer ohne Geschäftslogik bleibt (R11).
    const envelope = { ...msg };
    if (
      msg.type === "tool_execution_start" ||
      msg.type === "tool_execution_end"
    ) {
      envelope.toolCard = toolCardFromEvent(msg);
      envelope.toolCard.running = msg.type === "tool_execution_start";
      envelope.toolCard.isError =
        msg.type === "tool_execution_end" ? Boolean(msg.isError) : false;
    }
    this.sendToRenderer("gui:event", envelope);
  }

  ensureManager(options = {}) {
    if (this.manager && this.manager.running) {
      if (this.noSession !== (options.noSession === true)) {
        throw new Error(
          "Sitzungsmodus kann nicht während eines Laufs wechseln",
        );
      }
      return this.manager;
    }
    const cwdOption =
      typeof options.cwd === "string" &&
      options.cwd.length > 0 &&
      options.cwd.length < 4096 &&
      existsSync(options.cwd)
        ? options.cwd
        : undefined;
    this.noSession = options.noSession === true;
    this.stopping = false;
    this.manager = new PiRpcManager({
      piPath: process.env.PI_GUI_PI_PATH || "pi",
      cwd: cwdOption || undefined,
      noSession: this.noSession,
      model: typeof options.model === "string" ? options.model : undefined,
    });
    this.manager.on("event", (msg) => this.forwardEvent(msg));
    this.manager.on("exit", (info) => this.sendToRenderer("gui:pi-exit", info));
    this.manager.on("error", () => {});
    this.manager.start();
    return this.manager;
  }

  async stop() {
    if (!this.manager) return false;
    this.stopping = true;
    await this.manager.stop();
    return true;
  }

  async getStats() {
    if (!this.manager || !this.manager.running) {
      if (this.stopping) return null;
      throw new Error("Pi läuft nicht");
    }
    try {
      return await this.manager.request({ type: "get_session_stats" });
    } catch (error) {
      if (this.stopping) return null;
      throw error;
    }
  }
}

function registerIpcHandlers(ipcMain, getWindow, shortcutsJson) {
  const sessionFor = () => {
    const win = getWindow();
    if (!win.__guiSession) win.__guiSession = new GuiSession(win);
    return win.__guiSession;
  };

  ipcMain.handle("gui:getShortcuts", () => shortcutsJson);

  ipcMain.handle("gui:startSession", async (_event, options) => {
    if (options !== null && typeof options !== "object") {
      throw new Error("Ungültige Optionen");
    }
    const opts = options || {};
    const manager = sessionFor().ensureManager(opts);
    const state = await manager.request({ type: "get_state" });
    return state;
  });

  ipcMain.handle("gui:stopSession", async () => {
    const session = getWindow().__guiSession;
    if (!session || !session.manager) return { stopped: false };
    return { stopped: await session.stop() };
  });

  ipcMain.handle("gui:getState", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "get_state" });
  });

  ipcMain.handle("gui:newSession", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "new_session" });
  });

  ipcMain.handle("gui:getMessages", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "get_messages" });
  });

  ipcMain.handle("gui:prompt", async (_event, rawMessage) => {
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
      throw new Error("Prompt muss ein nicht-leerer Text sein");
    }
    if (rawMessage.length > MAX_PROMPT_LENGTH) {
      throw new Error("Prompt überschreitet die zulässige Länge");
    }
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "prompt", message: rawMessage });
  });

  ipcMain.handle("gui:abort", async () => {
    const session = getWindow().__guiSession;
    if (!session || !session.manager) throw new Error("Pi läuft nicht");
    return session.manager.abort();
  });

  ipcMain.handle("gui:setModel", async (_event, payload) => {
    if (
      !payload ||
      typeof payload.provider !== "string" ||
      typeof payload.modelId !== "string"
    ) {
      throw new Error("setModel braucht provider und modelId");
    }
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({
      type: "set_model",
      provider: payload.provider.slice(0, 200),
      modelId: payload.modelId.slice(0, 200),
    });
  });

  ipcMain.handle("gui:setThinkingLevel", async (_event, level) => {
    const allowed = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    if (!allowed.includes(level)) {
      throw new Error(
        `Unbekannter Thinking-Level: ${String(level).slice(0, 40)}`,
      );
    }
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({
      type: "set_thinking_level",
      level,
    });
  });

  ipcMain.handle("gui:listModels", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "get_available_models" });
  });

  ipcMain.handle("gui:listThinkingLevels", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({
      type: "get_available_thinking_levels",
    });
  });

  ipcMain.handle("gui:listCommands", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "get_commands" });
  });

  ipcMain.handle("gui:cycleModel", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "cycle_model" });
  });

  ipcMain.handle("gui:cycleThinkingLevel", async () => {
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({ type: "cycle_thinking_level" });
  });

  /** Liest die letzten Sitzungsdateien aus dem Session-Verzeichnis. */
  ipcMain.handle("gui:listSessions", () => listRecentSessions());

  ipcMain.handle("gui:switchSession", async (_event, sessionPath) => {
    const resolved = resolveSessionPath(sessionPath);
    if (!resolved) throw new Error("Ungültiger Sitzungspfad");
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    return session.manager.request({
      type: "switch_session",
      sessionPath: resolved,
    });
  });

  ipcMain.handle("gui:getStats", async () => {
    const session = sessionFor();
    return session.getStats();
  });

  /**
   * Extension-UI-Antworten (z. B. Selector des /permission-Flows).
   * Payload wird strikt auf die vom RPC-Dokument erlaubten Felder
   * begrenzt — keine freien Objekte aus dem Renderer.
   */
  ipcMain.handle("gui:respondUiRequest", async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Ungültige UI-Antwort");
    }
    const session = sessionFor();
    if (!session.manager || !session.manager.running) {
      throw new Error("Pi läuft nicht");
    }
    const allowedMethods = ["select", "confirm", "input", "editor", "notify"];
    if (!allowedMethods.includes(payload.method)) {
      throw new Error(
        `Unbekannte UI-Methode: ${String(payload.method).slice(0, 40)}`,
      );
    }
    return session.manager.respondToUiRequest(payload);
  });

  /**
   * Copy-Button der Codeblock-Komponente (Phase 3, §9): geht über das
   * Electron-`clipboard`-Modul im Main-Prozess statt über die Web-
   * Clipboard-API im Renderer, damit das Verhalten unter `sandbox:true`
   * deterministisch bleibt und keine Berechtigungsabfrage nötig ist.
   */
  ipcMain.handle("gui:copyToClipboard", (_event, text) => {
    if (typeof text !== "string") {
      throw new Error("Zwischenablage erwartet Text");
    }
    if (text.length > MAX_CLIPBOARD_LENGTH) {
      throw new Error(
        "Text für Zwischenablage überschreitet die zulässige Länge",
      );
    }
    // Lazy require: hält main/ipc-handlers.js außerhalb von Electron
    // (node:test) ladbar, ohne den echten Aufrufpfad zu ändern.
    require("electron").clipboard.writeText(text);
    return { copied: true };
  });
}

module.exports = { GuiSession, registerIpcHandlers, resolveSessionPath };
