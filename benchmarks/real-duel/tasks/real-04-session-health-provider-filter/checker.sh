#!/usr/bin/env bash
# Prueft den --provider-Filter aus extensions/session-health/ gegen den in
# instruction.md festgelegten Kontrakt.
#
# P0-Fix: die eigentliche Filterlogik (failures.total/byClass/byPhase nur aus
# dem gewaehlten Provider, turns/recovery/permissions/verifier unveraendert,
# unbekannter Provider = leerer Report) wurde bisher NUR ueber die vom
# Agenten selbst geschriebenen Testfaelle in
# tests/workflow-mode/session-health.test.mjs geprueft -- ein Kandidat, der
# dort einen schwachen/tautologischen Test schreibt, haette bestanden. Der
# untere Block prueft die Filterlogik jetzt unabhaengig, direkt ueber den
# tatsaechlichen /session-health-Befehl (Harness + synthetische
# Session-Fixture mit zwei Providern), analog zum Muster in real-05
# (Sicherheitsteil wird VOM CHECKER SELBST geprueft, nicht nur ueber
# Agenten-Tests). Das CLI-Parsing bleibt zusaetzlich unabhaengig geprueft.
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

node --input-type=module -e '
import { importModule } from "./tests/shared/jiti-loader.mjs";
import { createHarness } from "./tests/shared/harness.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

// Eigene, isolierte Session-Fixture -- PI_CODING_AGENT_DIR umlenken, damit
// der Command-Handler (der intern getAgentDir() aufruft) nicht die echte
// ~/.pi/agent/sessions-Historie der ausfuehrenden Maschine liest.
const dir = mkdtempSync(join(tmpdir(), "real-04-provider-filter-"));
process.env.PI_CODING_AGENT_DIR = dir;
// Jeder fruehe process.exit(1) auf einem FAIL-Pfad unten wuerde die
// explizite rmSync() am Skriptende sonst ueberspringen und dir unter
// /tmp zuruecklassen -- process.on("exit", ...) feuert synchron auch nach
// process.exit(), deckt also alle Ausstiegspfade ab.
process.on("exit", () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

function entry(customType, data, ts) {
  return { type: "custom", customType, timestamp: ts, data: { schemaVersion: 2, timestamp: ts, ...data } };
}

const SESSION = [
  entry("resilience.turn-start", {}, "2026-08-18T10:00:00.000Z"),
  entry("resilience.turn-settled", { turnStartedAt: "2026-08-18T10:00:00.000Z", outcome: "completed", observedFailureCount: 0 }, "2026-08-18T10:00:01.000Z"),

  entry("resilience.turn-start", {}, "2026-08-18T10:01:00.000Z"),
  entry("resilience.failure", { provider: "provider-alpha", model: "m-a", errorClass: "stream", errorCode: "STREAM_PHASE", phase: "streaming_text" }, "2026-08-18T10:01:01.000Z"),
  entry("resilience.turn-settled", { turnStartedAt: "2026-08-18T10:01:00.000Z", outcome: "failed", observedFailureCount: 1, recoveryPending: true }, "2026-08-18T10:01:02.000Z"),
  entry("resilience.recovery-required", { turnStartedAt: "2026-08-18T10:01:00.000Z", reason: "final_failure", workspaceChangedSinceTurnStart: false, toolMayHaveMutatedWorkspace: true }, "2026-08-18T10:01:03.000Z"),

  entry("resilience.turn-start", {}, "2026-08-18T10:02:00.000Z"),
  entry("resilience.failure", { provider: "provider-beta", model: "m-b", errorClass: "auth", errorCode: "AUTH_FAILED", phase: "request" }, "2026-08-18T10:02:01.000Z"),
  entry("resilience.turn-settled", { turnStartedAt: "2026-08-18T10:02:00.000Z", outcome: "failed", observedFailureCount: 1 }, "2026-08-18T10:02:02.000Z"),

  { type: "custom", customType: "permission-transition", timestamp: "2026-08-18T10:03:00.000Z", data: { timestamp: "2026-08-18T10:03:00.000Z", source: "command", state: "YOLO_OVERRIDE" } },
  { type: "custom", customType: "permission-transition-denied", timestamp: "2026-08-18T10:03:01.000Z", data: { timestamp: "2026-08-18T10:03:01.000Z", source: "command", attemptedLevel: "yolo", mode: "simple_plan" } },

  { type: "custom", customType: "verifier-run", timestamp: "2026-08-18T10:04:00.000Z", data: { timestamp: "2026-08-18T10:04:00.000Z", agent: "verifier", status: "completed", verdict: "PASS" } },
  { type: "custom", customType: "verifier-run", timestamp: "2026-08-18T10:05:00.000Z", data: { timestamp: "2026-08-18T10:05:00.000Z", agent: "verifier", status: "incomplete", reason: "turn-budget" } },
];

mkdirSync(join(dir, "sessions", "project-a"), { recursive: true });
writeFileSync(join(dir, "sessions", "project-a", "one.jsonl"), SESSION.map((e) => JSON.stringify(e)).join("\n"));

const sessionHealth = await importModule("extensions/session-health/index.ts");
const harness = createHarness();
sessionHealth.default(harness.api);
const ctx = harness.makeContext();

async function runJson(args) {
  await harness.commands.get("session-health")(args, ctx);
  const last = harness.notifications.at(-1);
  if (last.level !== "info") {
    console.error(`FAIL: /session-health ${JSON.stringify(args)} meldete Fehler: ${last.message}`);
    process.exit(1);
  }
  return JSON.parse(last.message);
}

const unfiltered = await runJson("--json");
if (unfiltered.report.failures.total !== 2) {
  console.error(`FAIL: unfiltered failures.total sollte 2 sein (Fixture), ist ${unfiltered.report.failures.total}`);
  process.exit(1);
}

const filteredAlpha = await runJson("--provider provider-alpha --json");
if (filteredAlpha.provider !== "provider-alpha") {
  console.error(`FAIL: JSON-Payload macht den aktiven Filter nicht sichtbar (provider=${JSON.stringify(filteredAlpha.provider)}), erwartet "provider-alpha"`);
  process.exit(1);
}
if (filteredAlpha.report.failures.total !== 1) {
  console.error(`FAIL: gefiltert (provider-alpha) sollte failures.total=1 sein, ist ${filteredAlpha.report.failures.total}`);
  process.exit(1);
}
const filteredProviders = Object.keys(filteredAlpha.report.failures.byProvider ?? {});
if (filteredProviders.some((p) => p !== "provider-alpha")) {
  console.error(`FAIL: failures.byProvider enthaelt nach Filter fremde Provider: ${JSON.stringify(filteredProviders)}`);
  process.exit(1);
}
if ((filteredAlpha.report.failures.byClass?.stream ?? 0) !== 1 || (filteredAlpha.report.failures.byClass?.auth ?? 0) !== 0) {
  console.error(`FAIL: failures.byClass nach Filter falsch: ${JSON.stringify(filteredAlpha.report.failures.byClass)}`);
  process.exit(1);
}
if ((filteredAlpha.report.failures.byPhase?.streaming_text ?? 0) !== 1 || (filteredAlpha.report.failures.byPhase?.request ?? 0) !== 0) {
  console.error(`FAIL: failures.byPhase nach Filter falsch: ${JSON.stringify(filteredAlpha.report.failures.byPhase)}`);
  process.exit(1);
}

try {
  assert.deepStrictEqual(filteredAlpha.report.turns, unfiltered.report.turns, "turns muss bei --provider unveraendert bleiben");
  assert.deepStrictEqual(filteredAlpha.report.recovery, unfiltered.report.recovery, "recovery muss bei --provider unveraendert bleiben");
  assert.deepStrictEqual(filteredAlpha.report.permissions, unfiltered.report.permissions, "permissions muss bei --provider unveraendert bleiben");
  assert.deepStrictEqual(filteredAlpha.report.verifier, unfiltered.report.verifier, "verifier muss bei --provider unveraendert bleiben");
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}

const filteredUnknown = await runJson("--provider provider-does-not-exist --json");
if (filteredUnknown.report.failures.total !== 0) {
  console.error(`FAIL: unbekannter Provider sollte failures.total=0 liefern (kein Fehler), ist ${filteredUnknown.report.failures.total}`);
  process.exit(1);
}

rmSync(dir, { recursive: true, force: true });
console.log("session-health: --provider Filterlogik unabhaengig verifiziert (failures.* gefiltert, turns/recovery/permissions/verifier unveraendert, unbekannter Provider = leerer Report)");
'

echo "SCORE:100"
exit 0
