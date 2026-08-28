/**
 * Reine Parser-Tests für den Markdown-Renderer (Phase 3, P0). Diese Datei
 * prüft nur `parseMarkdown`/`parseInline` (kein DOM nötig) — die
 * DOM-Bauschritte in chat/markdown.js verwenden ausschließlich
 * `createElement`/`textContent`, was durch die statische Prüfung in
 * test/security.mjs abgesichert ist (kein `innerHTML` mit Modelltext).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkdown,
  parseInline,
  isSafeHref,
} from "../renderer/chat/markdown.js";

test("Überschriften aller Ebenen werden erkannt", () => {
  const blocks = parseMarkdown("# H1\n## H2\n### H3");
  assert.deepEqual(
    blocks.map((b) => [b.type, b.level, b.text]),
    [
      ["heading", 1, "H1"],
      ["heading", 2, "H2"],
      ["heading", 3, "H3"],
    ],
  );
});

test("Ungeordnete und nummerierte Listen", () => {
  const [ul] = parseMarkdown("- eins\n- zwei\n- drei");
  assert.equal(ul.type, "list");
  assert.equal(ul.ordered, false);
  assert.equal(ul.items.length, 3);

  const [ol] = parseMarkdown("1. eins\n2. zwei");
  assert.equal(ol.type, "list");
  assert.equal(ol.ordered, true);
  assert.equal(ol.items.length, 2);
});

test("Verschachtelte Liste bleibt als Kindblock erhalten", () => {
  const [list] = parseMarkdown("- außen\n  - innen 1\n  - innen 2\n- außen 2");
  assert.equal(list.items.length, 2);
  const nested = list.items[0].children.find((b) => b.type === "list");
  assert.ok(nested, "verschachtelte Liste gefunden");
  assert.equal(nested.items.length, 2);
});

test("Blockquote", () => {
  const [bq] = parseMarkdown("> Zitat Zeile 1\n> Zitat Zeile 2");
  assert.equal(bq.type, "blockquote");
  assert.equal(bq.children[0].type, "paragraph");
  assert.match(bq.children[0].text, /Zitat Zeile 1/);
});

test("Trennlinie", () => {
  const blocks = parseMarkdown("Text\n\n---\n\nMehr Text");
  assert.ok(blocks.some((b) => b.type === "hr"));
});

test("Fenced Codeblock mit Sprache", () => {
  const [block] = parseMarkdown("```typescript\nconst x = 1;\n```");
  assert.equal(block.type, "code");
  assert.equal(block.lang, "typescript");
  assert.equal(block.code, "const x = 1;");
});

test("GFM-Tabelle mit Ausrichtung", () => {
  const [table] = parseMarkdown(
    "| A | B |\n| :-- | --: |\n| 1 | 2 |\n| 3 | 4 |",
  );
  assert.equal(table.type, "table");
  assert.deepEqual(table.header, ["A", "B"]);
  assert.deepEqual(table.align, ["left", "right"]);
  assert.deepEqual(table.rows, [
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("Verschachtelte Struktur: Liste enthält Codeblock", () => {
  const [list] = parseMarkdown("- Punkt\n\n  ```js\n  ok();\n  ```");
  const code = list.items[0].children.find((b) => b.type === "code");
  assert.ok(code, "Codeblock im Listeneintrag gefunden");
  assert.equal(code.code, "ok();");
});

test("Inline: fett, kursiv, Inline-Code, Link", () => {
  const nodes = parseInline(
    "**fett** _kursiv_ `code` [Pi](https://example.com)",
  );
  assert.equal(nodes[0].type, "strong");
  assert.equal(nodes[2].type, "em");
  assert.equal(nodes[4].type, "code");
  assert.equal(nodes[4].value, "code");
  const link = nodes.find((n) => n.type === "link");
  assert.equal(link.href, "https://example.com");
});

test("XSS: rohes HTML im Modelltext bleibt Text-Knoten, nie ein Tag-Knoten", () => {
  const nodes = parseInline('<img src=x onerror="alert(1)">');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "text");
  assert.equal(nodes[0].value, '<img src=x onerror="alert(1)">');
});

test("XSS: javascript:-Links werden als unsicher erkannt", () => {
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,<script>1</script>"), false);
  assert.equal(isSafeHref("https://example.com"), true);
  assert.equal(isSafeHref("mailto:a@b.com"), true);
  assert.equal(isSafeHref("#anchor"), true);
});

test("Absatz endet an Blockgrenzen (Überschrift/Liste/Fence)", () => {
  const blocks = parseMarkdown("Text davor\n# Überschrift");
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[1].type, "heading");
});
