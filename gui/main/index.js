/**
 * Electron-Main: erzeugt das Fenster mit härtesten Sicherheitsvorgaben
 * (contextIsolation, sandbox, kein Node im Renderer), registriert die
 * IPC-Whitelist und bietet headless-Smoke-Modi (--smoke, --smoke-tools,
 * --smoke-dialogs) für xvfb-basierte End-to-End-Läufe über die echte
 * Preload-Bridge.
 */
"use strict";

const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const shortcutsJson = require("../shared/shortcuts.json");
const { registerIpcHandlers } = require("./ipc-handlers.js");

let mainWindow = null;
const smokeMode = process.argv.includes("--smoke-dialogs")
  ? "dialogs"
  : process.argv.includes("--smoke")
    ? "plain"
    : process.argv.includes("--smoke-tools")
      ? "tools"
      : null;

const SMOKE_TIMEOUT_MS = 180_000;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Pi",
    show: !smokeMode,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // Keine Navigation, keine Popups: Das Fenster zeigt nur unsere Datei.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
  if (smokeMode) win.loadFile(rendererPath, { query: { smoke: smokeMode } });
  else win.loadFile(rendererPath);
  return win;
}

app.on("window-all-closed", () => {
  const cleanup =
    mainWindow && mainWindow.__guiSession && mainWindow.__guiSession.manager
      ? mainWindow.__guiSession.manager.stop()
      : Promise.resolve();
  cleanup.finally(() => app.quit());
});

// Defense in depth (Phase 7): Auch künftig erzeugte Web-Contents dürfen
// weder navigieren noch Fenster öffnen — unabhängig vom Hauptfenster.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

app.whenReady().then(() => {
  mainWindow = createMainWindow();
  registerIpcHandlers(ipcMain, () => mainWindow, shortcutsJson);

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    // Pi-Daten liegen im Pi-Prozess — ein Renderer-Crash kann sie nicht
    // berühren. Sichtbar melden genügt.
    console.error(`[pi-gui] Renderer-Prozess beendet: ${details.reason}`);
  });

  if (!smokeMode) return;

  mainWindow.webContents.once("did-finish-load", () => {
    const script = `window.__piGuiSmoke(${JSON.stringify(smokeMode)})`;
    const timeout = setTimeout(() => {
      console.error("SMOKE FAIL: Timeout");
      app.exit(1);
    }, SMOKE_TIMEOUT_MS);
    mainWindow.webContents
      .executeJavaScript(script, true)
      .then((result) => {
        clearTimeout(timeout);
        if (result && result.ok) {
          console.log(
            `SMOKE PASS (${result.mode}; toolEvents=${result.sawToolStart ? "ja" : "nein"}; text=${JSON.stringify(result.text.slice(-40))})`,
          );
          app.exit(0);
        } else {
          console.error(
            `SMOKE FAIL: ${(result && result.error) || "unbekannt"}`,
          );
          app.exit(1);
        }
      })
      .catch((err) => {
        clearTimeout(timeout);
        console.error(`SMOKE FAIL: ${err}`);
        app.exit(1);
      });
  });
});
