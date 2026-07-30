/**
 * PHASE-01 Kompatibilitäts-Probe für das geplante Subagent Fleet Dock
 * (.agent/plans/P-2026-07-29-subagent-fleet-dock/). Belegt, dass die für das
 * Dock benötigten ExtensionUI-APIs (setWidget mit belowEditor, onTerminalInput,
 * getEditorText) im Harness vorhanden sind und sich bei simuliertem Reload
 * nicht doppelt registrieren.
 */
import { assert, eq, equal, test } from "./assertions.mjs";
import { createHarness } from "../shared/harness.mjs";

await test("setWidget registriert und entfernt ein belowEditor-Widget", async () => {
  const harness = createHarness();
  const { ui } = harness.makeContext();

  ui.setWidget("fleet-dock", ["AGENTS · 1 active"], {
    placement: "belowEditor",
  });
  assert(
    harness.widgets.has("fleet-dock"),
    "Widget ist nach setWidget registriert",
  );
  equal(
    harness.widgets.get("fleet-dock").options?.placement,
    "belowEditor",
    "Placement wird unverändert durchgereicht",
  );

  ui.setWidget("fleet-dock", undefined, { placement: "belowEditor" });
  assert(
    !harness.widgets.has("fleet-dock"),
    "Widget ist nach Entfernen nicht mehr vorhanden",
  );
});

await test("onTerminalInput reagiert genau einmal und wiederholte Registrierung häuft keine Listener an", async () => {
  const harness = createHarness();
  const { ui } = harness.makeContext();

  let calls = 0;
  const unsubscribe = ui.onTerminalInput(() => {
    calls += 1;
    return { consume: true };
  });

  harness.sendTerminalInput("[B");
  equal(calls, 1, "Handler reagiert genau einmal pro Input");
  equal(
    harness.terminalInputListenerCount,
    1,
    "genau ein Listener ist registriert",
  );

  // Simuliert ein Extension-Reload: alter Handler abmelden, neuen registrieren.
  unsubscribe();
  ui.onTerminalInput(() => {
    calls += 1;
    return { consume: true };
  });
  equal(
    harness.terminalInputListenerCount,
    1,
    "Reload ersetzt den Listener statt einen zweiten anzuhäufen",
  );

  harness.sendTerminalInput("[B");
  equal(calls, 2, "nach Reload reagiert weiterhin genau ein Handler pro Input");
});

await test("getEditorText/setEditorText liefern den erwarteten Wert", async () => {
  const harness = createHarness({ editorText: "" });
  const { ui } = harness.makeContext();

  equal(ui.getEditorText(), "", "Editor startet leer");
  ui.setEditorText("/fleet");
  equal(
    ui.getEditorText(),
    "/fleet",
    "gesetzter Editortext wird zurückgelesen",
  );
  eq(harness.editorText, "/fleet", "Harness-Spiegelwert stimmt überein");
});
