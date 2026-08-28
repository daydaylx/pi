/**
 * Reine Tests für die Codeblock-Tokenisierung (Phase 3, §9). `buildCodeBlock`
 * baut DOM (siehe chat/code-block.js) und wird durch die Electron-Smokes
 * abgedeckt; hier wird nur die DOM-freie Highlight-Heuristik geprüft.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  highlightTokens,
  normalizeLang,
  languageLabel,
} from "../renderer/chat/code-block.js";

function reassemble(tokens) {
  return tokens.map((t) => t.text).join("");
}

test("Tokenisierung verliert keine Zeichen (roundtrip)", () => {
  const code = 'const x = "a // not a comment" + 1; // real comment\n';
  const tokens = highlightTokens(code, "javascript");
  assert.equal(reassemble(tokens), code);
});

test("Erkennt Keywords, Strings, Zahlen, Kommentare getrennt", () => {
  const tokens = highlightTokens("const n = 42; // note", "javascript");
  const byCls = (cls) => tokens.filter((t) => t.cls === cls).map((t) => t.text);
  assert.ok(byCls("kw").includes("const"));
  assert.ok(byCls("num").includes("42"));
  assert.ok(byCls("cm").some((t) => t.includes("note")));
});

test("String mit // im Inhalt wird nicht als Kommentar zerschnitten", () => {
  const tokens = highlightTokens(
    'const u = "http://example.com";',
    "javascript",
  );
  const strings = tokens.filter((t) => t.cls === "str").map((t) => t.text);
  assert.ok(strings.includes('"http://example.com"'));
  assert.ok(!tokens.some((t) => t.cls === "cm"));
});

test("Python-Kommentar mit #", () => {
  const tokens = highlightTokens("def f():  # hi\n    return 1", "python");
  assert.ok(tokens.some((t) => t.cls === "kw" && t.text === "def"));
  assert.ok(tokens.some((t) => t.cls === "cm" && t.text.includes("hi")));
});

test("Unbekannte Sprache bricht nicht: keine Keywords markiert", () => {
  const tokens = highlightTokens("foo bar baz", "some-made-up-language");
  assert.ok(tokens.every((t) => t.cls !== "kw"));
  assert.equal(reassemble(tokens), "foo bar baz");
});

test("Sprach-Aliasse und Labels", () => {
  assert.equal(normalizeLang("js"), "javascript");
  assert.equal(normalizeLang("TS"), "typescript");
  assert.equal(languageLabel("py"), "Python");
  assert.equal(languageLabel(""), "Text");
  assert.equal(languageLabel("cobol"), "cobol");
});
