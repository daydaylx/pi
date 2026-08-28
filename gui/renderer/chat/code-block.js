/**
 * Codeblock als echte GUI-Komponente (Phase 3): Sprache + Copy-Button im
 * Kopf, horizontal scrollbarer Codebereich, einfache Tokenisierung für
 * Syntax-Highlighting. Kein Grammatik-Parser, keine neue Abhängigkeit —
 * eine kleine regexbasierte Heuristik reicht für "sofern ohne große neue
 * Komplexität möglich" (Arbeitsauftrag §9).
 *
 * `highlightTokens` ist rein (kein DOM) und daher direkt unit-testbar.
 * `buildCodeBlock` baut DOM ausschließlich über `createElement`/
 * `textContent` — niemals `innerHTML` mit Code-Inhalt.
 */
"use strict";

const KEYWORDS = {
  javascript: [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "extends",
    "new",
    "import",
    "from",
    "export",
    "default",
    "await",
    "async",
    "try",
    "catch",
    "finally",
    "throw",
    "typeof",
    "instanceof",
    "of",
    "in",
    "switch",
    "case",
    "break",
    "continue",
    "null",
    "undefined",
    "true",
    "false",
    "this",
    "super",
    "yield",
    "static",
    "get",
    "set",
  ],
  python: [
    "def",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "class",
    "import",
    "from",
    "as",
    "try",
    "except",
    "finally",
    "raise",
    "with",
    "lambda",
    "None",
    "True",
    "False",
    "and",
    "or",
    "not",
    "in",
    "is",
    "yield",
    "async",
    "await",
    "pass",
    "break",
    "continue",
    "global",
    "nonlocal",
    "del",
    "assert",
  ],
  bash: [
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "in",
    "do",
    "done",
    "while",
    "case",
    "esac",
    "function",
    "return",
    "local",
    "export",
    "echo",
    "exit",
  ],
  rust: [
    "fn",
    "let",
    "mut",
    "if",
    "else",
    "match",
    "for",
    "while",
    "loop",
    "struct",
    "enum",
    "impl",
    "trait",
    "pub",
    "use",
    "mod",
    "return",
    "break",
    "continue",
    "true",
    "false",
    "self",
    "Self",
    "async",
    "await",
  ],
  go: [
    "func",
    "package",
    "import",
    "var",
    "const",
    "type",
    "struct",
    "interface",
    "if",
    "else",
    "for",
    "range",
    "return",
    "go",
    "chan",
    "select",
    "case",
    "switch",
    "default",
    "defer",
    "map",
  ],
  json: [],
};
KEYWORDS.typescript = [
  ...KEYWORDS.javascript,
  "interface",
  "type",
  "enum",
  "implements",
  "namespace",
  "declare",
  "readonly",
  "as",
  "is",
  "keyof",
  "public",
  "private",
  "protected",
  "abstract",
];
KEYWORDS.jsx = KEYWORDS.javascript;
KEYWORDS.tsx = KEYWORDS.typescript;
KEYWORDS.shell = KEYWORDS.bash;
KEYWORDS.sh = KEYWORDS.bash;

const LANG_ALIASES = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  sh: "bash",
};

function normalizeLang(lang) {
  const l = String(lang ?? "")
    .trim()
    .toLowerCase();
  return LANG_ALIASES[l] || l;
}

const TOKEN_RE =
  /(\/\/[^\n]*)|(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\s\w]+)/g;

/** Zerlegt Code in {text, cls}-Fragmente. `cls` ist null für unauffälligen Text. */
function highlightTokens(code, lang) {
  const language = normalizeLang(lang);
  const keywords = new Set(KEYWORDS[language] || []);
  const source = String(code ?? "");
  const tokens = [];
  let last = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(source))) {
    if (match.index > last)
      tokens.push({ text: source.slice(last, match.index), cls: null });
    const [full, lineComment, hashComment, string, number, word] = match;
    if (lineComment || hashComment) tokens.push({ text: full, cls: "cm" });
    else if (string) tokens.push({ text: full, cls: "str" });
    else if (number) tokens.push({ text: full, cls: "num" });
    else if (word)
      tokens.push({ text: full, cls: keywords.has(word) ? "kw" : null });
    else tokens.push({ text: full, cls: null });
    last = TOKEN_RE.lastIndex;
  }
  if (last < source.length)
    tokens.push({ text: source.slice(last), cls: null });
  return tokens;
}

function languageLabel(lang) {
  const language = normalizeLang(lang);
  const labels = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    jsx: "JSX",
    tsx: "TSX",
    python: "Python",
    bash: "Bash",
    shell: "Shell",
    json: "JSON",
    rust: "Rust",
    go: "Go",
    yaml: "YAML",
    html: "HTML",
    css: "CSS",
    sql: "SQL",
  };
  return labels[language] || (lang ? String(lang) : "Text");
}

/**
 * Baut die Codeblock-Komponente. `opts.onCopy(code) -> Promise` liefert
 * die Kopieraktion (der Renderer bindet sie an `api.copyToClipboard`);
 * ohne Option bleibt der Button funktionslos sichtbar statt zu werfen.
 */
function buildCodeBlock(lang, code, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-block-head";
  const langLabel = document.createElement("span");
  langLabel.className = "code-lang mono";
  langLabel.textContent = languageLabel(lang);
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "code-copy";
  copyBtn.textContent = "Kopieren";
  copyBtn.addEventListener("click", () => {
    let resetTimer = null;
    const done = (ok) => {
      copyBtn.textContent = ok ? "Kopiert" : "Fehler";
      copyBtn.classList.toggle("copied", ok);
      copyBtn.classList.toggle("failed", !ok);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copyBtn.textContent = "Kopieren";
        copyBtn.classList.remove("copied", "failed");
      }, 1600);
    };
    const result =
      typeof opts.onCopy === "function"
        ? opts.onCopy(code)
        : Promise.reject(new Error("Kopieren nicht verfügbar"));
    Promise.resolve(result)
      .then(() => done(true))
      .catch(() => done(false));
  });
  head.append(langLabel, copyBtn);

  const scroll = document.createElement("div");
  scroll.className = "code-block-scroll";
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.className = "code-block-code mono";
  for (const token of highlightTokens(code, lang)) {
    if (token.cls) {
      const span = document.createElement("span");
      span.className = `tok-${token.cls}`;
      span.textContent = token.text;
      codeEl.appendChild(span);
    } else {
      codeEl.appendChild(document.createTextNode(token.text));
    }
  }
  pre.appendChild(codeEl);
  scroll.appendChild(pre);
  wrap.append(head, scroll);
  return wrap;
}

if (typeof window !== "undefined") {
  window.piGuiCodeBlock = {
    highlightTokens,
    buildCodeBlock,
    normalizeLang,
    languageLabel,
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    highlightTokens,
    buildCodeBlock,
    normalizeLang,
    languageLabel,
  };
}
