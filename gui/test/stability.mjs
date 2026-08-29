/**
 * Stabilitäts-Gate der GUI-Bridge (Phase 7). Prüft das Crash-Verhalten des
 * PiRpcManager ohne echten Pi: Spawn-Fehler, Prozess-Exit mitten in einer
 * laufenden Anfrage, idempotentes Stoppen. Alles deterministisch und ohne
 * Modellzugriff.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PiRpcManager } from "../main/pi-rpc-manager.js";

function waitForEvent(emitter, name, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout auf Event ${name}`)),
      timeoutMs,
    );
    emitter.once(name, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("Spawn-Fehler wird als exit spawn-error gemeldet", async () => {
  const manager = new PiRpcManager({ piPath: "/nonexistent/pi-binary" });
  manager.on("error", () => {});
  const exitPromise = waitForEvent(manager, "exit");
  manager.start();
  const info = await exitPromise;
  assert.equal(info.kind, "spawn-error");
  assert.match(String(info.message), /\/nonexistent\/pi-binary/);
  assert.equal(
    manager.running,
    false,
    "Spawn-Fehler räumt den Prozess sofort auf",
  );
});

test("Prozess-Exit während laufender Anfrage verwirft diese sauber", async () => {
  // `node --mode rpc` ist keine gültige Node-Option: der Kindprozess
  // beendet sich sofort mit Fehler — ein realistischer Crash ohne Pi.
  const manager = new PiRpcManager({ piPath: process.execPath });
  const exitPromise = waitForEvent(manager, "exit");
  manager.start();
  const request = manager.request({ type: "get_state" });
  const [info, rejection] = await Promise.all([
    exitPromise,
    request.then(
      () => null,
      (error) => error,
    ),
  ]);
  assert.ok(rejection, "die Anfrage muss verworfen werden");
  assert.match(String(rejection.message), /Pi-Prozess beendet/);
  assert.notEqual(info.code, 0, "der Crash-Exit ist nicht erfolgreich");
  assert.equal(manager.running, false, "nach Exit läuft nichts mehr");
});

test("stop() ist idempotent und nach Exit sofort erledigt", async () => {
  const manager = new PiRpcManager({ piPath: "/nonexistent/pi-binary" });
  manager.on("error", () => {});
  const exitPromise = waitForEvent(manager, "exit");
  manager.start();
  await exitPromise;
  await manager.stop();
  await manager.stop();
});

test("Anfragen ohne laufenden Prozess werden sofort abgelehnt", async () => {
  const manager = new PiRpcManager();
  await assert.rejects(
    () => manager.request({ type: "get_state" }),
    /Pi läuft nicht/,
  );
});

test("sendRaw ohne laufenden Prozess wirft sichtbar", () => {
  const manager = new PiRpcManager();
  assert.throws(() => manager.sendRaw({ type: "abort" }), /Pi läuft nicht/);
});
