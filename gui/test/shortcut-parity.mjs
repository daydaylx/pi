// Shortcut-Parität (Phase 4): Die GUI-Shortcut-Tabelle muss exakt der
// kanonischen Mapping-Tabelle aus dem Frontend-Protokoll entsprechen,
// und jede Command-ID braucht im Renderer eine Aktion.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

const mappingSource = readFileSync(
  path.join(repo, "extensions/frontend-protocol/shortcut-mapping.ts"),
  "utf8",
);
const shortcutsJson = JSON.parse(
  readFileSync(path.join(repo, "gui/shared/shortcuts.json"), "utf8"),
);
const rendererSource = readFileSync(
  path.join(repo, "gui/renderer/renderer.js"),
  "utf8",
);

test("GUI-Shortcuttabelle entspricht dem Frontend-Protokoll", () => {
  const protocolPairs = [...mappingSource.matchAll(/keys: "(.+?)"/g)].map(
    (m) => m[1],
  );
  const guiKeys = shortcutsJson.map((row) => row.keys);
  assert.deepEqual(
    guiKeys.sort(),
    protocolPairs.sort(),
    "gleiche Tasten in Protokoll und GUI",
  );
});

/** Parst keys/command/portable je Eintrag aus dem TS-Quelltext (keine
 * TS-Ausführung nötig) — echter Paar-Abgleich statt unabhängiger
 * Teilstring-Treffer. */
function parseMappingEntries(source) {
  const entryRe =
    /keys:\s*"([^"]+)"\s*,\s*command:\s*"([^"]+)"\s*,\s*portable:\s*(true|false)/g;
  const entries = new Map();
  for (const match of source.matchAll(entryRe)) {
    entries.set(match[1], { command: match[2], portable: match[3] === "true" });
  }
  return entries;
}

test("Jede GUI-Zeile trägt dasselbe Ziel-Command wie das Protokoll", () => {
  const protocolEntries = parseMappingEntries(mappingSource);
  for (const row of shortcutsJson) {
    const entry = protocolEntries.get(row.keys);
    assert.ok(entry, `${row.keys} existiert im Protokoll`);
    assert.equal(
      entry.command,
      row.command,
      `${row.keys}: Protokoll und GUI zielen auf dasselbe Command`,
    );
  }
});

test("Portabilität ist zwischen Protokoll und GUI-Spiegel synchron", () => {
  const protocolEntries = parseMappingEntries(mappingSource);
  for (const row of shortcutsJson) {
    const entry = protocolEntries.get(row.keys);
    assert.ok(entry, `${row.keys} existiert im Protokoll`);
    assert.equal(
      entry.portable,
      row.portable,
      `${row.keys}: portable-Flag stimmt zwischen shortcut-mapping.ts und shortcuts.json überein`,
    );
  }
});

test("Jede Command-ID ist im Renderer verdrahtet (Klick und Taste)", () => {
  for (const row of shortcutsJson) {
    assert.ok(
      rendererSource.includes(`"${row.command}":`),
      `renderer.js definiert eine Aktion für ${row.command}`,
    );
  }
});

test("Nicht-portable Shortcuts tragen einen sichtbaren Grund (R13)", () => {
  for (const row of shortcutsJson) {
    if (!row.portable) {
      assert.ok(
        typeof row.note === "string" && row.note.length > 10,
        `${row.keys}: nicht portabel ohne dokumentierten Grund`,
      );
    }
  }
});
