import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isPlanFilePath, PLAN_RELATIVE_PATH } from "../plan-mode/utils.ts";
import type { PermissionLevel, WriteOverride } from "./workflow-status.ts";

export type PolicyAction = "allow" | "ask" | "block";
export type FileOperation = "read" | "write";

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
  hard?: boolean;
}

const ALLOW: PolicyDecision = { action: "allow", reason: "Erlaubt" };

// Namenssegmente wie auth/credentials/secrets/tokens gelten nur als Secret,
// wenn sie ohne Endung (auch als Dotfile) oder mit einer Daten-/Key-Endung
// auftreten. Quellcode-Module wie src/auth.ts oder tokenizer.ts lösen keine
// harte Warnung mehr aus — Fehlalarme entwerten die verbliebenen Warnungen.
const SECRET_DATA_EXTENSIONS = "json|ya?ml|toml|ini|env|pem|key|p12|pfx";
const SECRET_PATH_PATTERN = new RegExp(
  "(^|[\\s/\\\\])(?:\\.env(?:\\.[^\\s/\\\\]+)?|\\.ssh|\\.gnupg|\\.aws|\\.npmrc|\\.pypirc|\\.netrc|" +
    `\\.?(?:auth|credentials?|secrets?|tokens?)(?:\\.(?:${SECRET_DATA_EXTENSIONS}))?` +
    "|id_rsa|id_ed25519|[^\\s/\\\\]+\\.pem)(?:[\\s/\\\\]|$)",
  "i",
);
const ENV_EXAMPLE_PATTERN = /(^|[\s/\\])\.env\.example(?=[\s/\\]|$)/gi;
const SYSTEM_PATHS = ["/etc", "/usr", "/bin", "/sbin", "/boot", "/var"];

const CRITICAL_BASH_PATTERNS: Array<[RegExp, string]> = [
  [
    /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+\/(?:\s|$)/i,
    "rekursives Löschen des Root-Dateisystems",
  ],
  [
    /\bsudo\b[^;&|]*\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/i,
    "sudo rm -rf",
  ],
  [
    /(?:\b(?:rm|rmdir|unlink|trash)\b|\bgio\s+trash\b)[^;&|]*(?:[\s/\\])\.git(?:[/\\\s]|$)/i,
    "Löschen von .git",
  ],
  [
    /\bchmod\s+(?:-[^\s]*R[^\s]*\s+)?(?:0?777|a\+rwx)\b/i,
    "unsichere rekursive Dateirechte",
  ],
  [
    /\bchown\s+(?:-[^\s]*R[^\s]*\s+)?[^;&|]*(?:\/etc|\/usr|\/bin|\/sbin|\/boot|\/var)(?:\/|\s|$)/i,
    "rekursiver Besitzerwechsel auf einem Systempfad",
  ],
  [
    /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i,
    "Download-to-shell-Pipeline",
  ],
];

// Bleiben ausschließlich in YOLO automatisch erlaubt (nicht in Full Access):
// sudo/su, Datei-/Ordnerlöschung und erzwungene Git-Pushes. Diese Fragen
// werden bewusst nicht zur Full-Access-Stufe freigegeben, damit Full Access
// spürbar zurückhaltender bleibt als YOLO — Force-Push zerstört Remote-
// History und ist kein Housekeeping.
const SENSITIVE_ASK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:rm|rmdir|unlink|trash)\b/i, "Datei- oder Ordnerlöschung"],
  [/\bgio\s+trash\b/i, "Datei- oder Ordnerlöschung"],
  [/\bsudo\b|\bsu\s+-?(?:\s|$)/i, "Ausführung mit erhöhten Rechten"],
  [
    /\bgit\s+push\b[^;&|]*(?:--force(?:-with-lease)?|-f)(?:\s|$)/i,
    "erzwungener Git-Push",
  ],
];

// Git-Housekeeping und Paketmanager-Rauschen: in Full Access UND YOLO
// automatisch erlaubt.
const ROUTINE_ASK_PATTERNS: Array<[RegExp, string]> = [
  [/\bgit\s+reset\b/i, "git reset"],
  [/\bgit\s+clean\b/i, "git clean"],
  [
    /\bgit\s+checkout\s+--\s+\.(?:\s|$)/i,
    "Verwerfen aller Änderungen mit git checkout",
  ],
  [
    /\bgit\s+restore\s+(?:--\s+)?\.(?:\s|$)/i,
    "Verwerfen aller Änderungen mit git restore",
  ],
  [
    /\bnpm\s+(?:install|uninstall|update|ci|link|publish)\b/i,
    "npm-Paketoperation",
  ],
  [/\bnpm\s+exec\b|\bnpx\b/i, "npm-Paketausführung mit möglichem Download"],
  [/\byarn\s+(?:add|remove|install|upgrade|publish)\b/i, "Yarn-Paketoperation"],
  [/\byarn\s+dlx\b/i, "Yarn-Paketausführung mit Download"],
  [/\bpnpm\s+(?:add|remove|install|update|publish)\b/i, "pnpm-Paketoperation"],
  [/\bpnpm\s+dlx\b/i, "pnpm-Paketausführung mit Download"],
  [/\b(?:pip|pip3)\s+(?:install|uninstall)\b/i, "Python-Paketoperation"],
  [/\bpipx\s+(?:install|uninstall|run)\b/i, "pipx-Paketoperation"],
  [
    /\b(?:apt|apt-get|dnf|yum|pacman|zypper|brew)\s+(?:install|remove|purge|update|upgrade)\b/i,
    "System-Paketoperation",
  ],
];

const WRITE_CAPABLE_PATTERN =
  /\b(?:rm|rmdir|unlink|trash|cp|mv|mkdir|touch|tee|truncate|dd|chmod|chown|chgrp|ln|rsync|install)\b|\bgio\s+trash\b|\bsed\b[^;&|]*\s-i(?:\s|$)|(?:^|[^<])>(?!>)|>>/i;

function isWriteCapableCommand(command: string): boolean {
  return WRITE_CAPABLE_PATTERN.test(command);
}

const PLAN_SIMPLE_COMMANDS = new Set([
  "pwd",
  "ls",
  "tree",
  "fd",
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "sort",
  "uniq",
  "diff",
  "file",
  "stat",
  "du",
  "df",
  "which",
  "whereis",
  "type",
  "jq",
  "bat",
  "eza",
  "echo",
  "printf",
  "uname",
  "whoami",
  "id",
  "date",
  "uptime",
]);

function deny(reason: string): PolicyDecision {
  return { action: "block", reason };
}

function ask(reason: string, hard = false): PolicyDecision {
  return { action: "ask", reason, hard };
}

function isInside(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function hasSymlinkComponent(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  if (rel === "" || rel === ".") return false;
  let current = basePath;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

export function resolvePathScope(
  rawPath: string,
  cwd: string,
): { absolutePath: string; insideProject: boolean; symlinkEscape: boolean } {
  const root = resolve(cwd);
  const absolutePath = resolve(root, rawPath);
  const insideProject = isInside(root, absolutePath);
  return {
    absolutePath,
    insideProject,
    symlinkEscape: insideProject && hasSymlinkComponent(root, absolutePath),
  };
}

/**
 * #46: subagent write-scope. Returns true if `target` (a raw path as the
 * write/edit tool receives it) resolves to a location equal to or nested
 * inside one of the `allowedPatterns` (project-relative or absolute paths).
 * An empty pattern list means "no restriction" – the caller is responsible
 * for handling the unrestricted case (e.g. requiring confirmation). Patterns
 * are paths/dirs, not globs.
 */
export function isPathWithinAllowed(
  target: string,
  cwd: string,
  allowedPatterns: string[],
): boolean {
  if (allowedPatterns.length === 0) return true;
  const root = resolve(cwd);
  const targetAbs = resolve(root, target);
  for (const raw of allowedPatterns) {
    const pattern = raw.trim();
    if (!pattern) continue;
    const allowedAbs = isAbsolute(pattern) ? resolve(pattern) : resolve(root, pattern);
    if (isInside(allowedAbs, targetAbs)) return true;
  }
  return false;
}

export function isSensitiveReference(value: string): boolean {
  const withoutEnvExample = value.replace(ENV_EXAMPLE_PATTERN, "$1");
  return (
    SECRET_PATH_PATTERN.test(withoutEnvExample) ||
    /(?:^|\s)(?:env|printenv)(?:\s|$)/i.test(withoutEnvExample) ||
    /\$(?:\{)?[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL)[A-Z0-9_]*(?:\})?/i.test(
      withoutEnvExample,
    )
  );
}

function isSystemPath(path: string): boolean {
  return SYSTEM_PATHS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

export function decideFileAccess(
  permissionLevel: PermissionLevel,
  operation: FileOperation,
  rawPath: string,
  cwd: string,
  writeOverride: WriteOverride = "inherit",
): PolicyDecision {
  const scope = resolvePathScope(rawPath, cwd);
  const isReadRestricted =
    permissionLevel === "read-only" || permissionLevel === "read-bash" || permissionLevel === "test-bash";

  if (
    isSensitiveReference(rawPath) ||
    isSensitiveReference(scope.absolutePath)
  ) {
    return isReadRestricted
      ? deny(
          "Diese Zugriffsstufe blockiert Secrets und SSH-/Credential-Dateien.",
        )
      : ask("Zugriff auf Secrets, Tokens, Credentials oder SSH-Keys", true);
  }

  if (isReadRestricted) {
    if (operation === "write") {
      return isPlanFilePath(rawPath, cwd)
        ? ALLOW
        : deny(
            `Diese Zugriffsstufe erlaubt Schreibzugriff ausschließlich auf ${PLAN_RELATIVE_PATH}.`,
          );
    }
    if (!scope.insideProject || scope.symlinkEscape) {
      return deny(
        "Diese Zugriffsstufe blockiert Lesezugriff außerhalb des Projekts.",
      );
    }
    return ALLOW;
  }

  if (operation === "write" && writeOverride === "block") {
    return deny("Schreibrechte-Einstellung: Schreiben ist blockiert.");
  }
  if (operation === "write" && writeOverride === "plan-file-only") {
    return isPlanFilePath(rawPath, cwd)
      ? ALLOW
      : deny("Schreibrechte-Einstellung: nur die Plan-Datei ist beschreibbar.");
  }

  if (operation === "write" && scope.symlinkEscape) {
    return ask(
      "Schreibzugriff über einen Symlink außerhalb der Projektgrenze",
      true,
    );
  }
  if (operation === "write" && isSystemPath(scope.absolutePath)) {
    return ask(`Änderung am Systempfad ${scope.absolutePath}`, true);
  }
  if (operation === "write" && !scope.insideProject) {
    return permissionLevel === "yolo"
      ? ALLOW
      : ask(`Änderung außerhalb des Projekts: ${scope.absolutePath}`);
  }
  return ALLOW;
}

interface ParsedShell {
  segments: string[][];
  error?: string;
}

/**
 * Conservative parser for Plan Mode. It accepts plain commands and pipelines,
 * but rejects shell constructs whose effects cannot be proven read-only.
 */
export function parseReadOnlyShell(command: string): ParsedShell {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "`" || (char === "$" && next === "(")) {
      return { segments: [], error: "Command-Substitution ist nicht erlaubt." };
    }
    if (char === "\n" || char === "\r" || char === ";" || char === "&") {
      return { segments: [], error: "Shell-Verkettungen sind nicht erlaubt." };
    }
    if (char === "<" || char === ">") {
      return { segments: [], error: "Shell-Redirections sind nicht erlaubt." };
    }
    if (char === "|") {
      if (next === "|") {
        return {
          segments: [],
          error: "Bedingte Shell-Verkettungen sind nicht erlaubt.",
        };
      }
      if (!current.trim()) {
        return { segments: [], error: "Leeres Pipeline-Segment." };
      }
      segments.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (quote || escaped) {
    return { segments: [], error: "Unvollständige Shell-Quoting-Sequenz." };
  }
  if (!current.trim()) {
    return { segments: [], error: "Leeres Kommando." };
  }
  segments.push(current.trim());

  const tokenized = segments.map(tokenizeSegment);
  if (tokenized.some((tokens) => tokens.length === 0)) {
    return {
      segments: [],
      error: "Kommando konnte nicht sicher zerlegt werden.",
    };
  }
  return { segments: tokenized };
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of segment) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function containsExternalPath(tokens: string[], cwd: string): boolean {
  return tokens.slice(1).some((token) => {
    if (token.startsWith("-")) return false;
    if (token === "~" || token.startsWith("~/")) return true;
    if (isAbsolute(token)) return !isInside(resolve(cwd), resolve(token));
    if (token === ".." || token.startsWith("../")) {
      return !isInside(resolve(cwd), resolve(cwd, token));
    }
    const candidate = resolve(cwd, token);
    if (existsSync(candidate)) {
      const scope = resolvePathScope(token, cwd);
      return !scope.insideProject || scope.symlinkEscape;
    }
    return false;
  });
}

function hasAnyOption(tokens: string[], patterns: RegExp[]): boolean {
  return tokens
    .slice(1)
    .some((token) => patterns.some((pattern) => pattern.test(token)));
}

function isSafeGit(tokens: string[]): boolean {
  const subcommand = tokens[1]?.toLowerCase();
  if (!subcommand) return false;
  if (hasAnyOption(tokens, [/^--output(?:=|$)/i, /^--ext-diff$/i]))
    return false;

  switch (subcommand) {
    case "status":
    case "log":
    case "diff":
    case "show":
      return true;
    case "branch":
      return !hasAnyOption(tokens, [
        /^-[dDmMcC]$/,
        /^--(?:delete|move|copy)$/i,
      ]);
    case "remote":
      return tokens.length === 2 || (tokens.length === 3 && tokens[2] === "-v");
    case "config":
      return tokens[2] === "--get" || tokens[2] === "--get-all";
    default:
      return subcommand.startsWith("ls-");
  }
}

function isSafePlanSegment(tokens: string[], cwd: string): boolean {
  const executable = tokens[0].split("/").pop()?.toLowerCase() ?? "";
  if (tokens.some((token) => isSensitiveReference(token))) return false;
  if (containsExternalPath(tokens, cwd)) return false;

  if (PLAN_SIMPLE_COMMANDS.has(executable)) {
    if (
      executable === "tree" &&
      hasAnyOption(tokens, [/^-o$/, /^--output(?:=|$)/i])
    ) {
      return false;
    }
    if (
      ["sort", "uniq", "diff"].includes(executable) &&
      hasAnyOption(tokens, [/^-o$/, /^--output(?:=|$)/i])
    ) {
      return false;
    }
    if (
      executable === "fd" &&
      hasAnyOption(tokens, [/^-x$/, /^-X$/, /^--exec(?:-batch)?$/i])
    ) {
      return false;
    }
    if (executable === "rg" && hasAnyOption(tokens, [/^--pre(?:=|$)/i])) {
      return false;
    }
    return true;
  }
  if (executable === "find") {
    return !hasAnyOption(tokens, [
      /^-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/i,
    ]);
  }
  if (executable === "sed") {
    return (
      hasAnyOption(tokens, [/^-n$/, /^--quiet$/, /^--silent$/]) &&
      !hasAnyOption(tokens, [/^-i/, /^--in-place/])
    );
  }
  if (executable === "git") return isSafeGit(tokens);
  if (executable === "node") {
    return tokens.length === 2 && ["-v", "--version"].includes(tokens[1]);
  }
  if (["npm", "pnpm", "yarn"].includes(executable)) {
    if (tokens.length === 2 && ["-v", "--version"].includes(tokens[1])) {
      return true;
    }
    return [
      "list",
      "ls",
      "view",
      "info",
      "search",
      "outdated",
      "audit",
    ].includes(tokens[1]?.toLowerCase());
  }
  if (["python", "python3"].includes(executable)) {
    return tokens.length === 2 && tokens[1] === "--version";
  }
  if (executable === "tsc") {
    return (
      hasAnyOption(tokens, [/^--noEmit$/i]) &&
      !hasAnyOption(tokens, [
        /^--build$/i,
        /^-b$/i,
        /^--incremental$/i,
        /^--tsBuildInfoFile/i,
        /^--generateTrace/i,
      ])
    );
  }
  if (executable === "eslint") {
    return !hasAnyOption(tokens, [
      /^--fix(?:-dry-run)?$/i,
      /^--output-file/i,
      /^-o$/i,
      /^--cache$/i,
    ]);
  }
  if (executable === "biome") {
    return (
      tokens[1] === "check" && !hasAnyOption(tokens, [/^--write$/i, /^--fix$/i])
    );
  }
  if (executable === "ruff") {
    return (
      tokens[1] === "check" &&
      hasAnyOption(tokens, [/^--no-cache$/i]) &&
      !hasAnyOption(tokens, [/^--fix(?:-only)?$/i])
    );
  }
  if (executable === "mypy") {
    return hasAnyOption(tokens, [/^--no-incremental$/i]);
  }
  if (executable === "gh") {
    const area = tokens[1];
    const action = tokens[2];
    return (
      ["issue", "pr", "run", "repo", "workflow"].includes(area) &&
      ["list", "view", "status", "diff"].includes(action)
    );
  }
  return false;
}

export function isPlanSafeCommand(command: string, cwd: string): boolean {
  const parsed = parseReadOnlyShell(command);
  return (
    !parsed.error &&
    parsed.segments.every((tokens) => isSafePlanSegment(tokens, cwd))
  );
}

// #43/#63: Test-safe commands – extends read-only with controlled test/check
// runners whose effect is provably read-only on its own (no package.json
// lifecycle hooks, no implicit npx download, no snapshot/coverage/report
// writes). npm test, npx vitest/jest/mocha and Playwright/Cypress are
// deliberately NOT in this list – they need the extra checks in
// evaluateTestCommand below and are not safe by pattern match alone.
const TEST_SAFE_PATTERNS: Array<[RegExp, string]> = [
  [/^tsc\s+--noEmit\b/, "tsc --noEmit"],
  [/^npx\s+tsc\s+--noEmit\b/, "npx tsc --noEmit"],
  [/^npm\s+run\s+lint\b(?!.*--fix)/, "npm run lint (no --fix)"],
  [/^npx\s+eslint\b(?!.*--fix)/, "npx eslint (no --fix)"],
  [/^npx\s+prettier\s+--check\b/, "npx prettier --check"],
  [/^node\s+\S*tests?[/\\]/, "node test runner"],
  [/^node\s+\S*test\.m?js\b/, "node test file"],
  [/^node\s+\S*\.test\.(?:ts|m?js)\b/, "node .test file"],
];

// Block patterns that are never allowed under test-bash
const TEST_BLOCK_PATTERNS: Array<[RegExp, string]> = [
  [/(?:&&|\|\||[|;&<>`\n\r]|\$\(|\$\{)/, "shell metacharacter (chaining/redirect/substitution)"], // #45
  [/\bnpm\s+(i|install|uninstall|update|upgrade|audit\s+fix|outdated|rebuild|ci|dedupe|prune|shrinkwrap)\b/, "npm package management"],
  // Negative lookbehind excludes flags like --no-install/--update-snapshots:
  // a hyphen immediately before the keyword means it's a flag, not a
  // package-management subcommand/verb.
  [/\bnpx\s+.{0,20}\b(?<!-)(install|update|uninstall|create|init|add|remove)\b/, "npx package management"],
  [/\byarn\s+(add|remove|install|upgrade)\b/, "yarn package management"],
  [/\bpnpm\s+(add|remove|install|update)\b/, "pnpm package management"],
  [/\bpip\s+install\b/, "pip install"],
  [/\b(?:npm|npx|yarn)\s+run\s+(?:build|format|fmt|fix|release|deploy|publish|start|dev|serve|watch)\b/, "build/release command"],
  [/--fix\b/, "--fix flag"],
  [/--write\b/, "--write flag"],
  [/\brm\s+(-[rRf]\s+)*[^\s]/, "rm command"],
  [/\b(?:rmdir|unlink)\b/, "destructive file removal"],
  [/\bsudo\b/, "sudo"],
  [/\bchmod\s+[^\s]*[wrx]/, "chmod with permission change"],
  [/\bchown\b/, "chown"],
];

// #63: flags whose effect cannot be proven read-only – snapshot updates,
// coverage output and file-writing reporters. Allowed anywhere else under
// test-bash, but these always require confirmation (or are auto-denied in
// non-interactive/subagent contexts – see mode-permissions.ts's approve()).
const TEST_WRITE_FLAG_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|\s)-u(?:\s|$)/, "-u (snapshot update)"],
  [/--update-snapshots?\b/i, "--update-snapshot(s)"],
  [/--updateSnapshot\b/, "--updateSnapshot"],
  [/--coverage\b/, "--coverage"],
  [/--outputFile\b/, "--outputFile"],
  [/--output-file\b/, "--output-file"],
  [/--reporter[=\s]\S*(?:html|json|junit)/i, "file-writing --reporter"],
];

// #63: npm automatically runs pre<script>/post<script> as part of running
// <script> – their content is unknown to this policy, so "npm test" is only
// provably read-only when package.json is readable and neither hook exists.
function hasUnverifiedTestLifecycleHooks(
  cwd: string,
  scriptName: string,
): boolean {
  let raw: string;
  try {
    raw = readFileSync(resolve(cwd, "package.json"), "utf8");
  } catch {
    return true;
  }
  let scripts: unknown;
  try {
    scripts = JSON.parse(raw)?.scripts;
  } catch {
    return true;
  }
  if (!scripts || typeof scripts !== "object") return true;
  const record = scripts as Record<string, unknown>;
  return Boolean(record[`pre${scriptName}`] || record[`post${scriptName}`]);
}

// #63: npx silently downloads a missing package unless it already resolves
// locally or --no-install is passed – neither is provably read-only.
function isLocallyResolvableNpxTool(
  cwd: string,
  toolName: string,
  command: string,
): boolean {
  if (/--no-install\b/.test(command)) return true;
  return existsSync(resolve(cwd, "node_modules", ".bin", toolName));
}

// #63: test-bash's full decision for a single command. Returns ask() rather
// than deny() where a human (or, non-interactively, an automatic denial –
// see mode-permissions.ts's approve()) should decide, instead of silently
// allowing or silently blocking an unverifiable command.
function evaluateTestCommand(command: string, cwd: string): PolicyDecision {
  const trimmed = command.trim();

  for (const [pattern, reason] of TEST_BLOCK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return deny(`Test Bash: ${reason} ist blockiert.`);
    }
  }
  for (const [pattern, reason] of TEST_WRITE_FLAG_PATTERNS) {
    if (pattern.test(trimmed)) {
      return ask(
        `Test Bash: "${reason}" kann Dateien schreiben und ist nicht read-only garantiert.`,
      );
    }
  }

  const npmTestMatch = /^npm\s+(?:run(?:-script)?\s+)?test(?::(\w+))?\b/.exec(
    trimmed,
  );
  if (npmTestMatch) {
    const scriptName = npmTestMatch[1] ? `test:${npmTestMatch[1]}` : "test";
    return hasUnverifiedTestLifecycleHooks(cwd, scriptName)
      ? ask(
          `Test Bash: pretest/posttest-Skript für "${scriptName}" ist unbekannt oder package.json nicht lesbar.`,
        )
      : ALLOW;
  }

  const npxRunnerMatch = /^npx\s+(vitest|jest|mocha)\b(.*)$/.exec(trimmed);
  if (npxRunnerMatch) {
    const [, tool, rest] = npxRunnerMatch;
    if (tool === "vitest" && /\b(?:watch|ui|dev)\b/.test(rest)) {
      return deny("Test Bash: vitest im Watch/UI/Dev-Modus ist blockiert.");
    }
    return isLocallyResolvableNpxTool(cwd, tool, trimmed)
      ? ALLOW
      : ask(
          `Test Bash: npx könnte "${tool}" nachinstallieren (nicht lokal in node_modules/.bin gefunden, kein --no-install).`,
        );
  }

  if (
    /^npx\s+playwright\s+test\b/.test(trimmed) ||
    /^npx\s+cypress\s+run\b/.test(trimmed)
  ) {
    return ask(
      "Test Bash: Playwright/Cypress schreiben standardmäßig Artefakte (Screenshots, Videos, Reports) und sind nicht read-only garantiert.",
    );
  }

  for (const [pattern] of TEST_SAFE_PATTERNS) {
    if (pattern.test(trimmed)) return ALLOW;
  }

  return deny(
    "Test Bash: Das Kommando ist kein erlaubter Test/Lint/Check-Befehl. " +
      "Erlaubt sind npm test, tsc --noEmit, npm run lint (ohne --fix) und ähnliche geprüfte Prüfbefehle.",
  );
}

function referencesSystemPath(command: string): boolean {
  return SYSTEM_PATHS.some((path) =>
    new RegExp(
      `(?:^|[\\s'"=])${path.replace("/", "\\/")}(?:\\/|\\s|'|"|$)`,
    ).test(command),
  );
}

function likelyExternalWrite(command: string, cwd: string): boolean {
  const parsed = parseReadOnlyShell(command);
  const tokens = parsed.error
    ? command.replace(/\d*(?:>>?|<<?)/g, " ").split(/\s+/)
    : parsed.segments.flat();
  return isWriteCapableCommand(command) && containsExternalPath(tokens, cwd);
}

export interface DecideBashOptions {
  writeOverride?: WriteOverride;
}

export function decideBash(
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
  options: DecideBashOptions = {},
): PolicyDecision {
  const { writeOverride = "inherit" } = options;
  const trimmed = command.trim();
  if (!trimmed) return deny("Leeres Bash-Kommando.");

  if (permissionLevel === "read-only") {
    return deny(
      "Read only: Bash-Kommandos sind in dieser Zugriffsstufe deaktiviert.",
    );
  }
  if (permissionLevel === "read-bash") {
    return isPlanSafeCommand(trimmed, cwd)
      ? ALLOW
      : deny("Read + Bash: Das Kommando ist nicht nachweislich read-only.");
  }

  // #43/#63: test-bash extends read-bash with controlled test/check
  // commands. This is a restricted execution mode, not a read-only
  // guarantee – commands whose write behavior can't be verified statically
  // (unknown pretest/posttest hooks, non-local npx, snapshot/coverage/report
  // writers) return ask() instead of a silent allow.
  if (permissionLevel === "test-bash") {
    if (isPlanSafeCommand(trimmed, cwd)) return ALLOW;
    return evaluateTestCommand(trimmed, cwd);
  }

  if (isSensitiveReference(trimmed)) {
    return ask("Zugriff auf Secrets, Tokens, Credentials oder SSH-Keys", true);
  }

  for (const [pattern, reason] of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(trimmed)) return ask(reason, true);
  }
  if (
    referencesSystemPath(trimmed) &&
    (/\b(?:rm|mv|cp|mkdir|touch|tee|truncate|dd|chmod|chown|chgrp|ln|sed)\b/i.test(
      trimmed,
    ) ||
      /(?:^|[^<])>(?!>)/.test(trimmed) ||
      />>/.test(trimmed))
  ) {
    return ask("Änderung an einem Systempfad", true);
  }

  if (writeOverride !== "inherit" && isWriteCapableCommand(trimmed)) {
    return writeOverride === "block"
      ? deny("Schreibrechte-Einstellung: Schreiben ist blockiert.")
      : deny(
          "Schreibrechte-Einstellung: Bash darf nur über das write/edit-Tool die Plan-Datei ändern.",
        );
  }

  for (const [pattern, reason] of SENSITIVE_ASK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return permissionLevel === "yolo" ? ALLOW : ask(reason);
    }
  }
  for (const [pattern, reason] of ROUTINE_ASK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return permissionLevel === "yolo" || permissionLevel === "full-access"
        ? ALLOW
        : ask(reason);
    }
  }
  if (likelyExternalWrite(trimmed, cwd)) {
    return permissionLevel === "yolo"
      ? ALLOW
      : ask("Bash-Änderung außerhalb des aktuellen Projekts");
  }
  return ALLOW;
}
