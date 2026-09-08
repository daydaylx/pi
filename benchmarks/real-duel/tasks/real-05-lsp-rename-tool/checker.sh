#!/usr/bin/env bash
# Prueft lsp_rename gegen den in instruction.md festgelegten Kontrakt.
# Der Sicherheitsteil (Permission-Grenze) wird VOM CHECKER SELBST geprueft,
# nicht nur ueber vom Agenten geschriebene Tests -- ein Agent, der lsp_rename
# aus Bequemlichkeit in LOCAL_LSP_TOOLS eintraegt, faellt so unabhaengig
# davon durch, ob er selbst einen entsprechenden Test geschrieben hat.
set -euo pipefail

if ! PI_TEST_SUITE=lsp node tests/run.mjs > /tmp/real-05-lsp-suite.log 2>&1; then
  echo "FAIL: PI_TEST_SUITE=lsp node tests/run.mjs ist fehlgeschlagen:"
  tail -n 60 /tmp/real-05-lsp-suite.log
  exit 1
fi
if ! grep -q "0 failed" /tmp/real-05-lsp-suite.log; then
  echo "FAIL: LSP-Testsuite meldet Fehlschlaege:"
  tail -n 60 /tmp/real-05-lsp-suite.log
  exit 1
fi

if ! node tests/workflow-mode/permissions.test.mjs > /tmp/real-05-permissions.log 2>&1; then
  echo "FAIL: tests/workflow-mode/permissions.test.mjs ist fehlgeschlagen:"
  tail -n 60 /tmp/real-05-permissions.log
  exit 1
fi

if ! grep -qi "lsp_rename" docs/lsp.md; then
  echo "FAIL: docs/lsp.md erwaehnt lsp_rename nicht"
  exit 1
fi

node --input-type=module -e '
import { importModule } from "./tests/shared/jiti-loader.mjs";
const workflowPolicy = await importModule("extensions/permissions/workflow-policy.ts");
const toolPolicy = await importModule("extensions/permissions/tool-policy.ts");

if (workflowPolicy.LOCAL_LSP_TOOLS && workflowPolicy.LOCAL_LSP_TOOLS.has("lsp_rename")) {
  console.error("FAIL: lsp_rename steht in LOCAL_LSP_TOOLS -- das ist das pauschale Read-only-Allow-Set der uebrigen lsp_*-Tools. Eine MUTATION darf dort nicht eingetragen sein.");
  process.exit(1);
}

const cwd = process.cwd();
const event = {
  toolName: "lsp_rename",
  input: { path: "extensions/lsp/tools.ts", line: 0, character: 0, newName: "renamed" },
};
const config = { unknownTools: "ask", bash: "ask" };

const readonlyDecision = toolPolicy.decideTool("readonly", event, cwd, config);
if (readonlyDecision.action !== "block") {
  console.error(`FAIL: decideTool("readonly", lsp_rename, ...) liefert action=${JSON.stringify(readonlyDecision.action)}, erwartet "block" (wie write/edit im selben Level). lsp_rename ist eine Mutation und muss denselben Freigabepfad durchlaufen wie write/edit.`);
  process.exit(1);
}

const outsideProjectEvent = {
  toolName: "lsp_rename",
  input: { path: "/etc/passwd", line: 0, character: 0, newName: "renamed" },
};
const outsideDecision = toolPolicy.decideTool("project-write", outsideProjectEvent, cwd, config);
if (outsideDecision.action === "allow") {
  console.error(`FAIL: decideTool("project-write", lsp_rename mit Pfad ausserhalb des Projekts, ...) liefert action="allow" -- die Projekt-Pfadgrenze wird nicht respektiert.`);
  process.exit(1);
}

console.log("lsp_rename: Permission-Grenze OK (nicht pauschal erlaubt, readonly blockiert, Pfadgrenze respektiert)");
'

echo "SCORE:100"
exit 0
