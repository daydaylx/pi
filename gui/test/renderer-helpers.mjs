import test from "node:test";
import assert from "node:assert/strict";
import {
  comboFromKeyboardEvent,
  isNearBottom,
  once,
  piExitMessage,
  textFromContent,
  thinkingFromContent,
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
