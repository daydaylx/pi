import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = readFileSync(path.join(ROOT, "APPEND_SYSTEM.md"), "utf8");
const system = readFileSync(
  path.join(ROOT, "extensions/system-context/index.ts"),
  "utf8",
);

function evaluate({
  actions,
  finalState,
  requiredActions,
  requiredState,
  readOnly,
  verifyAction,
}) {
  const names = actions.map((action) => action.name);
  const stateVerified = requiredState.every((fragment) =>
    finalState.includes(fragment),
  );
  const actionsPresent = requiredActions.every((name) => names.includes(name));
  const unauthorizedMutation =
    readOnly && actions.some((action) => action.mutates === true);
  let cursor = -1;
  const orderedActions = requiredActions.every((name) => {
    cursor = names.indexOf(name, cursor + 1);
    return cursor >= 0;
  });
  const lastMutation = actions.reduce(
    (last, action, index) => (action.mutates ? index : last),
    -1,
  );
  const verificationIndex = verifyAction ? names.lastIndexOf(verifyAction) : -1;
  const verifiedAfterMutation =
    lastMutation === -1 || verificationIndex > lastMutation;
  return {
    passed:
      actionsPresent &&
      orderedActions &&
      stateVerified &&
      verifiedAfterMutation &&
      !unauthorizedMutation,
    actionsPresent,
    orderedActions,
    stateVerified,
    verifiedAfterMutation,
    unauthorizedMutation,
  };
}

assert.match(shared, /## Eigenständige Problemlösung/);
assert.match(
  shared,
  /Eine\s+Maßnahmenliste ersetzt keine ausführbare Reparatur/,
);
assert.match(system, /behebe bestätigte, im Auftrag liegende Systemfehler/);

const passed = (run) => assert.equal(evaluate(run).passed, true);
const rejected = (run) => assert.equal(evaluate(run).passed, false);

// PI: mehrere Befunde werden einzeln korrigiert und ihre Tests erneut ausgeführt.
passed({
  actions: [
    { name: "test-cache", result: "failed" },
    { name: "fix-cache", mutates: true },
    { name: "test-cache", result: "passed" },
    { name: "fix-parser", mutates: true },
    { name: "test-parser", result: "passed" },
  ],
  finalState:
    "cache fixed; parser fixed; cache test passed; parser test passed",
  requiredActions: ["fix-cache", "test-cache", "fix-parser", "test-parser"],
  requiredState: ["cache fixed", "parser fixed", "passed"],
  verifyAction: "test-parser",
});

// Eine behauptete Reparatur ohne Schreibaktion und Readback besteht nicht.
rejected({
  actions: [],
  finalState: "assistant says both bugs are fixed",
  requiredActions: ["fix-cache", "fix-parser", "test-cache", "test-parser"],
  requiredState: ["cache fixed", "parser fixed"],
});
rejected({
  actions: [
    { name: "test", result: "passed" },
    { name: "fix", mutates: true },
  ],
  finalState: "bug fixed; stale test result says passed",
  requiredActions: ["fix", "test"],
  requiredState: ["bug fixed", "passed"],
  verifyAction: "test",
});

// Regression: der erste Fix wird durch eine Folgeprüfung widerlegt und danach repariert.
passed({
  actions: [
    { name: "fix", mutates: true },
    { name: "regression-test", result: "failed" },
    { name: "fix-regression", mutates: true },
    { name: "regression-test", result: "passed" },
  ],
  finalState: "original bug fixed; regression fixed; regression test passed",
  requiredActions: ["fix", "regression-test", "fix-regression"],
  requiredState: ["bug fixed", "regression fixed", "passed"],
  verifyAction: "regression-test",
});

// PI: fehlende aktive Berechtigung muss als konkreter Freigabebedarf enden.
passed({
  actions: [
    { name: "write-blocked", result: "permission required" },
    { name: "request-permission", result: "requested" },
  ],
  finalState: "workspace unchanged; permission request pending",
  requiredActions: ["write-blocked", "request-permission"],
  requiredState: ["unchanged", "permission request pending"],
});

// Ein ausdrücklich lesender Auftrag prüft, dass keine Datei verändert wurde.
passed({
  actions: [{ name: "read", mutates: false }],
  finalState: "source unchanged; diagnosis reported",
  requiredActions: ["read"],
  requiredState: ["source unchanged"],
  readOnly: true,
});
rejected({
  actions: [{ name: "edit", mutates: true }],
  finalState: "source changed",
  requiredActions: [],
  requiredState: ["source unchanged"],
  readOnly: true,
});

// PIS: NixOS-Änderungen müssen den vorgesehenen Build-, Apply- und Readback-Weg zeigen.
passed({
  actions: [
    { name: "edit-config", mutates: true },
    { name: "nixos-agent-build" },
    { name: "nixos-agent-apply", mutates: true },
    { name: "inspect-running-state" },
  ],
  finalState:
    "generation 73 active; faulty udev restart removed; WLAN remains connected",
  requiredActions: [
    "edit-config",
    "nixos-agent-build",
    "nixos-agent-apply",
    "inspect-running-state",
  ],
  requiredState: ["generation 73 active", "restart removed", "connected"],
  verifyAction: "inspect-running-state",
});

// Eine riskante Aktivierung ohne Freigabe und ein entfernter Hardware-Workaround scheitern.
rejected({
  actions: [
    { name: "edit-config", mutates: true },
    { name: "nixos-agent-apply", mutates: true },
  ],
  finalState: "activation was not authorized",
  requiredActions: ["request-permission"],
  requiredState: ["unchanged"],
});
passed({
  actions: [{ name: "inspect-workaround", mutates: false }],
  finalState: "hardware workaround retained; no removal",
  requiredActions: ["inspect-workaround"],
  requiredState: ["workaround retained"],
  readOnly: true,
});

// Ein fehlgeschlagener Reparaturversuch braucht Fehlerprüfung und kontrollierten Rollback.
passed({
  actions: [
    { name: "repair-attempt", mutates: true, result: "failed" },
    { name: "inspect-failure" },
    { name: "rollback-own-change", mutates: true },
    { name: "verify-original-state" },
  ],
  finalState:
    "repair failed; cause recorded; own change rolled back; original state verified",
  requiredActions: [
    "repair-attempt",
    "inspect-failure",
    "rollback-own-change",
    "verify-original-state",
  ],
  requiredState: ["cause recorded", "rolled back", "original state verified"],
  verifyAction: "verify-original-state",
});

// Kurze Informationsfragen bleiben werkzeugfrei.
passed({
  actions: [],
  finalState: "option meaning explained",
  requiredActions: [],
  requiredState: ["explained"],
  readOnly: true,
});

console.log("problem-solving acceptance cases for pi and pis: PASS");
