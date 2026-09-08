#!/usr/bin/env bash
# Prueft das Ruby-Serverprofil aus extensions/lsp/server-profiles.ts gegen
# den in instruction.md festgelegten Kontrakt: mechanische Feld-/Mapping-
# Pruefung per jiti-Import (unabhaengig davon, ob der Agent selbst Tests
# ergaenzt hat), plus die vom Agenten erwartete LSP-Testsuite und die
# docs/lsp.md-Erwaehnung.
set -euo pipefail

if ! PI_TEST_SUITE=lsp node tests/run.mjs > /tmp/real-03-lsp-suite.log 2>&1; then
  echo "FAIL: PI_TEST_SUITE=lsp node tests/run.mjs ist fehlgeschlagen:"
  tail -n 40 /tmp/real-03-lsp-suite.log
  exit 1
fi
if ! grep -q "0 failed" /tmp/real-03-lsp-suite.log; then
  echo "FAIL: LSP-Testsuite meldet Fehlschlaege:"
  tail -n 40 /tmp/real-03-lsp-suite.log
  exit 1
fi

if ! grep -qi "ruby" docs/lsp.md; then
  echo "FAIL: docs/lsp.md enthaelt keine Ruby-Zeile"
  exit 1
fi

node --input-type=module -e '
import { importModule } from "./tests/shared/jiti-loader.mjs";
const mod = await importModule("extensions/lsp/server-profiles.ts");
const ruby = mod.PROFILES && mod.PROFILES.ruby;
if (!ruby) {
  console.error("FAIL: PROFILES.ruby fehlt");
  process.exit(1);
}
if (ruby.id !== "ruby") {
  console.error(`FAIL: PROFILES.ruby.id ist ${JSON.stringify(ruby.id)}, erwartet "ruby"`);
  process.exit(1);
}
if (ruby.enabled !== false) {
  console.error(`FAIL: PROFILES.ruby.enabled ist ${JSON.stringify(ruby.enabled)}, erwartet exakt false (nicht nur falsy)`);
  process.exit(1);
}
if (ruby.command !== "solargraph") {
  console.error(`FAIL: PROFILES.ruby.command ist ${JSON.stringify(ruby.command)}, erwartet "solargraph"`);
  process.exit(1);
}
if (!Array.isArray(ruby.args) || !ruby.args.includes("stdio")) {
  console.error(`FAIL: PROFILES.ruby.args enthaelt kein "stdio": ${JSON.stringify(ruby.args)}`);
  process.exit(1);
}
if (!Array.isArray(ruby.rootMarkers) || !ruby.rootMarkers.includes("Gemfile")) {
  console.error(`FAIL: PROFILES.ruby.rootMarkers enthaelt kein "Gemfile": ${JSON.stringify(ruby.rootMarkers)}`);
  process.exit(1);
}
const map = mod.EXTENSION_LANGUAGE_MAP || {};
for (const ext of [".rb", ".rake"]) {
  const entry = map[ext];
  if (!entry || entry.profileId !== "ruby") {
    console.error(`FAIL: EXTENSION_LANGUAGE_MAP[${JSON.stringify(ext)}] mappt nicht auf profileId "ruby": ${JSON.stringify(entry)}`);
    process.exit(1);
  }
}
console.log("server-profiles.ts: Ruby-Profil und Mapping OK");
'

echo "SCORE:100"
exit 0
