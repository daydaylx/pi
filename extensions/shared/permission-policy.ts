import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PermissionLevel } from "./workflow-status.ts";

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
    /\brm\b[^;&|]*(?:^|\s)["']?\/(?:[/.])*["']?(?=\s|$)/i,
    "Löschen des Root-Dateisystems",
  ],
  [
    /\brm\b[^;&|]*(?:\{[^}]*\}|`|\$(?:\(|\{[^}]*\}|['"]|[A-Za-z_][A-Za-z0-9_]*|[0-9?*#@!_-]))/,
    "Löschen über eine dynamisch expandierte Pfadangabe",
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

/**
 * Identifies a caller-defined write exception (e.g. the workflow extension's
 * plan file) that stays writable even under restrictive permission levels.
 * Keeps this module independent from any specific workflow mode.
 */
export interface ProtectedWritePath {
  matches: (rawPath: string, cwd: string) => boolean;
  label: string;
}

export interface DecideFileAccessOptions {
  protectedWritePath?: ProtectedWritePath;
}

export function decideFileAccess(
  permissionLevel: PermissionLevel,
  operation: FileOperation,
  rawPath: string,
  cwd: string,
  options: DecideFileAccessOptions = {},
): PolicyDecision {
  const { protectedWritePath } = options;
  const scope = resolvePathScope(rawPath, cwd);
  const isReadRestricted =
    permissionLevel === "read-only" || permissionLevel === "read-bash";

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
      return protectedWritePath?.matches(rawPath, cwd)
        ? ALLOW
        : deny(
            `Diese Zugriffsstufe erlaubt Schreibzugriff ausschließlich auf ${protectedWritePath?.label ?? "keine Datei"}.`,
          );
    }
    if (!scope.insideProject || scope.symlinkEscape) {
      return deny(
        "Diese Zugriffsstufe blockiert Lesezugriff außerhalb des Projekts.",
      );
    }
    return ALLOW;
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
    // Command substitution is active outside quotes and inside double quotes;
    // it is literal only inside single quotes. Check before quote handling so
    // `echo "$(touch file)"` cannot pass the harmless `echo` allowlist.
    if (
      quote !== "'" &&
      (char === "`" || (char === "$" && next === "("))
    ) {
      return { segments: [], error: "Command-Substitution ist nicht erlaubt." };
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
      return isSafeGitBranch(tokens);
    case "remote":
      return tokens.length === 2 || (tokens.length === 3 && tokens[2] === "-v");
    case "config":
      return tokens[2] === "--get" || tokens[2] === "--get-all";
    default:
      return subcommand.startsWith("ls-");
  }
}

function isSafeGitBranch(tokens: string[]): boolean {
  const args = tokens.slice(2);
  if (args.length === 0) return true;
  if (args.length === 1 && args[0] === "--show-current") return true;

  // `git branch <name>` creates a branch. Only a short, explicit list of
  // read-only listing/filter options is accepted; unknown flags and bare
  // operands are denied unless `--list`/`-l` makes them patterns.
  const safeFlags = new Set([
    "-a",
    "--all",
    "-r",
    "--remotes",
    "-v",
    "-vv",
    "--verbose",
    "--no-color",
  ]);
  const safeValueOptions = [
    /^--(?:color|column|contains|no-contains|merged|no-merged|points-at|sort|format)=.+$/i,
  ];
  let listPatternsAllowed = false;

  for (const arg of args) {
    if (arg === "-l" || arg === "--list") {
      listPatternsAllowed = true;
      continue;
    }
    if (
      safeFlags.has(arg) ||
      safeValueOptions.some((pattern) => pattern.test(arg))
    ) {
      continue;
    }
    if (listPatternsAllowed && !arg.startsWith("-")) continue;
    return false;
  }
  return true;
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
    const subcommand = tokens[1]?.toLowerCase();
    if (subcommand === "audit") {
      return !hasAnyOption(tokens, [/^--fix(?:=|$)/i]);
    }
    return [
      "list",
      "ls",
      "view",
      "info",
      "search",
      "outdated",
    ].includes(subcommand);
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

export function decideBash(
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
): PolicyDecision {
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
