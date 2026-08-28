/**
 * Kleine, DOM-freie Interaktionshilfen für den Renderer. Sie halten keine
 * Pi-Wahrheit, sondern machen UI-Entscheidungen testbar.
 */
"use strict";

function contentParts(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.filter((part) => part && typeof part === "object")
    : [];
}

function textFromContent(content) {
  return contentParts(content)
    .filter((part) => part.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function thinkingFromContent(content) {
  return contentParts(content)
    .filter((part) => part.type === "thinking")
    .map((part) => {
      if (typeof part.thinking === "string") return part.thinking;
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function comboFromKeyboardEvent(event) {
  if (
    event.key === "Tab" &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    return "shift+tab";
  }
  const modifier = event.metaKey || (event.ctrlKey && event.altKey);
  if (!modifier || event.key.length !== 1) return null;
  const key = event.key.toLowerCase();
  return `super+${event.shiftKey ? "shift+" : ""}${key}`;
}

function isNearBottom(scrollable, threshold = 48) {
  const distance = Math.max(
    0,
    Number(scrollable.scrollHeight) -
      Number(scrollable.scrollTop) -
      Number(scrollable.clientHeight),
  );
  return distance <= threshold;
}

function once(callback) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return callback(...args);
  };
}

function piExitMessage(info = {}) {
  if (info.kind === "spawn-error") {
    const detail = String(info.message ?? "").slice(0, 240);
    return detail
      ? `Pi konnte nicht gestartet werden: ${detail}`
      : "Pi konnte nicht gestartet werden. Prüfe die Pi-Installation.";
  }
  const reason = info.signal
    ? `Signal ${info.signal}`
    : `Code ${info.code ?? "?"}`;
  return `Pi-Prozess wurde beendet (${reason}). „Neue Sitzung“ startet ihn erneut.`;
}

const helpers = {
  comboFromKeyboardEvent,
  isNearBottom,
  once,
  piExitMessage,
  textFromContent,
  thinkingFromContent,
};

if (typeof window !== "undefined") window.piGuiInteractions = helpers;
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    comboFromKeyboardEvent,
    isNearBottom,
    once,
    piExitMessage,
    textFromContent,
    thinkingFromContent,
  };
}
