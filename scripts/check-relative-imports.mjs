import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".ts", ".mjs", ".js"]);
const RESOLUTION_EXTENSIONS = [".ts", ".mjs", ".js", ".json"];
export const DEFAULT_SOURCE_DIRS = [
  "extensions",
  "scripts",
  "shared",
  "tests",
  "benchmarks/harness",
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectSourceFiles(root, relativeDir, files = []) {
  const absolute = path.join(root, relativeDir);
  if (!existsSync(absolute)) return files;
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const relative = path.join(relativeDir, entry);
    const candidate = path.join(root, relative);
    const stat = statSync(candidate);
    if (stat.isDirectory()) collectSourceFiles(root, relative, files);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry))) files.push(relative);
  }
  return files;
}

function tokens(source) {
  const result = [];
  for (let index = 0; index < source.length; ) {
    const char = source[index];
    const next = source[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && next === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) break;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") index += 1;
        value += source[index] ?? "";
        index += 1;
      }
      index += 1;
      result.push({ type: "string", value });
      continue;
    }
    if (char === "`") {
      // Template text can contain import-shaped patch fixtures. Dynamic imports
      // inside template interpolations are intentionally outside this small
      // literal-import guard's scope.
      index += 1;
      while (index < source.length && source[index] !== "`") {
        if (source[index] === "\\") index += 1;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index]))
        index += 1;
      result.push({ type: "word", value: source.slice(start, index) });
      continue;
    }
    result.push({ type: "punctuation", value: char });
    index += 1;
  }
  return result;
}

/** Extract literal relative import specifiers while ignoring comments and strings. */
export function relativeImportSpecifiers(source) {
  const found = new Set();
  const lexed = tokens(source);
  for (let index = 0; index < lexed.length; index += 1) {
    const token = lexed[index];
    if (token.type !== "word" || (token.value !== "import" && token.value !== "export"))
      continue;
    const next = lexed[index + 1];
    if (token.value === "import" && next?.value === "(" && lexed[index + 2]?.type === "string") {
      found.add(lexed[index + 2].value);
      continue;
    }
    if (token.value === "import" && next?.type === "string") {
      found.add(next.value);
      continue;
    }
    for (let cursor = index + 1; cursor < lexed.length; cursor += 1) {
      if (lexed[cursor].value === ";") break;
      if (lexed[cursor].value === "from" && lexed[cursor + 1]?.type === "string") {
        found.add(lexed[cursor + 1].value);
        break;
      }
    }
  }
  return [...found].filter((specifier) => specifier.startsWith("."));
}

export function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...RESOLUTION_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLUTION_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/** Returns deterministic error strings for every unresolved literal relative import. */
export function checkRelativeImports(root = ROOT, sourceDirs = DEFAULT_SOURCE_DIRS) {
  const missing = [];
  for (const sourceDir of sourceDirs) {
    for (const relativeFile of collectSourceFiles(root, sourceDir)) {
      const absoluteFile = path.join(root, relativeFile);
      const source = readFileSync(absoluteFile, "utf8");
      for (const specifier of relativeImportSpecifiers(source)) {
        if (!resolveRelativeImport(absoluteFile, specifier)) {
          missing.push(`${relativeFile} -> ${specifier}`);
        }
      }
    }
  }
  return missing.sort();
}

function main() {
  const missing = checkRelativeImports();
  if (missing.length === 0) {
    console.log("PASS: all literal relative source imports resolve");
    return;
  }
  console.error("FAIL: unresolved literal relative source imports:");
  for (const entry of missing) console.error(`  ${entry}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
