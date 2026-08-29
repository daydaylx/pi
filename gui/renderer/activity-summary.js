/**
 * Reine Hilfsfunktionen für die kompakte Tool-Aktivitätszeile (Phase 6).
 * Keine DOM- und keine Pi-Abhängigkeit: dieselbe Funktion speist den
 * Renderer und die Unit-Tests.
 *
 * Die Zeile fasst Werkzeugaufrufe eines Abschnitts zusammen, damit
 * Tool-Aktivität sekundär bleibt:
 *   ✓ 8 Reads · ✓ 3 Suchen · ● 1 Shell · ✓ 1 Edit
 */
"use strict";

const CATEGORY_BY_TOOL = {
  read: "Reads",
  grep: "Suchen",
  find: "Suchen",
  ls: "Suchen",
  bash: "Shell",
  edit: "Edits",
  write: "Edits",
  web_search: "Web",
  fetch_content: "Web",
  source_check: "Web",
};

const CATEGORY_ORDER = ["Reads", "Suchen", "Shell", "Edits", "Web", "Tools"];

/** Ordnet ein Werkzeug einer Anzeigekategorie zu. */
function categoryFor(toolName) {
  const name = String(toolName ?? "").toLowerCase();
  return CATEGORY_BY_TOOL[name] ?? "Tools";
}

/**
 * Verdichtet eine Liste von Werkzeug-Zuständen zu einer kurzen Zeile.
 * Einträge: { toolName, running, isError }. Laufende Werkzeuge werden
 * mit ● angekündigt, abgeschlossene mit ✓ (✗ bei Fehler).
 */
function formatActivityLine(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const category = categoryFor(entry.toolName);
    const group = groups.get(category) ?? { done: 0, failed: 0, running: 0 };
    if (entry.running) group.running += 1;
    else if (entry.isError) group.failed += 1;
    else group.done += 1;
    groups.set(category, group);
  }
  const parts = [];
  for (const category of CATEGORY_ORDER) {
    const group = groups.get(category);
    if (!group) continue;
    const bits = [];
    if (group.done > 0) bits.push(`✓ ${group.done} ${category}`);
    if (group.failed > 0) bits.push(`✗ ${group.failed} ${category}`);
    if (group.running > 0) bits.push(`● ${group.running} ${category}`);
    parts.push(...bits);
  }
  return parts.join(" · ");
}

if (typeof window !== "undefined") {
  window.piGuiActivity = { categoryFor, formatActivityLine };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { categoryFor, formatActivityLine };
}
