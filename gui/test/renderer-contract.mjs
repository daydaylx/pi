import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiDir = path.resolve(here, "..");
const read = (relative) => readFileSync(path.join(guiDir, relative), "utf8");

const renderer = read("renderer/renderer.js");
const styles = read("renderer/styles.css");
const preload = read("main/preload.cjs");
const main = read("main/index.js");
const ipc = read("main/ipc-handlers.js");

test("Extension-Dialoge beantworten Escape und Close genau einmal", () => {
  assert.match(renderer, /function openExtensionDialog/);
  assert.match(renderer, /dialog\.addEventListener\("cancel"/);
  assert.match(renderer, /finish\(\{ cancelled: true \}\)/);
  assert.match(renderer, /dialog\.addEventListener\("close"/);
  assert.match(renderer, /const respondOnce = interactions\.once/);
});

test("Renderer nutzt dokumentierte Core-Operationen für Sessions und Verlauf", () => {
  assert.match(
    preload,
    /newSession: \(\) => ipcRenderer\.invoke\("gui:newSession"\)/,
  );
  assert.match(
    preload,
    /getMessages: \(\) => ipcRenderer\.invoke\("gui:getMessages"\)/,
  );
  assert.match(ipc, /ipcMain\.handle\("gui:newSession"/);
  assert.match(ipc, /ipcMain\.handle\("gui:getMessages"/);
  assert.match(renderer, /await api\.newSession\(\)/);
  assert.match(renderer, /await api\.getMessages\(\)/);
});

test("Smoke startet keine normale persistente Boot-Session parallel", () => {
  assert.match(main, /query: \{ smoke: smokeMode \}/);
  assert.match(renderer, /const isSmokeMode = new URLSearchParams/);
  assert.match(renderer, /if \(!isSmokeMode\) \{/);
});

test("Subagenten-Aufrufe verschiedener Rollen teilen sich keine Activity-Karte (Phase 10)", () => {
  // ensureActivityCard trennt Karten zusätzlich per groupKey — sonst
  // würden zwei verschiedene Subagenten-Rollen hintereinander in einer
  // gemeinsamen, generisch betitelten "Subagent"-Karte verschwinden.
  assert.match(
    renderer,
    /last\.phase === phase && last\.groupKey === groupKey/,
  );
  assert.match(renderer, /kind === "agent" && msg\.toolName === "subagent"/);
  assert.match(renderer, /interactions\.agentDisplayLabel\(agentRole\)/);
});

test("Dialog-Smoke prüft Escape und die anschließende Core-Verbindung", () => {
  assert.match(main, /--smoke-dialogs/);
  assert.match(renderer, /mode === "dialogs"/);
  assert.match(renderer, /api\.prompt\("\/gui-smoke-dialog"\)/);
  assert.match(renderer, /new Event\("cancel", \{ cancelable: true \}\)/);
  assert.match(renderer, /const recovered = await api\.getState\(\)/);
  assert.match(ipc, /"editor"/);
});

test("Lokale Slash-Commands synchronisieren Busy aus dem Core-State", () => {
  assert.match(renderer, /applyRuntimeState\(await api\.getState\(\)\)/);
  assert.match(renderer, /typeof runtimeState\?\.isStreaming === "boolean"/);
});

test("Streaming erhält Thinking und Tool-Updates, ohne Leseposition zu erzwingen", () => {
  assert.match(renderer, /ev\.type === "thinking_delta"/);
  assert.match(renderer, /case "tool_execution_update"/);
  assert.match(renderer, /function scrollToBottom\(force = false\)/);
  assert.match(renderer, /!force && !state\.followScroll/);
});

test("Schmale Dialoge und Inspector-Drawer-Toggle haben CSS-Regeln", () => {
  assert.match(styles, /width: min\(620px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /body\.context-open #context-area/);
});
