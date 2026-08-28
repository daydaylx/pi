/**
 * Sicherer Markdown-Renderer für Assistant-Antworten (Phase 3, P0).
 *
 * Zwei getrennte Schichten:
 *   - `parseMarkdown`/`parseInline` sind reine Funktionen (kein DOM), die
 *     Text in einen Block-/Inline-Baum zerlegen. Sie laufen unverändert in
 *     Node (Unit-Tests) und im Renderer.
 *   - `renderMarkdown` baut daraus DOM-Knoten ausschließlich über
 *     `document.createElement`/`textContent`/`createTextNode`. Es gibt in
 *     dieser Datei keine einzige `innerHTML`-Zuweisung mit Modelltext —
 *     das ist die eigentliche XSS-Schutzeigenschaft, nicht ein Escaping-
 *     Trick. Attribute, die wir setzen (z. B. `href`), werden vorher
 *     gegen eine Schema-Positivliste geprüft.
 *
 * Keine Abhängigkeit auf externe Markdown-/Sanitizer-Bibliotheken: die
 * CSP (`script-src 'self'`) und der Non-Goal "keine großen neuen
 * Dependencies" sprechen für eine kleine handgeschriebene Umsetzung statt
 * einer gebündelten Drittbibliothek.
 */
"use strict";

/* ------------------------------ Block-Parser ---------------------------- */

function isBlockStart(line) {
  return (
    /^\s{0,3}(```|~~~)/.test(line) ||
    /^\s{0,3}#{1,6}\s+/.test(line) ||
    /^\s{0,3}>/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)
  );
}

function splitTableRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line) {
  return (
    line.includes("-") && line.includes("|") && /^[\s|:-]+$/.test(line.trim())
  );
}

function parseList(lines, startIndex) {
  const firstMatch = lines[startIndex].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  const baseIndent = firstMatch[1].length;
  const ordered = /\d/.test(firstMatch[2]);
  const items = [];
  let i = startIndex;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    // Exakter Prefix bis zum Beginn des Inhalts (Einrückung + Marker +
    // Trennraum), damit fortlaufende/verschachtelte Zeilen ohne Rest-
    // Leerzeichen weiterverarbeitet werden (wichtig für Codeblöcke in
    // Listen, die exakte Einrückung erwarten).
    const contentIndent = m[0].length - m[3].length;
    const itemLines = [m[3]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") {
        const next = lines[i + 1];
        if (
          typeof next === "string" &&
          next.startsWith(" ".repeat(contentIndent))
        ) {
          itemLines.push("");
          i++;
          continue;
        }
        break;
      }
      const contMatch = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (contMatch && contMatch[1].length <= baseIndent) break;
      if (l.startsWith(" ".repeat(contentIndent))) {
        itemLines.push(l.slice(contentIndent));
        i++;
        continue;
      }
      break;
    }
    items.push({ children: parseBlocks(itemLines) });
  }
  return { items, ordered, nextIndex: i };
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = line.match(/^(\s{0,3})(```|~~~)(.*)$/);
    if (fence) {
      const fenceChar = fence[2];
      const lang = fence[3].trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fenceChar)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const heading = line.match(/^(\s{0,3})(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[2].length,
        text: heading[3],
      });
      i++;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", children: parseBlocks(quoteLines) });
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headerCells = splitTableRow(line);
      const alignCells = splitTableRow(lines[i + 1]).map((cell) => {
        const t = cell.trim();
        if (/^:-+:$/.test(t)) return "center";
        if (/^-+:$/.test(t)) return "right";
        if (/^:-+$/.test(t)) return "left";
        return null;
      });
      i += 2;
      const rows = [];
      while (
        i < lines.length &&
        lines[i].includes("|") &&
        lines[i].trim() !== ""
      ) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({
        type: "table",
        header: headerCells,
        align: alignCells,
        rows,
      });
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const { items, ordered, nextIndex } = parseList(lines, i);
      blocks.push({ type: "list", ordered, items });
      i = nextIndex;
      continue;
    }

    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isBlockStart(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }
  return blocks;
}

function parseMarkdown(source) {
  const lines = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  return parseBlocks(lines);
}

/* ----------------------------- Inline-Parser ----------------------------- */

function parseInline(text) {
  const nodes = [];
  const s = String(text ?? "");
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < s.length) {
    const ch = s[i];

    if (ch === "\n") {
      flush();
      nodes.push({ type: "break" });
      i++;
      continue;
    }

    if (ch === "`") {
      let fenceLen = 1;
      while (s[i + fenceLen] === "`") fenceLen++;
      const fence = "`".repeat(fenceLen);
      const end = s.indexOf(fence, i + fenceLen);
      if (end !== -1) {
        flush();
        nodes.push({ type: "code", value: s.slice(i + fenceLen, end).trim() });
        i = end + fenceLen;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const marker = s[i + 1] === ch ? s.slice(i, i + 2) : ch;
      const strong = marker.length === 2;
      const closeIdx = s.indexOf(marker, i + marker.length);
      if (closeIdx !== -1 && closeIdx > i + marker.length) {
        const inner = s.slice(i + marker.length, closeIdx);
        if (inner.trim() !== "" && !inner.includes("\n\n")) {
          flush();
          nodes.push({
            type: strong ? "strong" : "em",
            children: parseInline(inner),
          });
          i = closeIdx + marker.length;
          continue;
        }
      }
    }

    if (ch === "[") {
      const closeBracket = s.indexOf("]", i + 1);
      if (closeBracket !== -1 && s[closeBracket + 1] === "(") {
        const closeParen = s.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = s.slice(i + 1, closeBracket);
          let href = s.slice(closeBracket + 2, closeParen).trim();
          const titleMatch = href.match(/^(\S+)(\s+"[^"]*")?$/);
          if (titleMatch) href = titleMatch[1];
          flush();
          nodes.push({ type: "link", href, children: parseInline(label) });
          i = closeParen + 1;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return nodes;
}

/* ------------------------------ DOM-Rendering ---------------------------- */

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Nur http(s)/mailto und schemalose (relative/Fragment-)Links sind klickbar. */
function isSafeHref(href) {
  const value = String(href ?? "");
  if (value.startsWith("#")) return true;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return true;
  try {
    const url = new URL(value, "https://pi.invalid/");
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function renderInlineNodes(container, nodes) {
  for (const node of nodes) {
    if (node.type === "text") {
      container.appendChild(document.createTextNode(node.value));
    } else if (node.type === "break") {
      container.appendChild(document.createElement("br"));
    } else if (node.type === "code") {
      const codeEl = document.createElement("code");
      codeEl.className = "md-inline-code";
      codeEl.textContent = node.value;
      container.appendChild(codeEl);
    } else if (node.type === "strong") {
      const strongEl = document.createElement("strong");
      renderInlineNodes(strongEl, node.children);
      container.appendChild(strongEl);
    } else if (node.type === "em") {
      const emEl = document.createElement("em");
      renderInlineNodes(emEl, node.children);
      container.appendChild(emEl);
    } else if (node.type === "link") {
      if (isSafeHref(node.href)) {
        const a = document.createElement("a");
        a.href = node.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        renderInlineNodes(a, node.children);
        container.appendChild(a);
      } else {
        renderInlineNodes(container, node.children);
      }
    }
  }
}

function renderBlocks(container, blocks, opts) {
  for (const block of blocks) renderBlock(container, block, opts);
}

function renderBlock(container, block, opts) {
  if (block.type === "heading") {
    const level = Math.min(6, Math.max(1, block.level));
    const h = document.createElement(`h${level}`);
    h.className = "md-heading";
    renderInlineNodes(h, parseInline(block.text));
    container.appendChild(h);
    return;
  }
  if (block.type === "paragraph") {
    const p = document.createElement("p");
    p.className = "md-paragraph";
    renderInlineNodes(p, parseInline(block.text));
    container.appendChild(p);
    return;
  }
  if (block.type === "hr") {
    container.appendChild(document.createElement("hr"));
    return;
  }
  if (block.type === "blockquote") {
    const bq = document.createElement("blockquote");
    bq.className = "md-blockquote";
    renderBlocks(bq, block.children, opts);
    container.appendChild(bq);
    return;
  }
  if (block.type === "list") {
    const list = document.createElement(block.ordered ? "ol" : "ul");
    list.className = "md-list";
    for (const item of block.items) {
      const li = document.createElement("li");
      renderBlocks(li, item.children, opts);
      list.appendChild(li);
    }
    container.appendChild(list);
    return;
  }
  if (block.type === "table") {
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    const table = document.createElement("table");
    table.className = "md-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    block.header.forEach((cellText, idx) => {
      const th = document.createElement("th");
      if (block.align[idx]) th.style.textAlign = block.align[idx];
      renderInlineNodes(th, parseInline(cellText));
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of block.rows) {
      const tr = document.createElement("tr");
      row.forEach((cellText, idx) => {
        const td = document.createElement("td");
        if (block.align[idx]) td.style.textAlign = block.align[idx];
        renderInlineNodes(td, parseInline(cellText ?? ""));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    return;
  }
  if (block.type === "code") {
    if (opts && typeof opts.onCodeBlock === "function") {
      container.appendChild(opts.onCodeBlock(block.lang, block.code));
      return;
    }
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = block.code;
    pre.appendChild(codeEl);
    container.appendChild(pre);
  }
}

/**
 * Rendert Markdown-Quelltext in einen freistehenden `<div class="md">`.
 * `opts.onCodeBlock(lang, code) -> HTMLElement` bindet die Codeblock-
 * Komponente ein (siehe chat/code-block.js); ohne Option gibt es ein
 * einfaches `<pre><code>` als Fallback.
 */
function renderMarkdown(source, opts = {}) {
  const root = document.createElement("div");
  root.className = "md";
  renderBlocks(root, parseMarkdown(source), opts);
  return root;
}

if (typeof window !== "undefined") {
  window.piGuiMarkdown = {
    parseMarkdown,
    parseInline,
    renderMarkdown,
    isSafeHref,
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseMarkdown, parseInline, renderMarkdown, isSafeHref };
}
