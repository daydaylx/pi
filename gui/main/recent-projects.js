/**
 * Persistiert zuletzt geöffnete Projektordner (Projektauswahl-Fix).
 * Kein Electron-Zugriff beim Modul-Laden (nur lazy in
 * recentProjectsFilePath()), damit das Modul auch unter dem reinen
 * Node-Test-Runner ladbar bleibt — Muster wie clipboard/shell in
 * ipc-handlers.js.
 */
"use strict";

const path = require("node:path");
const os = require("node:os");
const {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} = require("node:fs");

const MAX_ENTRIES = 10;

function recentProjectsFilePath() {
  if (process.env.PI_GUI_RECENT_PROJECTS_FILE) {
    return process.env.PI_GUI_RECENT_PROJECTS_FILE;
  }
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "recent-projects.json");
  } catch {
    // Kein echter Electron-Main-Prozess und kein Override (z. B. ein
    // reiner Node-Testlauf) — Persistenz ist ein Komfortfeature, kein
    // hartes Erfordernis: auf ein Tmp-Verzeichnis ausweichen statt zu werfen.
    return path.join(os.tmpdir(), "pi-gui-recent-projects.json");
  }
}

function readEntries() {
  const file = recentProjectsFilePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.path === "string" &&
        typeof entry.lastOpened === "number",
    );
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  const file = recentProjectsFilePath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(entries, null, 2));
  } catch {
    /* Persistenz ist ein Komfortfeature, kein hartes Erfordernis */
  }
}

/** Zuletzt geöffnete Projekte, neueste zuerst, auf noch existierende
 * Verzeichnisse gefiltert. Die Reihenfolge kommt aus der Persistenz
 * (rememberProject hält sie aktuell) statt aus einer erneuten Sortierung
 * nach lastOpened — zwei Aufrufe in derselben Millisekunde hätten sonst
 * eine durch Sort-Stabilität zufällige Reihenfolge statt Einfüge-Reihenfolge. */
function loadRecentProjects() {
  return readEntries()
    .filter((entry) => existsSync(entry.path))
    .slice(0, MAX_ENTRIES);
}

/** Merkt sich ein Projekt als zuletzt geöffnet (Upsert + Deckelung). Neu
 * an den Anfang statt neu Sortieren nach Zeitstempel — siehe
 * loadRecentProjects(). */
function rememberProject(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return;
  const entries = readEntries().filter((entry) => entry.path !== cwd);
  entries.unshift({ path: cwd, lastOpened: Date.now() });
  writeEntries(entries.slice(0, MAX_ENTRIES));
}

module.exports = {
  loadRecentProjects,
  rememberProject,
  recentProjectsFilePath,
};
