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
const YOLO_FULL_ALLOW: PolicyDecision = {
  action: "allow",
  reason: "YOLO 3: Vollzugriff ohne Rückfrage",
};

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

const ROOT_WIPE_REASON = "Löschen des Root-Dateisystems";

const CRITICAL_BASH_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\b[^;&|]*(?:^|\s)["']?\/(?:[/.])*["']?(?=\s|$)/i, ROOT_WIPE_REASON],
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

// Named separately (not just inlined in ROUTINE_ASK_PATTERNS) so the
// headless branch of decideBash can carve out a narrow, positively-listed
// exception for it without touching every other routine-ask pattern.
const NPX_LIKE_PATTERN = /\bnpm\s+exec\b|\bnpx\b/i;

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
  [NPX_LIKE_PATTERN, "npm-Paketausführung mit möglichem Download"],
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

// Phase 2.3 (headless permissions): well-known local dev-tooling binaries.
// `npx <binary>` / `npm exec <binary>` normally needs confirmation (it CAN
// silently fetch and run an arbitrary, not-yet-installed package), but a
// headless benchmark/CI run routinely self-verifies via exactly
// `npx vitest run <file>` or `npx tsc --noEmit` with no confirm channel
// available. Narrow, explicit allowlist rather than trusting any binary name.
const HEADLESS_TRUSTED_DEV_BINARIES = new Set([
  "vitest",
  "jest",
  "tsc",
  "eslint",
  "prettier",
  "playwright",
  "vite",
  "biome",
  "stylelint",
  "tsx",
  "ts-node",
  "mocha",
  "ava",
  "knip",
]);

// A single simple command only - no chaining, substitution or piping. The
// npx carve-out below must never approve more than the one recognized
// invocation; a chained tail (`npx vitest && rm important-file`) still has
// to run the full ROUTINE_ASK_PATTERNS/SENSITIVE_ASK_PATTERNS scan over the
// whole string, which only happens for commands this rejects here.
const SHELL_CHAIN_PATTERN = /[;&|`]|\$\(/;

function isHeadlessTrustedNpxInvocation(command: string): boolean {
  if (SHELL_CHAIN_PATTERN.test(command)) return false;
  // `npm exec -- <bin>` (the `--` separates npm's own flags from the
  // executed command's, a common and documented npm idiom) was observed to
  // fall through this check entirely in a real headless trial (disa-hard-05,
  // `npm exec -- tsx -e '...'`): the bare npm-exec pattern captured "--"
  // itself as the "binary" name instead of skipping past it to "tsx".
  const match =
    /^\s*npx\s+([\w@/.-]+)/i.exec(command) ??
    /^\s*npm\s+exec\s+(?:--\s+)?([\w@/.-]+)/i.exec(command);
  const binary = match?.[1];
  return binary !== undefined && HEADLESS_TRUSTED_DEV_BINARIES.has(binary);
}

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
// `rg` is bundled by the host in some supported installations rather than
// living below a system bin directory. Keep the exact runtime-resolved path
// captured at module load as an explicit exception; a later PATH replacement
// (including an external wrapper) is not accepted. No other diagnostic name
// receives this external-runtime exception.
const TRUSTED_EXTERNAL_DIAGNOSTIC_NAMES = new Set(["rg"]);
const TRUSTED_EXTERNAL_DIAGNOSTIC_PATHS = new Set<string>();

for (const name of TRUSTED_EXTERNAL_DIAGNOSTIC_NAMES) {
  for (const rawEntry of (process.env.PATH ?? "").split(delimiter)) {
    const entry = rawEntry ? resolve(rawEntry) : resolve(process.cwd());
    const candidate = resolve(entry, name);
    try {
      const canonical = realpathSync(candidate);
      if (!statSync(canonical).isFile()) continue;
      accessSync(canonical, constants.X_OK);
      if (!isInside(resolve(process.cwd()), canonical)) {
        TRUSTED_EXTERNAL_DIAGNOSTIC_PATHS.add(canonical);
        break;
      }
    } catch {
      // Continue to the next PATH entry.
    }
  }
}

function deny(reason: string): PolicyDecision {
  return { action: "block", reason };
}

function ask(reason: string, hard = false): PolicyDecision {
  return { action: "ask", reason, hard };
}

/**
 * A symlink only escapes the project when its fully resolved real target
 * does. Flagging any symlink component regardless of target (the previous
 * behaviour here) treated every ordinary `node_modules/.bin/<tool>`
 * invocation as an escape, since npm always links `.bin/*` — ubiquitous and
 * project-internal, not an escape. This walks the path segment by segment,
 * following each symlink to its real target so only a symlink target that
 * actually leaves the base counts. A plain path outside the base is not
 * itself a symlink escape; the caller handles the ordinary project boundary
 * separately. A component that does not exist yet (a file about to be
 * created) is appended literally. A broken symlink cannot be verified as
 * staying inside the base, so it fails closed (escape).
 */
function hasSymlinkComponent(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  if (rel === "" || rel === ".") return false;

  let realBase: string;
  try {
    realBase = realpathSync(basePath);
  } catch {
    realBase = basePath;
  }

  let current = realBase;
  for (const segment of rel.split(sep).filter(Boolean)) {
    const next = resolve(current, segment);
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(next);
    } catch {
      current = next;
      continue;
    }
    if (stat.isSymbolicLink()) {
      try {
        current = realpathSync(next);
      } catch {
        return true;
      }
      if (!isInside(realBase, current)) return true;
      continue;
    }
    current = next;
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
    symlinkEscape: hasSymlinkComponent(root, absolutePath),
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
  /** Set only when workflow-policy has approved a documented external read. */
  allowOutsideProjectRead?: boolean;
}

export function decideFileAccess(
  permissionLevel: PermissionLevel,
  operation: FileOperation,
  rawPath: string,
  cwd: string,
  options: DecideFileAccessOptions = {},
): PolicyDecision {
  const { protectedWritePath, allowOutsideProjectRead = false } = options;
  const scope = resolvePathScope(rawPath, cwd);
  const isReadRestricted = permissionLevel === "readonly";

  // YOLO 3 hebt die Pfadgrenzen vollständig auf (Secrets, außerhalb des
  // Projekts, Symlink-Escape, Ausführungspfade). Trust-Grenze und Plan-Mode
  // entscheiden vorher in guards.ts/workflow-policy.ts.
  if (permissionLevel === "yolo-full") return YOLO_FULL_ALLOW;

  if (
    isSensitiveReference(rawPath) ||
    isSensitiveReference(scope.absolutePath)
  ) {
    return isReadRestricted ||
      permissionLevel === "yolo" ||
      permissionLevel === "headless"
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
    if (
      (!scope.insideProject || scope.symlinkEscape) &&
      !allowOutsideProjectRead
    ) {
      return deny(
        "Diese Zugriffsstufe blockiert Lesezugriff außerhalb des Projekts.",
      );
    }
    return ALLOW;
  }

  // YOLO 2: workflow-policy lets files outside the project or behind a
  // symlink escape through, so this layer asks instead of the hard block.
  if (
    permissionLevel === "yolo-ask" &&
    (!scope.insideProject || scope.symlinkEscape)
  ) {
    return ask(
      `Dateizugriff außerhalb des Projekts oder über einen Symlink: ${scope.absolutePath}`,
      true,
    );
  }

  // Project, system and symlink boundaries are owned by workflow-policy and
  // have already been checked by guards.ts. This layer handles only the
  // permission level once that hard boundary has passed.
  if (
    operation === "write" &&
    isProtectedProjectPath(scope.absolutePath, cwd)
  ) {
    return permissionLevel === "yolo" || permissionLevel === "headless"
      ? deny(
          permissionLevel === "headless"
            ? `Änderung an einem Ausführungspfad im Projekt benötigt eine Bestätigung, die im Headless-Modus nicht verfügbar ist: ${scope.absolutePath}`
            : "Harte Grenze: Ausführungspfad im Projekt wurde in YOLO blockiert.",
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

/**
 * Conservative parser for Plan Mode and readonly permissions. It accepts one
 * plain command only and rejects shell constructs whose effects cannot be
 * proven read-only. In particular, pipelines are not a safe composition
 * primitive: every command in a pipeline would need an independent process
 * and argument proof, so callers must issue separate diagnostic commands.
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
      return { segments: [], error: "Shell-Verkettungen sind nicht erlaubt." };
    }
    if (char === "&") {
      return { segments: [], error: "Shell-Verkettungen sind nicht erlaubt." };
    }
    if (char === "<") {
      return { segments: [], error: "Shell-Redirections sind nicht erlaubt." };
    }
    if (char === ">") {
      return { segments: [], error: "Shell-Redirections sind nicht erlaubt." };
    }
    if (char === "|") {
      return { segments: [], error: "Shell-Pipelines sind nicht erlaubt." };
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
    const inTrustedRoot = TRUSTED_EXECUTABLE_ROOTS.some((root) =>
      isInside(root, canonical),
    );
    const name = canonical.split(sep).pop()?.toLowerCase();
    const runtimeDiagnostic =
      !rawExecutable.includes("/") &&
      !rawExecutable.includes("\\") &&
      name !== undefined &&
      TRUSTED_EXTERNAL_DIAGNOSTIC_NAMES.has(name) &&
      TRUSTED_EXTERNAL_DIAGNOSTIC_PATHS.has(canonical) &&
      !isInside(resolve(cwd), canonical);
    if (!inTrustedRoot && !runtimeDiagnostic) {
      return undefined;
    }
    return name;
  } catch {
    return undefined;
  }
}

function hasForbiddenGitOption(tokens: string[]): boolean {
  return tokens
    .slice(1)
    .some(
      (token) =>
        token === "-C" ||
        token.startsWith("-C") ||
        token === "-c" ||
        token.startsWith("-c") ||
        token === "-o" ||
        token.startsWith("-o") ||
        /^--(?:output|ext-diff|textconv|pager|paginate|config(?:-env)?|git-dir|work-tree|exec-path|namespace|super-prefix|show-signature)(?:=|$)/i.test(
          token,
        ),
    );
}

function isSafeGitStatusArgs(args: string[]): boolean {
  const safeFlags = new Set([
    "-b",
    "-s",
    "--branch",
    "--porcelain",
    "--porcelain=v1",
    "--porcelain=v2",
    "--short",
    "--untracked-files",
    "-u",
    "-uno",
    "-unormal",
    "-uall",
  ]);
  const safeValues = /^(?:--untracked-files=(?:no|normal|all))$/i;
  let pathspecs = false;
  for (const arg of args) {
    if (arg === "--") {
      pathspecs = true;
      continue;
    }
    if (pathspecs) continue;
    if (safeFlags.has(arg) || safeValues.test(arg)) continue;
    return false;
  }
  return true;
}

function isSafeGitDiffArgs(args: string[], pagerDisabled: boolean): boolean {
  if (!pagerDisabled) return false;
  const safeFlags = new Set([
    "--cached",
    "--color=never",
    "--name-only",
    "--name-status",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--numstat",
    "--shortstat",
    "--staged",
    "--stat",
    "--summary",
  ]);
  let pathspecs = false;
  let hasNoExtDiff = false;
  let hasNoTextconv = false;
  for (const arg of args) {
    if (arg === "--") {
      pathspecs = true;
      continue;
    }
    if (pathspecs) continue;
    if (arg === "--no-ext-diff") hasNoExtDiff = true;
    if (arg === "--no-textconv") hasNoTextconv = true;
    if (safeFlags.has(arg)) continue;
    return false;
  }
  return hasNoExtDiff && hasNoTextconv;
}

function isSafeGitLogArgs(args: string[], pagerDisabled: boolean): boolean {
  if (!pagerDisabled) return false;
  const safeFlags = new Set([
    "--all",
    "--color=never",
    "--decorate",
    "--no-color",
    "--no-decorate",
    "--oneline",
  ]);
  let pathspecs = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      pathspecs = true;
      continue;
    }
    if (pathspecs) continue;
    if (/^-\d+$/.test(arg)) continue;
    if (arg === "-n") {
      const count = args[index + 1];
      if (!/^\d+$/.test(count ?? "")) return false;
      index += 1;
      continue;
    }
    if (/^--max-count=\d+$/i.test(arg)) continue;
    if (/^--decorate=(?:auto|short|full|no)$/i.test(arg)) continue;
    if (safeFlags.has(arg)) continue;
    return false;
  }
  return true;
}

function isSafeGit(tokens: string[]): boolean {
  let subcommandIndex = 1;
  let pagerDisabled = false;
  if (tokens[subcommandIndex] === "--no-pager") {
    pagerDisabled = true;
    subcommandIndex += 1;
  }

  const subcommand = tokens[subcommandIndex]?.toLowerCase();
  if (!subcommand) return false;
  const args = tokens.slice(subcommandIndex + 1);
  if (hasForbiddenGitOption(tokens)) return false;
  if (tokens.slice(1, subcommandIndex).some((arg) => arg !== "--no-pager"))
    return false;

  switch (subcommand) {
    case "status":
      return isSafeGitStatusArgs(args);
    case "log":
      return isSafeGitLogArgs(args, tokens[1] === "--no-pager");
    case "diff":
      return isSafeGitDiffArgs(args, tokens[1] === "--no-pager");
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
 * Per-tool classification shared by the readonly and Plan/Recovery paths.
 * Both callers resolve the executable through trustedExecutableName before
 * reaching this function, so a local replacement cannot become a diagnostic
 * merely by sharing a basename with a system tool.
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

function isSafePlanSegment(tokens: string[], cwd: string): boolean {
  const executable = trustedExecutableName(tokens[0], cwd);
  if (!executable) return false;
  if (tokens.some((token) => isSensitiveReference(token))) return false;
  if (containsExternalPath(tokens, cwd)) return false;
  if (executable === "sed") return isSafeSed(tokens);
  if (executable === "git") return isSafeGit(tokens);
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
    parsed.segments.every((tokens) => isSafePlanSegment(tokens, cwd))
  );
}

// Plan Mode deliberately has a small, direct git allowlist. These commands
// only inspect repository state and never run a project-defined script.
const PLAN_MODE_SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log"]);

// Read-only tools already vetted as flag-safe by classifyToolSegment (via
// PLAN_SIMPLE_COMMANDS or find's dedicated branch). Unlike npm/pnpm/yarn
// scripts, none of these depend on project content to decide whether they
// mutate anything; the executable itself is still resolved through the shared
// trust check before this list is consulted.
const PLAN_MODE_DIAGNOSTIC_TOOLS = new Set([
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "du",
  "df",
  "tree",
  "sort",
  "uniq",
]);

function isPlanModeSafeGitCommand(tokens: string[]): boolean {
  const subcommandIndex = tokens[1] === "--no-pager" ? 2 : 1;
  const subcommand = tokens[subcommandIndex]?.toLowerCase();
  if (!subcommand) return false;
  return PLAN_MODE_SAFE_GIT_SUBCOMMANDS.has(subcommand) && isSafeGit(tokens);
}

/**
 * Per-segment classification for Plan Mode's bash guard. Do not trust a
 * command because its name sounds diagnostic: project scripts can mutate.
 */
function isPlanModeDiagnosticSegment(tokens: string[], cwd: string): boolean {
  const executable = trustedExecutableName(tokens[0], cwd);
  if (!executable) return false;
  if (tokens.some((token) => isSensitiveReference(token))) return false;
  if (containsExternalPath(tokens, cwd)) return false;

  if (executable === "git") {
    return isPlanModeSafeGitCommand(tokens);
  }
  if (executable === "rg" || executable === "find") {
    return classifyToolSegment(executable, tokens);
  }
  if (PLAN_MODE_DIAGNOSTIC_TOOLS.has(executable)) {
    return classifyToolSegment(executable, tokens);
  }
  return false;
}

/**
 * Is this bash command safe to run while Plan Mode is active? Only the
 * explicit Git inspection commands, ripgrep, and a small set of read-only,
 * non-script system tools (PLAN_MODE_DIAGNOSTIC_TOOLS, `find`) pass. The
 * executable must resolve to a trusted system binary; project scripts and
 * local replacements are never trusted merely because they sound like checks.
 */
export function isPlanModeDiagnosticCommand(
  command: string,
  cwd: string,
): boolean {
  if (containsUnquotedVariableExpansion(command)) return false;
  const parsed = parseReadOnlyShell(command);
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

/**
 * `;`/`2>`-etc. make `parseReadOnlyShell` reject the command outright (see
 * its strict default), so this fallback re-tokenizes the raw text instead of
 * giving up. Redirects to `/dev/null` must be stripped whole (operator +
 * target), not just the operator: leaving `/dev/null` behind as a bare token
 * makes it look like a reference to a path outside the project and trips
 * `containsExternalPath` on the extremely common `cmd 2>/dev/null` idiom,
 * even though nothing is actually written there. Redirects to any other
 * target keep their target token so a real external write still gets
 * caught.
 */
const DEV_NULL_REDIRECT_TOKEN = /\d*(?:>>?|<<?)\s*\/dev\/null\b/g;
const BARE_REDIRECT_OPERATOR = /\d*(?:>>?|<<?)/g;

function likelyExternalWrite(command: string, cwd: string): boolean {
  const parsed = parseReadOnlyShell(command);
  const tokens = parsed.error
    ? command
        .replace(DEV_NULL_REDIRECT_TOKEN, " ")
        .replace(BARE_REDIRECT_OPERATOR, " ")
        .split(/\s+/)
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

function opaqueInterpreterInvocations(
  command: string,
): Array<{ executable: string; args: string[] }> {
  const parsed = parseReadOnlyShell(command);
  if (parsed.error) return [];
  return parsed.segments.flatMap((tokens) => {
    const { executable, args } = executableToken(tokens);
    if (
      !OPAQUE_INTERPRETERS.has(executable) ||
      (args.length === 1 && ["-v", "-V", "--version"].includes(args[0]))
    ) {
      return [];
    }
    return [{ executable, args }];
  });
}

function opaqueInterpreter(command: string): string | undefined {
  return opaqueInterpreterInvocations(command)[0]?.executable;
}

/**
 * F-06 chooses the targeted project-write policy: inline/stdin code and
 * explicitly external interpreter scripts need confirmation, while a literal
 * project-internal script path remains ordinary project work. This is
 * deliberately only a command-shape check. It does not inspect or sandbox the
 * script body; a confirmed or project-internal script can still perform any
 * operation available to the process.
 */
const INLINE_INTERPRETER_FLAGS = new Set([
  "-c",
  "--command",
  "-e",
  "--eval",
  "-p",
  "--print",
  "-r",
]);
const INTERPRETER_PATH_OPTIONS = new Set([
  "-I",
  "-f",
  "--file",
  "--import",
  "--include",
  "--loader",
  "--preload",
  "--require",
]);
const SHELL_INTERPRETERS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);
const REDIRECTED_STDIN_INTERPRETER =
  /(?:^|[|;&\n])\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)(?:env\s+)?(?:\S+\/)?(bash|dash|deno|ksh|lua|node|perl|php|python|python3|ruby|sh|zsh)\b[^|;&\n]*<(?!=)/i;
const PIPE_INTERPRETER =
  /(?:^|[|;&\n])\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)(?:env\s+)?(?:\S+\/)?(bash|dash|deno|ksh|lua|node|perl|php|python|python3|ruby|sh|zsh)\b(?=\s|$)/i;

function isInlineInterpreter(executable: string, args: string[]): boolean {
  if (executable === "deno" && args[0]?.toLowerCase() === "eval") return true;
  return args.some(
    (arg) =>
      INLINE_INTERPRETER_FLAGS.has(arg) ||
      /^(?:--(?:command|eval|print)=)/i.test(arg) ||
      (SHELL_INTERPRETERS.has(executable) && /^-[^-]*c/i.test(arg)),
  );
}

function isStdinInterpreter(args: string[]): boolean {
  return (
    args.length === 0 ||
    args.includes("-") ||
    args.every((arg) => arg.startsWith("-"))
  );
}

function interpreterPathArguments(args: string[]): string[] {
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-") continue;
    if (arg === "--") {
      paths.push(...args.slice(index + 1).filter((value) => value !== "-"));
      break;
    }
    if (!arg.startsWith("-")) {
      paths.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const option = equals > 0 ? arg.slice(0, equals) : arg;
    if (equals > 0 && INTERPRETER_PATH_OPTIONS.has(option)) {
      paths.push(arg.slice(equals + 1));
    } else if (
      INTERPRETER_PATH_OPTIONS.has(option) &&
      args[index + 1] !== undefined
    ) {
      paths.push(args[index + 1]);
      index += 1;
    }
  }
  return paths;
}

function isProjectInternalInterpreterPath(value: string, cwd: string): boolean {
  if (
    value === "-" ||
    value === "~" ||
    value.startsWith("~/") ||
    value.includes("://")
  ) {
    return value === "-";
  }
  const scope = resolvePathScope(value, cwd);
  return scope.insideProject && !scope.symlinkEscape;
}

function projectWriteInterpreter(
  command: string,
  cwd: string,
): string | undefined {
  const invocations = opaqueInterpreterInvocations(command);
  for (const { executable, args } of invocations) {
    if (isInlineInterpreter(executable, args) || isStdinInterpreter(args)) {
      return executable;
    }
    if (
      interpreterPathArguments(args).some(
        (value) => !isProjectInternalInterpreterPath(value, cwd),
      )
    ) {
      return executable;
    }
  }
  if (!parseReadOnlyShell(command).error) return undefined;
  // parseReadOnlyShell intentionally rejects redirections. Still identify the
  // common `python < script.py`/heredoc shape as stdin code instead of letting
  // it fall through to project-write's unconditional allow.
  return (
    REDIRECTED_STDIN_INTERPRETER.exec(command)?.[1]?.toLowerCase() ??
    PIPE_INTERPRETER.exec(command)?.[1]?.toLowerCase()
  );
}

/**
 * The first hard shell boundary a command touches, in the same order YOLO 1
 * checks them. YOLO 1 denies each of these outright; YOLO 2 asks instead
 * (YOLO 3 lifts them, see decideExtendedYoloBash).
 */
function extendedYoloBoundary(
  command: string,
  cwd: string,
): string | undefined {
  if (isSensitiveReference(command)) {
    return "Zugriff auf Secrets, Tokens, Credentials oder SSH-Keys";
  }
  for (const [pattern, reason] of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  if (
    referencesSystemPath(command) &&
    (/\b(?:rm|mv|cp|mkdir|touch|tee|truncate|dd|chmod|chown|chgrp|ln|sed)\b/i.test(
      command,
    ) ||
      /(?:^|[^<])>(?!>)/.test(command) ||
      />>/.test(command))
  ) {
    return "Änderung an einem Systempfad";
  }
  if (containsUnquotedVariableExpansion(command)) {
    return "Eine unquotierte Shell-Variable kann außerhalb des Projekts auflösen";
  }
  if (/\b(?:sudo|su)\b/i.test(command)) {
    return "Ausführung mit erhöhten Rechten";
  }
  if (
    /\b(?:apt|apt-get|dnf|yum|pacman|zypper|brew)\s+(?:install|remove|purge|update|upgrade)\b/i.test(
      command,
    )
  ) {
    return "System-Paketoperation";
  }
  const interpreter =
    opaqueInterpreter(command) ?? projectWriteInterpreter(command, cwd);
  if (interpreter) {
    return `Opaker Interpreteraufruf (${interpreter}) - Inline-/stdin-Code oder ein externes Skript`;
  }
  if (likelyExternalWrite(command, cwd)) {
    return "Bash-Änderung außerhalb des aktuellen Projekts";
  }
  return undefined;
}

/**
 * YOLO 2 and 3 share YOLO 1's "no routine confirmations" behaviour and differ
 * only in what happens at a hard boundary: YOLO 2 asks (dangerous styling),
 * YOLO 3 allows. The single exception is wiping the root filesystem, which
 * even YOLO 3 confirms — no legitimate workflow is lost by that one dialog.
 */
function decideExtendedYoloBash(
  permissionLevel: "yolo-ask" | "yolo-full",
  command: string,
  cwd: string,
): PolicyDecision {
  // Checked independently of the first boundary hit, so a root wipe cannot
  // hide behind an earlier match such as `cat ~/.ssh/id_rsa; rm -rf /`.
  if (CRITICAL_BASH_PATTERNS[0][0].test(command)) {
    return ask(ROOT_WIPE_REASON, true);
  }
  if (permissionLevel === "yolo-full") return YOLO_FULL_ALLOW;
  const boundary = extendedYoloBoundary(command, cwd);
  return boundary
    ? ask(boundary, true)
    : {
        action: "allow",
        reason: "Temporärer YOLO-Bypass innerhalb der Grenzen",
      };
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

  if (permissionLevel === "yolo-ask" || permissionLevel === "yolo-full") {
    return decideExtendedYoloBash(permissionLevel, trimmed, cwd);
  }

  // headless has no confirm channel at all, so it hard-denies exactly where
  // yolo does (same branch condition) instead of asking - the class of risk
  // is identical, only the reachable outcomes differ (bypass vs. no dialog).
  const noConfirmChannel =
    permissionLevel === "yolo" || permissionLevel === "headless";

  if (isSensitiveReference(trimmed)) {
    return noConfirmChannel
      ? deny("Harte Secret-Grenze: Shell-Zugriff wurde blockiert.")
      : ask("Zugriff auf Secrets, Tokens, Credentials oder SSH-Keys", true);
  }

  for (const [pattern, reason] of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return noConfirmChannel
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
    return noConfirmChannel
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
    // The structural shell parser intentionally rejects redirections. Reuse
    // the targeted fallback so YOLO cannot bypass the opaque-interpreter hard
    // boundary with `python3 < script.py` or a heredoc-shaped invocation.
    const interpreter =
      opaqueInterpreter(trimmed) ?? projectWriteInterpreter(trimmed, cwd);
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

  if (permissionLevel === "headless") {
    // No confirm channel exists at all - every case that would otherwise
    // `ask()` under project-write resolves to a structured `deny()` instead
    // (Phase 2.3: "Aktionen, die weiterhin Freigabe benötigen, müssen mit
    // einem strukturierten Fehler abbrechen"), except the one narrow,
    // positively-listed carve-out for a project-local dev-tooling `npx`/
    // `npm exec` invocation. Plain `npm run <script>` needs no carve-out: it
    // already reaches the unconditional ALLOW at the end of this function,
    // the same as it does under project-write.
    const noConfirmReason = (base: string) =>
      `${base}: benötigt eine Bestätigung, die im Headless-Modus nicht verfügbar ist.`;
    for (const [pattern, reason] of SENSITIVE_ASK_PATTERNS) {
      if (pattern.test(trimmed)) return deny(noConfirmReason(reason));
    }
    for (const [pattern, reason] of ROUTINE_ASK_PATTERNS) {
      if (!pattern.test(trimmed)) continue;
      if (
        pattern === NPX_LIKE_PATTERN &&
        isHeadlessTrustedNpxInvocation(trimmed)
      ) {
        continue;
      }
      return deny(noConfirmReason(reason));
    }
    if (containsUnquotedVariableExpansion(trimmed)) {
      return deny(
        noConfirmReason(
          "Eine unquotierte Shell-Variable kann außerhalb des Projekts auflösen",
        ),
      );
    }
    if (likelyExternalWrite(trimmed, cwd)) {
      return deny(
        noConfirmReason("Bash-Änderung außerhalb des aktuellen Projekts"),
      );
    }
    const interpreter = projectWriteInterpreter(trimmed, cwd);
    if (interpreter) {
      return deny(
        noConfirmReason(
          `Opaker Interpreteraufruf (${interpreter}) - Inline-/stdin-Code oder ein externes Skript`,
        ),
      );
    }
    return ALLOW;
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
  const interpreter = projectWriteInterpreter(trimmed, cwd);
  if (interpreter) {
    return ask(
      `Opaker Interpreteraufruf (${interpreter}) benötigt Bestätigung: ` +
        `Inline-/stdin-Code oder ein externes Skript wird nicht still ausgeführt.`,
    );
  }
  return ALLOW;
}
