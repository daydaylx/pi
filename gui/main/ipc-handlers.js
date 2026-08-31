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
const { loadRecentProjects, rememberProject } = require("./recent-projects.js");

const MAX_PROMPT_LENGTH = 100_000;
const MAX_CLIPBOARD_LENGTH = 500_000;
const MAX_URL_LENGTH = 2_048;
/** Deckt sich bewusst mit chat/markdown.js SAFE_LINK_PROTOCOLS — der
 * Main-Prozess vertraut der Renderer-Prüfung nicht und validiert erneut. */
const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

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

/** Obergrenze für den Tail-Read einer Sitzungsdatei (Task-Status-Ableitung,
 * Phase 2 Task-Sidebar): groß genug für mehrere frontend-bridge/state-
 * Einträge, klein genug um auch bei sehr langen Sitzungen nicht die ganze
 * Datei einzulesen (R21). */
const TASK_STATE_TAIL_BYTES = 200_000;

/**
 * Letzter bekannter Core-Zustand einer (ggf. nicht laufenden) Sitzung —
 * reines Nachlesen der bereits vom frontend-bridge persistierten
 * Custom-Einträge (kein neuer State, keine Core-Änderung, R2). Wird für
 * die Task-Sidebar (Phase 2) genutzt, um ruhende Sitzungen ACTIVE/NEEDS
 * INPUT/REVIEW/COMPLETED zuzuordnen, ohne dafür einen Prozess zu starten.
 */
async function readLastFrontendState(filePath) {
  let raw;
  try {
    const stat = await fsPromises.stat(filePath);
    if (stat.size <= TASK_STATE_TAIL_BYTES) {
      raw = await fsPromises.readFile(filePath, "utf8");
    } else {
      const handle = await fsPromises.open(filePath, "r");
      try {
        const buf = Buffer.alloc(TASK_STATE_TAIL_BYTES);
        await handle.read(
          buf,
          0,
          TASK_STATE_TAIL_BYTES,
          stat.size - TASK_STATE_TAIL_BYTES,
        );
        raw = buf.toString("utf8");
      } finally {
        await handle.close();
      }
    }
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes("frontend-bridge/state")) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed?.customType === "frontend-bridge/state" &&
        parsed.data?.state
      ) {
        return parsed.data.state;
      }
    } catch {
      /* am Tail-Beginn abgeschnittene Zeile oder Fremdformat überspringen */
    }
  }
  return null;
}

/** Obergrenze für den Diff-Read einer Sitzungsdatei (Phase 6 Changes Review):
 * groß genug für realistische Session-Diffs, klein genug um bei sehr langen
 * Sitzungen den Main-Prozess nicht zu blockieren (R21). Wie bei
 * TASK_STATE_TAIL_BYTES ein Tail-Read — sehr frühe Änderungen einer extrem
 * langen Sitzung können dadurch fehlen (bekannte, dokumentierte Grenze,
 * siehe Entscheidungslog Phase 6). */
const DIFF_TAIL_BYTES = 1_000_000;

/**
 * Liest die "diff-view"-Custom-Einträge einer Sitzungsdatei (vom
 * diff-viewer-Extension bereits persistiert, kein neuer Core-State, R2/R6)
 * und reduziert sie auf den jeweils letzten Stand je Datei — dieselbe
 * "letzter Eintrag gewinnt"-Semantik wie ChangeTracker.changedFiles in
 * extensions/diff-viewer/change-tracker.ts, nur außerhalb des laufenden
 * Prozesses nachgebildet für ruhende bzw. gerade gewechselte Sitzungen.
 */
async function readSessionDiffs(filePath) {
  let raw;
  try {
    const stat = await fsPromises.stat(filePath);
    if (stat.size <= DIFF_TAIL_BYTES) {
      raw = await fsPromises.readFile(filePath, "utf8");
    } else {
      const handle = await fsPromises.open(filePath, "r");
      try {
        const buf = Buffer.alloc(DIFF_TAIL_BYTES);
        await handle.read(buf, 0, DIFF_TAIL_BYTES, stat.size - DIFF_TAIL_BYTES);
        raw = buf.toString("utf8");
      } finally {
        await handle.close();
      }
    }
  } catch {
    return [];
  }
  const byPath = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("diff-view")) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // am Tail-Beginn abgeschnittene Zeile überspringen
    }
    if (parsed?.customType !== "diff-view") continue;
    const data = parsed.data;
    if (
      !data ||
      typeof data.path !== "string" ||
      !data.stats ||
      !Array.isArray(data.hunks)
    ) {
      continue;
    }
    byPath.set(data.path, {
      path: data.path,
      stats: data.stats,
      hunks: data.hunks,
      toolName: typeof data.toolName === "string" ? data.toolName : "unknown",
      timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
    });
  }
  return [...byPath.values()].sort((a, b) => b.timestamp - a.timestamp);
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
      const lastState = await readLastFrontendState(entry.path);
      return { path: entry.path, mtimeMs: entry.mtimeMs, title, lastState };
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
    if (cwdOption) {
      rememberProject(cwdOption);
      try {
        this.win.setTitle(`Pi — ${path.basename(cwdOption)}`);
      } catch {
        /* Fenster evtl. bereits geschlossen */
      }
    }
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

  /** Nativer Ordner-Dialog für die Projektauswahl (Main-Prozess-only,
   * keine CSP-Implikation für den Renderer). */
  ipcMain.handle("gui:pickProjectFolder", async () => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }
    return { path: result.filePaths[0] };
  });

  ipcMain.handle("gui:listRecentProjects", () => loadRecentProjects());

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

  /** Phase 6 (Changes Review): letzter bekannter Diff-Stand je Datei einer
   * Sitzung, reines Nachlesen persistierter Custom-Einträge (R2/R6, siehe
   * readSessionDiffs). Genutzt beim Sitzungswechsel, damit die Changes-
   * Ansicht auch für bereits vor dem Wechsel entstandene Änderungen echte
   * Diffs zeigt statt nur die von diesem Zeitpunkt an live gestreamten. */
  ipcMain.handle("gui:getSessionDiffs", async (_event, sessionPath) => {
    const resolved = resolveSessionPath(sessionPath);
    if (!resolved) throw new Error("Ungültiger Sitzungspfad");
    return readSessionDiffs(resolved);
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

  /**
   * Links im gerenderten Markdown (Phase 3): das Fenster blockt jede
   * Navigation und jedes neue Fenster (siehe main/index.js), also muss
   * ein Klick auf einen sicheren Link explizit über das OS geöffnet
   * werden statt in-app zu navigieren. Zweite, unabhängige Prüfung
   * gegen die Schema-Positivliste — der Renderer filtert bereits beim
   * Rendern (chat/markdown.js), aber der Main-Prozess vertraut dem
   * Renderer hier nicht blind (R14).
   */
  ipcMain.handle("gui:openExternal", async (_event, url) => {
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("Ungültige URL");
    }
    if (url.length > MAX_URL_LENGTH) {
      throw new Error("URL überschreitet die zulässige Länge");
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Ungültige URL");
    }
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`Nicht erlaubtes URL-Schema: ${parsed.protocol}`);
    }
    await require("electron").shell.openExternal(parsed.href);
    return { opened: true };
  });
}

module.exports = {
  GuiSession,
  registerIpcHandlers,
  resolveSessionPath,
  readSessionDiffs,
};
