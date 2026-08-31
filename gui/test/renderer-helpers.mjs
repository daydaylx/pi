import test from "node:test";
import assert from "node:assert/strict";
import {
  activityPhaseFor,
  agentDisplayLabel,
  classifyActivityKind,
  comboFromKeyboardEvent,
  deriveTaskStatus,
  isNearBottom,
  once,
  piExitMessage,
  projectDisplayName,
  relativeTimeLabel,
  subagentStatusPresentation,
  textFromContent,
  thinkingFromContent,
  verificationOutcomeMarker,
} from "../renderer/interaction-helpers.js";

test("Content-Hilfen akzeptieren String- und Blockinhalte", () => {
  assert.equal(textFromContent("Hallo"), "Hallo");
  assert.equal(
    textFromContent([
      { type: "thinking", thinking: "intern" },
      { type: "text", text: "sichtbar" },
    ]),
    "sichtbar",
  );
  assert.equal(
    thinkingFromContent([
      { type: "thinking", thinking: "erster Gedanke" },
      { type: "thinking", text: "zweiter Gedanke" },
    ]),
    "erster Gedanke\n\nzweiter Gedanke",
  );
});

test("Shortcut-Dekodierung erhält Shift bei Super-Kombinationen", () => {
  assert.equal(
    comboFromKeyboardEvent({
      key: "Y",
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    }),
    "super+shift+y",
  );
  assert.equal(
    comboFromKeyboardEvent({
      key: "y",
      shiftKey: false,
      metaKey: false,
      ctrlKey: true,
      altKey: true,
    }),
    "super+y",
  );
  assert.equal(
    comboFromKeyboardEvent({
      key: "Tab",
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }),
    "shift+tab",
  );
  assert.equal(
    comboFromKeyboardEvent({
      key: "y",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }),
    null,
  );
});

test("Scroll-Folge bleibt nur in der Nähe des Chat-Endes aktiv", () => {
  assert.equal(
    isNearBottom({ scrollTop: 452, clientHeight: 500, scrollHeight: 1_000 }),
    true,
  );
  assert.equal(
    isNearBottom({ scrollTop: 300, clientHeight: 500, scrollHeight: 1_000 }),
    false,
  );
});

test("Einmalantworten können nicht doppelt an den Core gehen", () => {
  const calls = [];
  const respond = once((value) => calls.push(value));
  respond("first");
  respond("second");
  assert.deepEqual(calls, ["first"]);
});

test("Activity-Klassifizierung: Lese-/Suchwerkzeuge sind explore", () => {
  assert.equal(classifyActivityKind("read", { path: "x" }), "file_read");
  assert.equal(classifyActivityKind("grep", {}), "search");
  assert.equal(classifyActivityKind("find", {}), "search");
  assert.equal(classifyActivityKind("ls", {}), "search");
  assert.equal(activityPhaseFor(classifyActivityKind("read", {})), "explore");
  assert.equal(activityPhaseFor(classifyActivityKind("grep", {})), "explore");
});

test("Activity-Klassifizierung: Edit/Write sind file_change → Phase edit", () => {
  assert.equal(classifyActivityKind("edit", {}), "file_change");
  assert.equal(classifyActivityKind("write", {}), "file_change");
  assert.equal(activityPhaseFor("file_change"), "edit");
});

test("Activity-Klassifizierung: project_check und verify sind verification", () => {
  assert.equal(classifyActivityKind("project_check", {}), "verification");
  assert.equal(classifyActivityKind("verify", {}), "verification");
  assert.equal(activityPhaseFor("verification"), "verify");
});

test("Activity-Klassifizierung: Bash erkennt Test-/Verify-Kommandos als Verifikation", () => {
  assert.equal(
    classifyActivityKind("bash", { command: "npm run verify" }),
    "verification",
  );
  assert.equal(
    classifyActivityKind("bash", { command: "npm test" }),
    "verification",
  );
  assert.equal(
    classifyActivityKind("bash", { command: "npx vitest run" }),
    "verification",
  );
  assert.equal(classifyActivityKind("bash", { command: "ls -la" }), "command");
  assert.equal(activityPhaseFor("command"), "command");
});

test("Activity-Klassifizierung: Subagent/Wait sind agent, Unbekanntes ist other", () => {
  assert.equal(classifyActivityKind("subagent", {}), "agent");
  assert.equal(classifyActivityKind("wait", {}), "agent");
  assert.equal(classifyActivityKind("does_not_exist", {}), "other");
  assert.equal(activityPhaseFor("agent"), "agent");
  assert.equal(activityPhaseFor("other"), "other");
});

test("Task-Status: laufende aktuelle Sitzung ist immer ACTIVE", () => {
  assert.equal(
    deriveTaskStatus(
      { subagents: [], changes: null },
      { isCurrent: true, busy: true },
    ),
    "active",
  );
  assert.equal(
    deriveTaskStatus(
      { subagents: [], changes: null },
      { isCurrent: true, busy: false },
    ),
    "active",
  );
});

test("Task-Status: Subagent mit needs_attention geht vor allem anderen", () => {
  assert.equal(
    deriveTaskStatus(
      {
        subagents: [{ status: "needs_attention" }],
        changes: { filesCount: 3 },
      },
      { isCurrent: false, busy: false },
    ),
    "needs_input",
  );
});

test("Task-Status: fehlgeschlagene Verifikation braucht Eingabe", () => {
  assert.equal(
    deriveTaskStatus(
      { subagents: [], verification: { status: "checks_failed" } },
      { isCurrent: false },
    ),
    "needs_input",
  );
});

test("Task-Status: offene Änderungen ohne rote Flagge sind REVIEW", () => {
  assert.equal(
    deriveTaskStatus(
      { subagents: [], changes: { filesCount: 2 } },
      { isCurrent: false },
    ),
    "review",
  );
});

test("Task-Status: ruhende Sitzung ohne Änderungen ist COMPLETED", () => {
  assert.equal(
    deriveTaskStatus(
      { subagents: [], changes: null },
      { isCurrent: false, busy: false },
    ),
    "completed",
  );
});

test("Relative Zeitangabe rundet auf grobe Einheiten", () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  assert.equal(relativeTimeLabel(now - 30_000, now), "jetzt");
  assert.equal(relativeTimeLabel(now - 5 * 60_000, now), "5m");
  assert.equal(relativeTimeLabel(now - 3 * 3_600_000, now), "3h");
  assert.equal(relativeTimeLabel(now - 2 * 86_400_000, now), "2d");
});

test("Verification-Marker: unterscheidet pass/fail/offen/kein-Ergebnis (Phase 7)", () => {
  assert.deepEqual(verificationOutcomeMarker("success"), {
    marker: "✓",
    label: "bestanden",
    cls: "ok",
  });
  assert.deepEqual(verificationOutcomeMarker("failed"), {
    marker: "✗",
    label: "fehlgeschlagen",
    cls: "err",
  });
  // "unavailable" (Timeout/Abbruch/fehlendes Binary) darf niemals wie
  // "failed" aussehen (eigener Marker) UND niemals wie "success" gewertet
  // werden (Abschlusskriterium "abgebrochene Checks werden nicht als
  // bestanden gewertet").
  const unavailable = verificationOutcomeMarker("unavailable");
  assert.notEqual(unavailable.marker, "✓");
  assert.notEqual(unavailable.marker, "✗");
  assert.notEqual(unavailable.cls, "ok");
  // Kein Eintrag (Check für diesen Snapshot nie gelaufen) ist "offen", nicht
  // stillschweigend "bestanden".
  const neverRun = verificationOutcomeMarker(undefined);
  assert.notEqual(neverRun.marker, "✓");
  assert.notEqual(neverRun.cls, "ok");
});

test("Agent-Anzeigename: Großschreibung, leerer Wert fällt auf 'Subagent' zurück (Phase 10)", () => {
  assert.equal(agentDisplayLabel("scout"), "Scout");
  assert.equal(agentDisplayLabel("worker"), "Worker");
  assert.equal(agentDisplayLabel(""), "Subagent");
  assert.equal(agentDisplayLabel(undefined), "Subagent");
});

test("Subagenten-Status: aktiv/braucht Eingabe/pausiert klar unterschieden (Phase 10, §12)", () => {
  // "queued" bedeutet in diesem Core (frontend-bridge: subagentStartEvent)
  // bereits "gestartet und läuft", nicht "wartet auf Startplatz" — siehe
  // Kommentar in interaction-helpers.js. Muss deshalb wie "running"
  // aussehen, NICHT wie "paused"/"muted".
  const queued = subagentStatusPresentation("queued");
  assert.equal(queued.cls, "running");
  assert.notEqual(queued.cls, "muted");
  assert.deepEqual(subagentStatusPresentation("running"), queued);

  // "needs_attention" darf nie wie "aktiv" oder "pausiert" aussehen — eigene
  // Warnfarbe, dieselbe wie der Task-Status "needs_input".
  const attention = subagentStatusPresentation("needs_attention");
  assert.equal(attention.cls, "warn");
  assert.notEqual(attention.marker, queued.marker);

  assert.equal(subagentStatusPresentation("paused").cls, "muted");
  assert.notEqual(subagentStatusPresentation("paused").cls, "running");
});

test("Projekt-Anzeigename ist das letzte Pfadsegment (Startscreen, Phase 8)", () => {
  assert.equal(projectDisplayName("/home/d/.pi/agent"), "agent");
  assert.equal(projectDisplayName("/home/d/.pi/agent/"), "agent");
  assert.equal(projectDisplayName("/"), "/");
  assert.equal(projectDisplayName(""), "");
});

test("Prozessfehler bleiben verständlich ohne stderr-Auszug", () => {
  assert.match(
    piExitMessage({ kind: "spawn-error", message: "ENOENT: pi" }),
    /konnte nicht gestartet werden: ENOENT: pi/,
  );
  assert.equal(
    piExitMessage({ code: 143 }),
    "Pi-Prozess wurde beendet (Code 143). „Neue Sitzung“ startet ihn erneut.",
  );
});
