#!/usr/bin/env bash
# Prueft den --provider-Filter aus extensions/session-health/ gegen den in
# instruction.md festgelegten Kontrakt. Die volle Report-Filterung (mehrere
# sinnvolle Implementierungswege moeglich, siehe Task-Komplexitaetsklasse)
# wird ueber die vom Agenten selbst geforderten Testfaelle in
# tests/workflow-mode/session-health.test.mjs geprueft; zusaetzlich prueft
# dieser Checker unabhaengig den eindeutigen, implementierungsunabhaengigen
# Teil des Kontrakts: das CLI-Argument-Parsing selbst.
set -euo pipefail

if ! node tests/workflow-mode/session-health.test.mjs > /tmp/real-04-session-health.log 2>&1; then
  echo "FAIL: tests/workflow-mode/session-health.test.mjs ist fehlgeschlagen:"
  tail -n 60 /tmp/real-04-session-health.log
  exit 1
fi

node --input-type=module -e '
import { importModule } from "./tests/shared/jiti-loader.mjs";
const mod = await importModule("extensions/session-health/index.ts");
const parse = mod.parseSessionHealthArgs;
if (typeof parse !== "function") {
  console.error("FAIL: parseSessionHealthArgs ist nicht mehr exportiert");
  process.exit(1);
}

const withProvider = parse("--provider qwen-token-plan-individual");
if (withProvider.error) {
  console.error(`FAIL: --provider mit gueltigem Wert wird als Fehler abgelehnt: ${withProvider.error}`);
  process.exit(1);
}
if (withProvider.provider !== "qwen-token-plan-individual") {
  console.error(`FAIL: --provider-Wert wird nicht uebernommen: ${JSON.stringify(withProvider)}`);
  process.exit(1);
}

const combined = parse("--days 3 --provider qwen-token-plan-individual --json");
if (combined.error || combined.provider !== "qwen-token-plan-individual" || combined.days !== 3 || combined.json !== true) {
  console.error(`FAIL: --provider laesst sich nicht mit --days/--json kombinieren: ${JSON.stringify(combined)}`);
  process.exit(1);
}

const missingValue = parse("--provider");
if (!missingValue.error) {
  console.error("FAIL: --provider ohne Wert (am Ende der Argumente) wird nicht als Argumentfehler erkannt");
  process.exit(1);
}

console.log("session-health: --provider CLI-Parsing OK");
'

echo "SCORE:100"
exit 0
