import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";
import { isInside } from "./path-utils.ts";
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

/**
 * Project-internal paths where a write turns into execution later.
 *
 * Everything else inside the project is an ordinary file: the level decides.
 * These are not. A `.git/hooks/pre-commit` runs on the next commit, a
 * `.git/config` `core.pager`/`core.fsmonitor`/`alias.*` runs on the next git
 * command, and `.pi/lsp.json` decides which binary the language-server
 * registry spawns. Without this list they were the one way a plain in-project
 * write escalated to code execution without ever passing a bash decision.
 */
const PROTECTED_PROJECT_PATHS = [".git", ".pi/lsp.json", ".pi/verify.json"];

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

// In project-write lösen diese Muster eine Rückfrage aus. confirm-all fragt
// ohnehin bei jeder Mutation; YOLO überspringt Rückfragen nur innerhalb seiner
// harten Secret-, System-, Symlink- und Projektgrenzen.
const SENSITIVE_ASK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:rm|rmdir|unlink|trash)\b/i, "Datei- oder Ordnerlöschung"],
  [/\bgio\s+trash\b/i, "Datei- oder Ordnerlöschung"],
  [/\bsudo\b|\bsu\s+-?(?:\s|$)/i, "Ausführung mit erhöhten Rechten"],
  [
    /\bgit\s+push\b[^;&|]*(?:--force(?:-with-lease)?|-f)(?:\s|$)/i,
    "erzwungener Git-Push",
  ],
];

// Routinemutationen fragen in project-write nach. confirm-all fragt bereits
// allgemein; YOLO wird vor dieser Auswertung innerhalb harter Grenzen erlaubt.
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

const SAFE_SHELL_BUILTINS = new Set(["echo", "printf", "pwd", "type"]);
const TRUSTED_EXECUTABLE_ROOTS = [
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].flatMap((path) => {
  try {
    return [realpathSync(path)];
  } catch {
    return [];
  }
});

function deny(reason: string): PolicyDecision {
  return { action: "block", reason };
}

function ask(reason: string, hard = false): PolicyDecision {
  return { action: "ask", reason, hard };
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

/**
 * True if `$NAME` or `${NAME}` appears outside single quotes. A real shell
 * expands these before this policy ever sees the resolved path, so a token
 * that looks like a safe relative path (e.g. `$HOME/x`) can resolve anywhere
 * on disk at runtime. Path checks elsewhere in this module (containsExternalPath,
 * resolvePathScope) only see the literal token text and cannot detect this on
 * their own. Mirrors the quote/escape handling used for shell parsing below so
 * a literal `'$HOME/x'` (single-quoted, never expanded by a shell) is not
 * flagged.
 */
export function containsUnquotedVariableExpansion(command: string): boolean {
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (
      quote !== "'" &&
      char === "$" &&
      /[A-Za-z_{]/.test(command[index + 1] ?? "")
    ) {
      return true;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    }
  }
  return false;
}

function isSystemPath(path: string): boolean {
  return SYSTEM_PATHS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

/** True for a path inside the project that later executes what is written. */
function isProtectedProjectPath(absolutePath: string, cwd: string): boolean {
  const rel = relative(resolve(cwd), absolutePath).split(sep).join("/");
  if (!rel || rel.startsWith("../")) return false;
  return PROTECTED_PROJECT_PATHS.some(
    (entry) => rel === entry || rel.startsWith(`${entry}/`),
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
  const isReadRestricted = permissionLevel === "readonly";

  if (
    isSensitiveReference(rawPath) ||
    isSensitiveReference(scope.absolutePath)
  ) {
    return isReadRestricted || permissionLevel === "yolo"
      ? deny(
          "Harte Grenze: Secrets und SSH-/Credential-Dateien sind blockiert.",
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

  if (!scope.insideProject && operation === "read") {
    return permissionLevel === "yolo"
      ? deny("Harte Projektgrenze: externer Lesezugriff ist in YOLO blockiert.")
      : ask(`Lesezugriff außerhalb des Projekts: ${scope.absolutePath}`);
  }
  if (operation === "write" && scope.symlinkEscape) {
    return permissionLevel === "yolo"
      ? deny("Harte Symlink-Grenze: Schreibzugriff wurde blockiert.")
      : ask(
          "Schreibzugriff über einen Symlink außerhalb der Projektgrenze",
          true,
        );
  }
  if (operation === "write" && isSystemPath(scope.absolutePath)) {
    return permissionLevel === "yolo"
      ? deny("Harte Systemgrenze: Änderung am Systempfad wurde blockiert.")
      : ask(`Änderung am Systempfad ${scope.absolutePath}`, true);
  }
  if (operation === "write" && !scope.insideProject) {
    return permissionLevel === "yolo"
      ? deny("Harte Projektgrenze: externe Änderung wurde blockiert.")
      : ask(`Änderung außerhalb des Projekts: ${scope.absolutePath}`);
  }
  if (
    operation === "write" &&
    isProtectedProjectPath(scope.absolutePath, cwd)
  ) {
    return permissionLevel === "yolo"
      ? deny(
          "Harte Grenze: Ausführungspfad im Projekt wurde in YOLO blockiert.",
        )
      : ask(
          `Änderung an einem Ausführungspfad im Projekt: ${scope.absolutePath}`,
          true,
        );
  }
  if (operation === "write" && permissionLevel === "confirm-all") {
    return ask(`Mutation im Projekt: ${scope.absolutePath}`);
  }
  return ALLOW;
}

interface ParsedShell {
  segments: string[][];
  error?: string;
}

interface ParseReadOnlyShellOptions {
  /**
   * Treat `;` like `|`: split into segments instead of hard-blocking. Each
   * segment still goes through the caller's own per-segment classification,
   * so `ls -la; rm -rf foo` stays blocked — only the structural split is
   * widened, not what counts as safe. Only `isPlanModeDiagnosticCommand`
   * sets this; `isPlanSafeCommand` (readonly) and the other callers below
   * keep the strict default.
   */
  allowSemicolonChaining?: boolean;
  /**
   * Accept `2>`, `1>` or `&>` redirected to exactly `/dev/null` as a safe,
   * content-free target (the extremely common "suppress stderr while
   * probing" idiom, e.g. `ls -la .agent 2>/dev/null`). A bare `>` with no fd
   * prefix, or any target other than `/dev/null`, still hard-blocks — this
   * does not open up writing to arbitrary files. Only
   * `isPlanModeDiagnosticCommand` sets this.
   */
  allowDevNullRedirect?: boolean;
}

const DEV_NULL_AMP_REDIRECT = /^&>\/dev\/null(?=$|[\s;|])/;
const DEV_NULL_TARGET = /^>\/dev\/null(?=$|[\s;|])/;
const TRAILING_FD_ONE_OR_TWO = /(?:^|\s)[12]$/;

/**
 * Conservative parser for Plan Mode. It accepts plain commands and pipelines,
 * but rejects shell constructs whose effects cannot be proven read-only.
 * `options` widens exactly two constructs (see ParseReadOnlyShellOptions);
 * every other caller passes no options and keeps the original strict
 * behavior unchanged.
 */
export function parseReadOnlyShell(
  command: string,
  options: ParseReadOnlyShellOptions = {},
): ParsedShell {
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
    if (quote !== "'" && (char === "`" || (char === "$" && next === "("))) {
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
    if (char === "\n" || char === "\r") {
      return { segments: [], error: "Shell-Verkettungen sind nicht erlaubt." };
    }
    if (char === ";") {
      if (options.allowSemicolonChaining) {
        if (!current.trim()) {
          return { segments: [], error: "Leeres Pipeline-Segment." };
        }
        segments.push(current.trim());
        current = "";
        continue;
      }
      return { segments: [], error: "Shell-Verkettungen sind nicht erlaubt." };
    }
    if (char === "&") {
      const ampRedirect = options.allowDevNullRedirect
        ? DEV_NULL_AMP_REDIRECT.exec(command.slice(index))
        : null;
      if (ampRedirect) {
        index += ampRedirect[0].length - 1;
        continue;
      }
      return { segments: [], error: "Shell-Verkettungen sind nicht erlaubt." };
    }
    if (char === "<") {
      return { segments: [], error: "Shell-Redirections sind nicht erlaubt." };
    }
    if (char === ">") {
      const target = options.allowDevNullRedirect
        ? DEV_NULL_TARGET.exec(command.slice(index))
        : null;
      if (target && TRAILING_FD_ONE_OR_TWO.test(current)) {
        current = current.slice(0, -1);
        index += target[0].length - 1;
        continue;
      }
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
    // Options that contain file paths: --option=value or --option value
    if (token.startsWith("-")) {
      // Check for --option=value where value might be a path
      const eqIdx = token.indexOf("=");
      if (eqIdx > 0) {
        const value = token.slice(eqIdx + 1);
        // Empty values like --from-file= are not paths
        if (!value) return false;
        // Check if the value is an absolute external path or a symlink escape
        if (isAbsolute(value)) return !isInside(resolve(cwd), resolve(value));
        if (value === "~" || value.startsWith("~/")) return true;
        // Relative paths in options: resolve from cwd
        if (value === ".." || value.startsWith("../")) {
          return !isInside(resolve(cwd), resolve(cwd, value));
        }
        const scope = resolvePathScope(value, cwd);
        return !scope.insideProject || scope.symlinkEscape;
      }
      // Bare options like -o are not paths
      return false;
    }
    if (token === "~" || token.startsWith("~/")) return true;
    if (isAbsolute(token)) return !isInside(resolve(cwd), resolve(token));
    if (token === ".." || token.startsWith("../")) {
      return !isInside(resolve(cwd), resolve(cwd, token));
    }
    const scope = resolvePathScope(token, cwd);
    return !scope.insideProject || scope.symlinkEscape;
  });
}

function hasAnyOption(tokens: string[], patterns: RegExp[]): boolean {
  return tokens
    .slice(1)
    .some((token) => patterns.some((pattern) => pattern.test(token)));
}

/**
 * Resolves the executable exactly as a shell PATH lookup would encounter it.
 * A first hit outside a root-owned system bin directory is rejected instead
 * of falling through to a later, trusted executable with the same basename.
 */
function trustedExecutableName(
  rawExecutable: string,
  cwd: string,
): string | undefined {
  if (
    SAFE_SHELL_BUILTINS.has(rawExecutable) &&
    !rawExecutable.includes("/") &&
    !rawExecutable.includes("\\")
  ) {
    return rawExecutable;
  }

  let candidate: string | undefined;
  if (rawExecutable.includes("/") || rawExecutable.includes("\\")) {
    // Relative executables remain attacker-controlled even when they happen
    // to resolve through `..` to a system directory.
    if (!isAbsolute(rawExecutable)) return undefined;
    candidate = resolve(rawExecutable);
  } else {
    for (const rawEntry of (process.env.PATH ?? "").split(delimiter)) {
      const entry = rawEntry ? resolve(rawEntry) : resolve(cwd);
      const pathCandidate = resolve(entry, rawExecutable);
      if (existsSync(pathCandidate)) {
        candidate = pathCandidate;
        break;
      }
    }
  }
  if (!candidate) return undefined;

  try {
    const canonical = realpathSync(candidate);
    if (!statSync(canonical).isFile()) return undefined;
    accessSync(canonical, constants.X_OK);
    if (!TRUSTED_EXECUTABLE_ROOTS.some((root) => isInside(root, canonical))) {
      return undefined;
    }
    return canonical.split(sep).pop()?.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Executable-name extraction for Plan Mode's bash guard — deliberately not
 * a filesystem/PATH trust check like trustedExecutableName. An earlier
 * version tried resolving through PATH and requiring the real binary to
 * live outside the project (mirroring trustedExecutableName's "outside a
 * trusted root" check, just with a wider trusted area) — that broke on
 * every ordinary setup: real npm/tsc/eslint commonly resolve through
 * node_modules/.bin (legitimately inside the project — the standard way a
 * project's own pinned devDependency versions run) or through a symlink to
 * an internal implementation file (`npm` to `npm-cli.js`), so the check
 * either rejected the exact in-project tool invocation the brief asks for
 * or silently returned the wrong name to classify by.
 *
 * trustedExecutableName's PATH-hijack paranoia is the right call for
 * `readonly`, a hard sandbox a user deliberately opts into, and stays
 * completely unchanged there. Plan Mode's guard is a different thing: an
 * accident-prevention layer on top of `project-write`/`confirm-all`, levels
 * that already run arbitrary bash freely with no executable-trust
 * verification at all outside this guard. Adding filesystem paranoia here
 * raises the bar above the rest of that permission level for no real
 * security gain (a renamed malicious binary placed early in PATH is an
 * existing, accepted risk of running any bash command under project-write,
 * on every permission level, in or out of Plan Mode) while breaking the
 * exact commands this guard exists to allow. So: just classify by the
 * literal token text, like the rest of this module's regex-based checks
 * (PLAN_SIMPLE_COMMANDS, isWriteCapableCommand) already do — an executable
 * name that doesn't match any recognized diagnostic tool still falls
 * through to `false` (blocked) in isPlanModeDiagnosticSegment below.
 */
function diagnosticExecutableName(rawExecutable: string): string | undefined {
  const name = rawExecutable.split(/[/\\]/).pop()?.toLowerCase();
  return name || undefined;
}

function isSafeGit(tokens: string[], stdoutIsPiped: boolean): boolean {
  let subcommandIndex = 1;
  let pagerDisabled = stdoutIsPiped;
  if (tokens[subcommandIndex] === "--no-pager") {
    pagerDisabled = true;
    subcommandIndex += 1;
  }

  const subcommand = tokens[subcommandIndex]?.toLowerCase();
  if (!subcommand) return false;
  const args = tokens.slice(subcommandIndex + 1);
  if (
    hasAnyOption(tokens, [
      /^--out/i,
      /^--ext-d/i,
      /^--textc/i,
      /^--pagin/i,
      /^--config(?:-env)?(?:=|$)/i,
      /^-c$/i,
      /^--show-sign/i,
    ])
  ) {
    return false;
  }

  switch (subcommand) {
    case "status":
      return true;
    case "log":
      return (
        pagerDisabled &&
        !args.some((arg) =>
          /^(?:-p|--patch|--stat|--numstat|--shortstat|--dirstat(?:=|$)|--summary)$/i.test(
            arg,
          ),
        )
      );
    case "diff":
    case "show":
      return pagerDisabled && args.includes("--no-textconv");
    case "branch":
      if (
        !pagerDisabled &&
        !(args.length === 1 && args[0] === "--show-current")
      ) {
        return false;
      }
      return isSafeGitBranch([tokens[0], "branch", ...args]);
    case "remote":
      return args.length === 0 || (args.length === 1 && args[0] === "-v");
    case "config":
      return args[0] === "--get" || args[0] === "--get-all";
    default:
      return subcommand === "ls-files" || subcommand === "ls-tree";
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

function hasAtMostOneUniqInput(tokens: string[]): boolean {
  const optionsWithSeparateValues = new Set([
    "-f",
    "--skip-fields",
    "-s",
    "--skip-chars",
    "-w",
    "--check-chars",
  ]);
  let positional = 0;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      positional += tokens.length - index - 1;
      break;
    }
    if (optionsWithSeparateValues.has(token)) {
      index += 1;
      if (index >= tokens.length) return false;
      continue;
    }
    if (token.startsWith("-")) continue;
    positional += 1;
  }
  // GNU uniq's second positional operand is an output file.
  return positional <= 1;
}

function isSafeSed(tokens: string[]): boolean {
  let quiet = false;
  const expressions: string[] = [];
  const operands: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-n" || token === "--quiet" || token === "--silent") {
      quiet = true;
      continue;
    }
    if (token === "-e" || token === "--expression") {
      index += 1;
      if (index >= tokens.length) return false;
      expressions.push(tokens[index]);
      continue;
    }
    if (token.startsWith("--expression=")) {
      expressions.push(token.slice("--expression=".length));
      continue;
    }
    if (token.startsWith("-")) return false;
    operands.push(token);
  }
  if (!quiet) return false;
  if (expressions.length === 0) {
    const expression = operands.shift();
    if (!expression) return false;
    expressions.push(expression);
  }
  if (operands.length === 0) return false;

  // The common inspection form `sed -n 'START,ENDp' file` is sufficient for
  // plan exploration and cannot contain GNU sed's `e` or `w` side effects.
  return expressions.every((expression) =>
    /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/.test(expression),
  );
}

/**
 * Per-tool classification shared by isSafePlanSegment (readonly, executable
 * resolved via the strict system-root-only trustedExecutableName) and
 * isPlanModeDiagnosticSegment's fallthrough (Plan Mode, executable taken
 * from the literal command text via diagnosticExecutableName) — takes the
 * already-resolved executable name so both callers share one body instead
 * of two copies of the same tool-by-tool rules.
 */
function classifyToolSegment(executable: string, tokens: string[]): boolean {
  if (PLAN_SIMPLE_COMMANDS.has(executable)) {
    if (
      executable === "tree" &&
      hasAnyOption(tokens, [/^-o(?:.+)?$/, /^--output(?:=|$)/i])
    ) {
      return false;
    }
    if (
      executable === "sort" &&
      hasAnyOption(tokens, [
        /^-o(?:.+)?$/i,
        /^-T(?:.+)?$/i,
        /^--out/i,
        /^--temp/i,
        /^--compress/i,
      ])
    ) {
      return false;
    }
    if (
      ["uniq", "diff"].includes(executable) &&
      hasAnyOption(tokens, [/^-o$/, /^--output(?:=|$)/i])
    ) {
      return false;
    }
    if (executable === "uniq" && !hasAtMostOneUniqInput(tokens)) return false;
    if (
      executable === "fd" &&
      hasAnyOption(tokens, [/^-x/, /^-X/, /^--exec(?:-batch)?(?:=|$)/i])
    ) {
      return false;
    }
    if (
      executable === "rg" &&
      hasAnyOption(tokens, [/^--pre(?:=|$)/i, /^--hostname-bin(?:=|$)/i])
    ) {
      return false;
    }
    if (
      executable === "file" &&
      hasAnyOption(tokens, [
        /^-C$/,
        /^-z$/,
        /^-Z$/,
        /^--compile$/i,
        /^--uncompress/i,
      ])
    ) {
      return false;
    }
    if (executable === "bat") {
      return (
        hasAnyOption(tokens, [/^--paging=never$/i]) &&
        !hasAnyOption(tokens, [/^--pager(?:=|$)/i])
      );
    }
    if (
      executable === "date" &&
      hasAnyOption(tokens, [/^-s(?:.+)?$/i, /^--set(?:=|$)/i])
    ) {
      return false;
    }
    return true;
  }
  if (executable === "find") {
    return !hasAnyOption(tokens, [
      /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/i,
    ]);
  }
  if (executable === "node") {
    return tokens.length === 2 && ["-v", "--version"].includes(tokens[1]);
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

function isSafePlanSegment(
  tokens: string[],
  cwd: string,
  stdoutIsPiped: boolean,
): boolean {
  const executable = trustedExecutableName(tokens[0], cwd);
  if (!executable) return false;
  if (tokens.some((token) => isSensitiveReference(token))) return false;
  if (containsExternalPath(tokens, cwd)) return false;
  if (executable === "sed") return isSafeSed(tokens);
  if (executable === "git") return isSafeGit(tokens, stdoutIsPiped);
  if (["npm", "pnpm", "yarn"].includes(executable)) {
    if (tokens.length === 2 && ["-v", "--version"].includes(tokens[1])) {
      return true;
    }
    const subcommand = tokens[1]?.toLowerCase();
    if (subcommand === "audit") {
      return !hasAnyOption(tokens, [/^--fix(?:=|$)/i]);
    }
    return ["list", "ls", "view", "info", "search", "outdated"].includes(
      subcommand,
    );
  }
  return classifyToolSegment(executable, tokens);
}

export function isPlanSafeCommand(command: string, cwd: string): boolean {
  if (containsUnquotedVariableExpansion(command)) return false;
  const parsed = parseReadOnlyShell(command);
  return (
    !parsed.error &&
    parsed.segments.every((tokens, index) =>
      isSafePlanSegment(tokens, cwd, index < parsed.segments.length - 1),
    )
  );
}

// npm/pnpm/yarn subcommands that mutate the package tree, the registry, an
// account, or local config/cache. Checked first and unconditionally
// blocked, regardless of anything below.
const PLAN_MODE_MUTATING_PACKAGE_SUBCOMMANDS = new Set([
  "install",
  "i",
  "add",
  "ci",
  "remove",
  "rm",
  "uninstall",
  "un",
  "update",
  "up",
  "upgrade",
  "global",
  "dlx",
  "link",
  "unlink",
  "publish",
  "unpublish",
  "dedupe",
  "prune",
  "rebuild",
  "pack",
  "version",
  "deprecate",
  "owner",
  "team",
  "org",
  "star",
  "unstar",
  "login",
  "adduser",
  "logout",
  "token",
  "init",
  "set",
  "config",
  "cache",
  "exec",
  "x",
]);

// npm's own built-in read/introspection subcommands: they never execute a
// project-defined script, so — unlike `run`/bare-subcommand aliases below —
// there is no script name to vet. Safe regardless of what the project
// happens to be named or contains.
const NPM_BUILTIN_READ_SUBCOMMANDS = new Set([
  "list",
  "ls",
  "view",
  "info",
  "search",
  "outdated",
  "ping",
  "whoami",
  "root",
  "prefix",
  "explain",
  "fund",
  "doctor",
]);

// Category prefixes a package.json script name must start with (optionally
// followed by `:`/`-`/`_` and a sub-namespace, e.g. `test:coverage`) to be
// treated as diagnostic. Deliberately a short list of conventional
// categories, not an attempt to enumerate every real project's script
// names — an unrecognized name is refused, not guessed at.
const DIAGNOSTIC_SCRIPT_NAME_PREFIXES = [
  "test",
  "typecheck",
  "type-check",
  "types",
  "lint",
  "check",
  "verify",
  "coverage",
  "audit",
  "build",
];

// Vetoes an otherwise-matching diagnostic prefix: catches the mutating
// variant of a diagnostic-sounding name (`lint:fix`, `format:write`,
// `eslint-fix`) that would otherwise pass the prefix check below.
const NON_DIAGNOSTIC_SCRIPT_NAME_MARKER =
  /(?:^|[:_-])(?:fix|write)(?:$|[:_-])/i;

/**
 * Is this package.json script name provably diagnostic — the same bar
 * "Tests, Typecheck, Lint (ohne --fix), Builds" from the brief holds any
 * other command to — rather than an arbitrary, potentially destructive
 * project-defined script (`generate`, `deploy`, a custom `npm foo` alias)?
 * A script this permissive check refuses can still run through
 * `project_check` against `.pi/verify.json`, which is the actual place to
 * declare a project's own trusted checks — this is only Plan Mode's bash
 * guard deciding what to trust *without* that declaration.
 */
function isDiagnosticScriptName(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  if (NON_DIAGNOSTIC_SCRIPT_NAME_MARKER.test(normalized)) return false;
  return DIAGNOSTIC_SCRIPT_NAME_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix}:`) ||
      normalized.startsWith(`${prefix}-`) ||
      normalized.startsWith(`${prefix}_`),
  );
}

function isPlanModeSafePackageManagerCommand(tokens: string[]): boolean {
  const subcommand = tokens[1]?.toLowerCase();
  if (!subcommand) return true; // bare `npm`/`pnpm`/`yarn` just prints help
  if (PLAN_MODE_MUTATING_PACKAGE_SUBCOMMANDS.has(subcommand)) return false;
  if (subcommand === "audit") return !hasAnyOption(tokens, [/^--fix(?:=|$)/i]);
  if (NPM_BUILTIN_READ_SUBCOMMANDS.has(subcommand)) return true;
  if (subcommand === "run" || subcommand === "run-script") {
    return isDiagnosticScriptName(tokens[2]);
  }
  // Any other bare subcommand doubles as a package.json script name under
  // npm/pnpm/yarn's lifecycle-alias convention (`npm test`, `npm start`, or
  // a custom `npm foo`) — not provably diagnostic just because it isn't a
  // recognized package-manager verb; held to the same bar as `run` above.
  return isDiagnosticScriptName(subcommand);
}

// A narrower, non-pager-obsessed read-only git surface than isSafeGit above:
// isSafeGit additionally demands --no-pager/--no-textconv on log/diff/show,
// which is calibrated for the `readonly` permission level's output-integrity
// concerns and rejects a plain `git diff`/`git show` outright — Plan Mode
// only cares whether the command can change repository state, so it accepts
// the plain form of the same read-only subcommands.
const PLAN_MODE_SAFE_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "show",
  "log",
  "describe",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "shortlog",
  "count-objects",
  "grep",
]);

function isPlanModeSafeGitCommand(tokens: string[]): boolean {
  const subcommand = tokens[1]?.toLowerCase();
  if (!subcommand) return false;
  if (PLAN_MODE_SAFE_GIT_SUBCOMMANDS.has(subcommand)) return true;
  if (subcommand === "branch") return isSafeGitBranch(tokens);
  if (subcommand === "remote") {
    const args = tokens.slice(2);
    return args.length === 0 || (args.length === 1 && args[0] === "-v");
  }
  if (subcommand === "config") {
    return tokens[2] === "--get" || tokens[2] === "--get-all";
  }
  return false;
}

/**
 * Per-segment classification for Plan Mode's bash guard. Structurally a
 * close copy of isSafePlanSegment (same trusted-executable check, same
 * secret/external-path guards, same PLAN_SIMPLE_COMMANDS/tsc/eslint/biome/
 * ruff/mypy/python/node/gh/sed/find branches — those already correctly
 * allow `tsc --noEmit` and plain `eslint` while blocking `--fix`), widened
 * in exactly the two places that made Plan Mode reject ordinary diagnostics:
 * npm/pnpm/yarn (isSafePlanSegment only allowed list/view/info/search/
 * outdated — not `run`/`test`, so `npm test`/`npm run typecheck`/
 * `npm run verify` were rejected) and git (see isPlanModeSafeGitCommand
 * above). Everything neither recognized here nor in isSafePlanSegment's
 * other branches stays refused — this widens two specific allowlists, it
 * does not flip the guard from an allowlist to a default-allow blocklist.
 */
function isPlanModeDiagnosticSegment(tokens: string[], cwd: string): boolean {
  const executable = diagnosticExecutableName(tokens[0]);
  if (!executable) return false;
  if (tokens.some((token) => isSensitiveReference(token))) return false;
  if (containsExternalPath(tokens, cwd)) return false;

  if (["npm", "pnpm", "yarn"].includes(executable)) {
    if (tokens.length === 2 && ["-v", "--version"].includes(tokens[1])) {
      return true;
    }
    return isPlanModeSafePackageManagerCommand(tokens);
  }
  if (executable === "npx") return false; // arbitrary package execution

  if (executable === "git") return isPlanModeSafeGitCommand(tokens);
  if (executable === "sed") return isSafeSed(tokens);

  return classifyToolSegment(executable, tokens);
}

/**
 * Is this bash command safe to run while Plan Mode is active? Distinct from
 * isPlanSafeCommand (which backs the `readonly` permission level and stays
 * unchanged/unweakened) — see isPlanModeDiagnosticSegment for what differs
 * and why. Shares the same shell-structure parser and most hard guards
 * (unquoted variable expansion, command substitution, secrets, external
 * paths) but is the only caller that widens two structural constructs via
 * parseReadOnlyShell's options: `;`-chaining of diagnostics (each segment
 * still individually classified) and `2>`/`1>`/`&>` to `/dev/null`. Every
 * other redirect target and `&&`/`||`/`&` stay hard-blocked exactly as
 * before; the per-tool classification is looser on top of that.
 */
export function isPlanModeDiagnosticCommand(
  command: string,
  cwd: string,
): boolean {
  if (containsUnquotedVariableExpansion(command)) return false;
  const parsed = parseReadOnlyShell(command, {
    allowSemicolonChaining: true,
    allowDevNullRedirect: true,
  });
  return (
    !parsed.error &&
    parsed.segments.every((tokens) => isPlanModeDiagnosticSegment(tokens, cwd))
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

const OPAQUE_INTERPRETERS = new Set([
  "bash",
  "dash",
  "deno",
  "ksh",
  "lua",
  "node",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
  "sh",
  "zsh",
]);

function executableToken(tokens: string[]): {
  executable: string;
  args: string[];
} {
  let index = 0;
  while (
    index < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])
  ) {
    index += 1;
  }
  if (tokens[index] === "env") {
    index += 1;
    while (
      index < tokens.length &&
      (tokens[index].startsWith("-") ||
        /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index]))
    ) {
      index += 1;
    }
  }
  return {
    executable: tokens[index]?.split("/").pop()?.toLowerCase() ?? "",
    args: tokens.slice(index + 1),
  };
}

function opaqueInterpreter(command: string): string | undefined {
  const parsed = parseReadOnlyShell(command);
  if (parsed.error) return undefined;
  for (const tokens of parsed.segments) {
    const { executable, args } = executableToken(tokens);
    if (
      OPAQUE_INTERPRETERS.has(executable) &&
      !(args.length === 1 && ["-v", "-V", "--version"].includes(args[0]))
    ) {
      return executable;
    }
  }
  return undefined;
}

export function decideBash(
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
): PolicyDecision {
  const trimmed = command.trim();
  if (!trimmed) return deny("Leeres Bash-Kommando.");

  if (permissionLevel === "readonly") {
    return isPlanSafeCommand(trimmed, cwd)
      ? ALLOW
      : deny(
          "Readonly: Das Kommando ist nicht nachweislich rein inspizierend.",
        );
  }

  if (isSensitiveReference(trimmed)) {
    return permissionLevel === "yolo"
      ? deny("Harte Secret-Grenze: Shell-Zugriff wurde blockiert.")
      : ask("Zugriff auf Secrets, Tokens, Credentials oder SSH-Keys", true);
  }

  for (const [pattern, reason] of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return permissionLevel === "yolo"
        ? deny(`Harte Systemgrenze: ${reason}`)
        : ask(reason, true);
    }
  }
  if (
    referencesSystemPath(trimmed) &&
    (/\b(?:rm|mv|cp|mkdir|touch|tee|truncate|dd|chmod|chown|chgrp|ln|sed)\b/i.test(
      trimmed,
    ) ||
      /(?:^|[^<])>(?!>)/.test(trimmed) ||
      />>/.test(trimmed))
  ) {
    return permissionLevel === "yolo"
      ? deny("Harte Systemgrenze: Änderung am Systempfad wurde blockiert.")
      : ask("Änderung an einem Systempfad", true);
  }

  if (permissionLevel === "confirm-all") {
    if (isPlanSafeCommand(trimmed, cwd)) return ALLOW;
    return ask(
      isWriteCapableCommand(trimmed)
        ? "Shell-Mutation benötigt Bestätigung"
        : "Nicht rein inspizierender oder externer Shell-Aufruf benötigt Bestätigung",
    );
  }
  if (permissionLevel === "yolo") {
    if (containsUnquotedVariableExpansion(trimmed)) {
      return deny(
        "Harte Projektgrenze: eine unquotierte Shell-Variable kann außerhalb des Projekts auflösen.",
      );
    }
    if (/\b(?:sudo|su)\b/i.test(trimmed)) {
      return deny(
        "Harte Systemgrenze: erhöhte Rechte sind auch in YOLO blockiert.",
      );
    }
    if (
      /\b(?:apt|apt-get|dnf|yum|pacman|zypper|brew)\s+(?:install|remove|purge|update|upgrade)\b/i.test(
        trimmed,
      )
    ) {
      return deny("Harte Systemgrenze: System-Paketoperation wurde blockiert.");
    }
    const interpreter = opaqueInterpreter(trimmed);
    if (interpreter) {
      return deny(
        `Harte System-/Secret-Grenze: opaker Interpreteraufruf (${interpreter}) wurde blockiert.`,
      );
    }
    if (likelyExternalWrite(trimmed, cwd)) {
      return deny(
        "Harte Projektgrenze: externe Shell-Änderung wurde blockiert.",
      );
    }
    return {
      action: "allow",
      reason: "Temporärer YOLO-Bypass innerhalb harter Grenzen",
    };
  }

  for (const [pattern, reason] of SENSITIVE_ASK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return ask(reason);
    }
  }
  for (const [pattern, reason] of ROUTINE_ASK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return ask(reason);
    }
  }
  if (containsUnquotedVariableExpansion(trimmed)) {
    return ask(
      "Eine unquotierte Shell-Variable kann außerhalb des Projekts auflösen",
    );
  }
  if (likelyExternalWrite(trimmed, cwd)) {
    return ask("Bash-Änderung außerhalb des aktuellen Projekts");
  }
  return ALLOW;
}
