/**
 * Statisches Sicherheits-Gate der GUI (Phase 7). Prüft die Pflichtpunkte
 * aus Dokument 12 ohne laufenden Electron-Prozess: Isolation, Sandbox,
 * IPC-Whitelist, CSP, keine Shell-/Secret-Pfade im Renderer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiDir = path.resolve(here, "..");
const read = (rel) => readFileSync(path.join(guiDir, rel), "utf8");

const mainSource = read("main/index.js");
const preloadSource = read("main/preload.cjs");
const ipcSource = read("main/ipc-handlers.js");
const managerSource = read("main/pi-rpc-manager.js");
const htmlSource = read("renderer/index.html");
const rendererSource = read("renderer/renderer.js");
const bridgeSource = read("../extensions/frontend-bridge/index.ts");

test("Fenster läuft mit härtester Isolation", () => {
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /webviewTag:\s*false/);
});

test("Navigation und Popups sind global blockiert", () => {
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /will-navigate/);
  assert.match(mainSource, /event\.preventDefault\(\)/);
  assert.match(mainSource, /web-contents-created/);
});

test("Renderer hat keine Node-Zugriffe", () => {
  assert.doesNotMatch(rendererSource, /require\s*\(\s*["']node:/);
  assert.doesNotMatch(rendererSource, /\beval\s*\(/);
  assert.doesNotMatch(rendererSource, /new\s+Function\s*\(/);
  assert.doesNotMatch(rendererSource, /child_process/);
});

test("Preload exponiert nur die piGui-Brücke, nie ipcRenderer selbst", () => {
  const exposed = preloadSource.match(/exposeInMainWorld\(/g) ?? [];
  assert.equal(exposed.length, 1, "genau eine Exponierung");
  assert.match(preloadSource, /exposeInMainWorld\("piGui"/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\("ipcRenderer"/);
  assert.doesNotMatch(preloadSource, /require\s*\(\s*["']node:/);
  assert.doesNotMatch(preloadSource, /child_process/);
});

test("IPC-Kanäle sind eine gui:-Whitelist ohne freie Passthroughs", () => {
  const channels = [...ipcSource.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(channels.length >= 10, "erwartete Handler-Dichte");
  for (const channel of channels) {
    assert.ok(channel.startsWith("gui:"), `Whitelist-Kanal: ${channel}`);
  }
  assert.doesNotMatch(ipcSource, /ipcMain\.handle\("gui:raw"/);
  assert.doesNotMatch(ipcSource, /ipcMain\.on\("[^"]*"\s*,/);
});

test("Prompts und Pfade werden validiert, Shell-IPC existiert nicht", () => {
  assert.match(ipcSource, /MAX_PROMPT_LENGTH/);
  assert.match(ipcSource, /Ungültiger Sitzungspfad/);
  assert.doesNotMatch(ipcSource, /\bexecSync\b/);
  // Der einzige Kindprozess ist der kontrollierte pi-RPC-Prozess.
  assert.match(managerSource, /spawn\(this\.piPath, this\.args/);
});

test("CSP lässt nur lokale Skripte und Stile zu", () => {
  assert.match(htmlSource, /default-src 'none'/);
  assert.match(htmlSource, /script-src 'self'/);
  assert.match(htmlSource, /style-src 'self'/);
  assert.match(htmlSource, /connect-src 'none'/);
});

test("GUI-Bridge hängt nicht von Aurora-Implementierungsdetails ab", () => {
  assert.doesNotMatch(bridgeSource, /\.\.\/aurora-ui\/state\.ts/);
  assert.match(bridgeSource, /frontend-protocol\/state-helpers\.ts/);
});

test("Keine Geheimnisse oder Umgebungsvariablen im Renderer", () => {
  assert.doesNotMatch(rendererSource, /process\.env/);
  assert.doesNotMatch(rendererSource, /API[_-]?KEY/i);
  assert.doesNotMatch(rendererSource, /readFileSync/);
});
