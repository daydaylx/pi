import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { isInside } from "./path-utils.ts";
import type { PermissionLevel } from "./workflow-status.ts";

export type PolicyAction = "allow" | "ask" | "block";
export type FileOperation = "read" | "write";
export type OperationEffect = "SAFE" | "MUTATING" | "RISKY" | "FORBIDDEN";

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

// Secret-Dateinamen werden anhand typischer Dotfiles bzw. Daten-/Key-Dateien
// erkannt. Bloße Suchbegriffe wie `token` oder Quellcode-Module wie auth.ts und
// tokenizer.ts lösen keine Credential-Grenze aus.
const SECRET_DATA_EXTENSIONS = "json|ya?ml|toml|ini|env|pem|key|p12|pfx";
const SECRET_PATH_PATTERN = new RegExp(
  "(^|[\\s/\\\\])(?:\\.env(?:\\.[^\\s/\\\\]+)?|\\.ssh|\\.gnupg|\\.aws|\\.npmrc|\\.pypirc|\\.netrc|" +
    `\\.(?:auth|credentials?|secrets?|tokens?)|(?:auth|credentials?|secrets?|tokens?)\\.(?:${SECRET_DATA_EXTENSIONS})|(?:credentials?|secrets?|tokens?)\\.[^\\s/\\\\]+` +
    "|id_rsa|id_ed25519|[^\\s/\\\\]+\\.(?:pem|key|p12|pfx))(?:[\\s/\\\\]|$)",
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

/**
 * Executable trust has three independent steps (see
 * extensions/plan-mode/README.md, "Executable-Vertrauen"):
 *
 *   1. Discovery  - which file would the shell run? The first PATH hit wins;
 *      a later, trusted hit is never used as a fallback.
 *   2. Source     - was it found through a system location?
 *      - classic system dirs (/usr/bin, /bin, ...): the canonical target must
 *        stay inside those dirs.
 *      - system profile dirs (NixOS /run/current-system/sw/bin, multi-user
 *        /nix/var/nix/profiles/default/bin): the entry was found through the
 *        profile AND the profile dir and the target both resolve into the Nix
 *        store. A store path alone proves nothing (the store is group-writable
 *        by the build users and holds user-profile and project closures too),
 *        so an entry reached through ~/.nix-profile, a project dir or a direct
 *        /nix/store/... path stays untrusted.
 *   3. Target     - regular, executable file after realpath.
 *
 * The policy is a value so tests can model a NixOS layout in a temp dir.
 */
export interface ExecutableTrustPolicy {
  /** Canonical (realpath) roots a classic system executable must stay in. */
  readonly classicRoots: readonly string[];
  /** Lexical discovery dirs of system profiles (symlink farms into a store). */
  readonly systemProfileBinDirs: readonly string[];
  /** Canonical roots a system profile dir and its entries must resolve into. */
  readonly systemProfileTargetRoots: readonly string[];
  /** Exact canonical paths of host-bundled diagnostic tools, by basename. */
  readonly runtimeDiagnosticNames: ReadonlySet<string>;
  readonly runtimeDiagnosticPaths: ReadonlySet<string>;
}

export type ExecutableTrustSource =
  "shell-builtin" | "classic-system" | "system-profile" | "runtime-diagnostic";

export type ExecutableTrustFailure =
  /** Bare name without any (executable) PATH hit. */
  | "not-found"
  /** `./ls`, `bin/ls`, ...: relative path-qualified executables. */
  | "relative-path"
  /** Found, but not via a system location (project dir, user profile, bare store path). */
  | "untrusted-source"
  /** Found via a system location, but the target is not a regular executable file. */
  | "invalid-target";

export type ExecutableTrust =
  | {
      trusted: true;
      /** Tool name used for classification (see resolveExecutableTrust). */
      name: string;
      source: ExecutableTrustSource;
    }
  | {
      trusted: false;
      reason: ExecutableTrustFailure;
      executable: string;
      /** First PATH hit / absolute path, when one was found. */
      path?: string;
    };

function canonicalOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

export function createExecutableTrustPolicy(options: {
  classicBinDirs: readonly string[];
  systemProfileBinDirs: readonly string[];
  systemProfileTargetRoots: readonly string[];
  runtimeDiagnosticNames?: readonly string[];
  /** Binaries of the host process itself (process.execPath): already running our code. */
  hostRuntimePaths?: readonly string[];
  /** PATH used to capture the host-bundled diagnostic tools (default: process.env.PATH). */
  path?: string;
  cwd?: string;
}): ExecutableTrustPolicy {
  const canonicalRoots = (paths: readonly string[]) =>
    paths.flatMap((path) => {
      const canonical = canonicalOrUndefined(path);
      return canonical ? [canonical] : [];
    });
  const runtimeDiagnosticNames = new Set(options.runtimeDiagnosticNames ?? []);
  const runtimeDiagnosticPaths = new Set<string>();
  const cwd = resolve(options.cwd ?? process.cwd());
  for (const name of runtimeDiagnosticNames) {
    for (const rawEntry of (options.path ?? process.env.PATH ?? "").split(
      delimiter,
    )) {
      const entry = resolve(cwd, rawEntry);
      try {
        const canonical = realpathSync(resolve(entry, name));
        if (!statSync(canonical).isFile()) continue;
        accessSync(canonical, constants.X_OK);
        if (!isInside(cwd, canonical)) {
          runtimeDiagnosticPaths.add(canonical);
          break;
        }
      } catch {
        // Continue to the next PATH entry.
      }
    }
  }
  for (const canonical of canonicalRoots(options.hostRuntimePaths ?? [])) {
    runtimeDiagnosticNames.add(basename(canonical).toLowerCase());
    runtimeDiagnosticPaths.add(canonical);
  }
  return {
    classicRoots: canonicalRoots(options.classicBinDirs),
    systemProfileBinDirs: options.systemProfileBinDirs.map((dir) =>
      resolve(dir),
    ),
    systemProfileTargetRoots: canonicalRoots(options.systemProfileTargetRoots),
    runtimeDiagnosticNames,
    runtimeDiagnosticPaths,
  };
}

// `rg` is bundled by the host in some supported installations rather than
// living below a system bin directory. The exact runtime-resolved path is
// captured at module load as an explicit exception; a later PATH replacement
// (including an external wrapper) is not accepted. The same holds for the
// Node runtime hosting this process, so `node --version` works when Node is
// installed in a user directory. No other name receives this exception.
const DEFAULT_EXECUTABLE_TRUST_POLICY = createExecutableTrustPolicy({
  classicBinDirs: ["/usr/bin", "/bin", "/usr/sbin", "/sbin"],
  systemProfileBinDirs: [
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
  ],
  systemProfileTargetRoots: ["/nix/store"],
  runtimeDiagnosticNames: ["rg"],
  hostRuntimePaths: [process.execPath],
});

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

export type PathScope = "project" | "external" | "unresolved";
export type PathTargetKind =
  "file" | "directory" | "missing" | "dangling-symlink" | "other";

export interface PathIdentity {
  /** Absolute path after lexical resolution against cwd. */
  lexicalPath: string;
  /** Real target, or a real-parent-derived path for a missing leaf. */
  canonicalPath?: string;
  /** Canonical scope, while insideProject remains the lexical compatibility flag. */
  scope: PathScope;
  targetKind: PathTargetKind;
  /** Retained for callers that used the pre-SEC-002 lexical check. */
  insideProject: boolean;
  /** True when a symlink component escapes the project or cannot be resolved. */
  symlinkEscape: boolean;
  /** Backward-compatible alias for lexicalPath. */
  absolutePath: string;
}

function targetKindFromStat(stat: {
  isFile: () => boolean;
  isDirectory: () => boolean;
}): PathTargetKind {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

function canonicalizeMissingPath(lexicalPath: string): {
  canonicalPath?: string;
  unresolvedSymlink: boolean;
} {
  const suffix: string[] = [];
  let probe = lexicalPath;
  let unresolvedSymlink = false;

  while (true) {
    try {
      const canonicalBase = realpathSync(probe);
      return {
        canonicalPath: unresolvedSymlink
          ? undefined
          : resolve(canonicalBase, ...suffix),
        unresolvedSymlink,
      };
    } catch {
      try {
        if (lstatSync(probe).isSymbolicLink()) unresolvedSymlink = true;
      } catch {
        // The missing path component is expected to fail lstat.
      }
      suffix.unshift(basename(probe));
      const parent = dirname(probe);
      if (parent === probe) {
        return { canonicalPath: undefined, unresolvedSymlink };
      }
      probe = parent;
    }
  }
}

/**
 * Resolve both path identities before a native file operation is authorized.
 * This is still an observation: a caller that checks and opens separately has
 * a residual TOCTOU window, so this policy is not an OS-level no-follow or
 * atomic-open guarantee.
 */
export function resolvePathScope(rawPath: string, cwd: string): PathIdentity {
  const root = resolve(cwd);
  let canonicalRoot = root;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    // The caller's cwd should exist; the lexical root remains the safe fallback.
  }
  const lexicalPath = resolve(root, rawPath);
  const insideProject = isInside(root, lexicalPath);
  const symlinkComponent = hasSymlinkComponent(root, lexicalPath);
  let canonicalPath: string | undefined;
  let targetKind: PathTargetKind;

  try {
    const lexicalStat = lstatSync(lexicalPath);
    if (lexicalStat.isSymbolicLink()) {
      canonicalPath = realpathSync(lexicalPath);
      targetKind = targetKindFromStat(statSync(canonicalPath));
    } else {
      canonicalPath = realpathSync(lexicalPath);
      targetKind = targetKindFromStat(statSync(canonicalPath));
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code !== undefined && code !== "ENOENT" && code !== "ENOTDIR") {
      targetKind = "other";
    } else {
      const missing = canonicalizeMissingPath(lexicalPath);
      canonicalPath = missing.canonicalPath;
      targetKind = missing.unresolvedSymlink ? "dangling-symlink" : "missing";
    }
  }

  const canonicalInsideProject =
    canonicalPath !== undefined && isInside(canonicalRoot, canonicalPath);
  const scope: PathScope =
    canonicalPath === undefined
      ? "unresolved"
      : !insideProject || !canonicalInsideProject
        ? "external"
        : "project";

  return {
    lexicalPath,
    canonicalPath,
    scope,
    targetKind,
    insideProject,
    symlinkEscape:
      symlinkComponent || (insideProject && !canonicalInsideProject),
    absolutePath: lexicalPath,
  };
}

export function isSensitivePathIdentity(
  rawPath: string,
  identity: PathIdentity,
): boolean {
  return (
    isSensitiveReference(rawPath) ||
    isSensitiveReference(identity.lexicalPath) ||
    (identity.canonicalPath !== undefined &&
      isSensitiveReference(identity.canonicalPath))
  );
}

function isProtectedPathIdentity(identity: PathIdentity, cwd: string): boolean {
  return (
    isProtectedProjectPath(identity.lexicalPath, cwd) ||
    (identity.canonicalPath !== undefined &&
      isProtectedProjectPath(identity.canonicalPath, cwd))
  );
}

export function isSensitiveReference(value: string): boolean {
  const withoutEnvExample = value.replace(ENV_EXAMPLE_PATTERN, "$1");
  return (
    SECRET_PATH_PATTERN.test(withoutEnvExample) ||
    /(?:^|[\s|;&])(?:env|printenv)(?:\s*$|\s+[^;&\n]*(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL))/i.test(
      withoutEnvExample,
    ) ||
    /\$(?:\{)?[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL)[A-Z0-9_]*(?:\})?/i.test(
      withoutEnvExample,
    ) ||
    /(?:^|[\s/])\/proc\/[^\s/]+\/environ(?:[\s/]|$)/i.test(withoutEnvExample)
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
  const roots = [resolve(cwd)];
  try {
    roots.push(realpathSync(roots[0]));
  } catch {
    // Keep the lexical root when the project root cannot be canonicalized.
  }
  return roots.some((root) => {
    const rel = relative(root, absolutePath).split(sep).join("/");
    if (!rel || rel.startsWith("../")) return false;
    return PROTECTED_PROJECT_PATHS.some(
      (entry) => rel === entry || rel.startsWith(`${entry}/`),
    );
  });
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
  const { protectedWritePath } = options;
  const identity = resolvePathScope(rawPath, cwd);
  const isReadRestricted = permissionLevel === "readonly";

  // YOLO 3 hebt die Pfadgrenzen vollständig auf (Secrets, außerhalb des
  // Projekts, Symlink-Escape, Ausführungspfade). Trust-Grenze und Plan-Mode
  // entscheiden vorher in guards.ts/workflow-policy.ts.
  if (permissionLevel === "yolo-full") return YOLO_FULL_ALLOW;

  if (isSensitivePathIdentity(rawPath, identity)) {
    return isReadRestricted ||
      permissionLevel === "yolo" ||
      permissionLevel === "headless"
      ? deny(
          "Harte Grenze: Secrets und SSH-/Credential-Dateien sind blockiert.",
        )
      : ask("Zugriff auf Secrets, Tokens, Credentials oder SSH-Keys", true);
  }

  if (identity.targetKind === "other") {
    return deny(
      "Harte Grenze: Dateizugriff auf Spezialgeräte oder Sockets ist blockiert.",
    );
  }

  if (identity.scope === "unresolved") {
    return deny(
      "Harte Projekt-, Symlink- oder Zielauflösungsgrenze: Das Dateiziel ist nicht sicher aufgelöst.",
    );
  }

  if (operation === "read") {
    // Normales Lesen ist global: externe Pfade und Symlinks auf nicht-sensitive
    // Ziele sind auf allen Stufen erlaubt (auch readonly, project-write, confirm-all, yolo).
    return ALLOW;
  }

  // Ab hier: operation === "write"
  const externalOrUnresolved =
    identity.scope !== "project" || identity.symlinkEscape;
  if (externalOrUnresolved) {
    // YOLO 2: mehr Zugriff mit Erlaubnis statt harter Sperre.
    if (permissionLevel === "yolo-ask") {
      return ask(
        `Dateizugriff außerhalb des Projekts oder über einen Symlink: ${identity.lexicalPath}`,
        true,
      );
    }
    return deny(
      "Harte Projekt-, Symlink- oder Zielauflösungsgrenze: Das Dateiziel ist nicht sicher innerhalb des Projekts aufgelöst.",
    );
  }

  if (isReadRestricted) {
    return protectedWritePath?.matches(rawPath, cwd)
      ? ALLOW
      : deny(
          `Diese Zugriffsstufe erlaubt Schreibzugriff ausschließlich auf ${protectedWritePath?.label ?? "keine Datei"}.`,
        );
  }

  // Re-check the canonical boundary here as defense in depth. guards.ts runs
  // this same identity through workflow-policy first, but direct callers must
  // not be able to bypass the path decision layer.
  if (operation === "write" && isProtectedPathIdentity(identity, cwd)) {
    return permissionLevel === "yolo" || permissionLevel === "headless"
      ? deny(
          permissionLevel === "headless"
            ? `Änderung an einem Ausführungspfad im Projekt benötigt eine Bestätigung, die im Headless-Modus nicht verfügbar ist: ${identity.lexicalPath}`
            : "Harte Grenze: Ausführungspfad im Projekt wurde in YOLO blockiert.",
        )
      : ask(
          `Änderung an einem Ausführungspfad im Projekt: ${identity.lexicalPath}`,
          true,
        );
  }
  if (operation === "write" && permissionLevel === "confirm-all") {
    return ask(`Mutation im Projekt: ${identity.lexicalPath}`);
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

function isExternalPathReference(value: string, cwd: string): boolean {
  if (value === "~" || value.startsWith("~/")) return true;
  const identity = resolvePathScope(value, cwd);
  return identity.scope !== "project" || identity.symlinkEscape;
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
        return isExternalPathReference(value, cwd);
      }
      // Bare options like -o are not paths
      return false;
    }
    return isExternalPathReference(token, cwd);
  });
}

function containsSensitivePath(tokens: string[], cwd: string): boolean {
  return tokens
    .slice(1)
    .some((token) =>
      isSensitivePathIdentity(token, resolvePathScope(token, cwd)),
    );
}

function hasAnyOption(tokens: string[], patterns: RegExp[]): boolean {
  return tokens
    .slice(1)
    .some((token) => patterns.some((pattern) => pattern.test(token)));
}

/**
 * Resolves the executable exactly as a shell PATH lookup would encounter it
 * and decides whether it is a trusted system program (see
 * ExecutableTrustPolicy for the model).
 *
 * The first PATH hit decides. A hit outside a system location is rejected
 * instead of falling through to a later, trusted executable with the same
 * basename.
 *
 * `name` is the tool name used for classification. For classic system dirs it
 * is the canonical basename (unchanged behaviour). For system-profile hits it
 * is the invoked name: Nix packages such as coreutils are multicall binaries
 * (`ls -> .../bin/coreutils`) that dispatch on argv[0], so the canonical
 * basename would identify every one of them as "coreutils". That is safe
 * because the profile directory and the target are both verified system
 * locations, not attacker-controlled links.
 */
export function resolveExecutableTrust(
  rawExecutable: string,
  cwd: string,
  policy: ExecutableTrustPolicy = DEFAULT_EXECUTABLE_TRUST_POLICY,
  pathEnv: string = process.env.PATH ?? "",
): ExecutableTrust {
  const pathQualified =
    rawExecutable.includes("/") || rawExecutable.includes("\\");
  if (SAFE_SHELL_BUILTINS.has(rawExecutable) && !pathQualified) {
    return { trusted: true, name: rawExecutable, source: "shell-builtin" };
  }
  const fail = (
    reason: ExecutableTrustFailure,
    path?: string,
  ): ExecutableTrust => ({
    trusted: false,
    reason,
    executable: rawExecutable,
    path,
  });

  // 1. Discovery.
  let candidate: string | undefined;
  if (pathQualified) {
    // Relative executables remain attacker-controlled even when they happen
    // to resolve through `..` to a system directory.
    if (!isAbsolute(rawExecutable)) return fail("relative-path");
    candidate = resolve(rawExecutable);
  } else {
    for (const rawEntry of pathEnv.split(delimiter)) {
      // The shell runs in `cwd`, so relative and empty entries point there.
      const entry = resolve(cwd, rawEntry);
      const pathCandidate = resolve(entry, rawExecutable);
      if (existsSync(pathCandidate)) {
        candidate = pathCandidate;
        break;
      }
    }
  }
  if (!candidate) return fail("not-found");

  // 3. Target (checked before the source so every verdict is about a real,
  // runnable file).
  let canonical: string;
  try {
    canonical = realpathSync(candidate);
    if (!statSync(canonical).isFile()) return fail("invalid-target", candidate);
    accessSync(canonical, constants.X_OK);
  } catch {
    return fail("invalid-target", candidate);
  }

  // 2. Source.
  const discoveryDir = dirname(candidate);
  if (policy.systemProfileBinDirs.includes(discoveryDir)) {
    const canonicalDir = canonicalOrUndefined(discoveryDir);
    const inStore = (path: string) =>
      policy.systemProfileTargetRoots.some((root) => isInside(root, path));
    return canonicalDir !== undefined &&
      inStore(canonicalDir) &&
      inStore(canonical)
      ? {
          trusted: true,
          name: basename(candidate).toLowerCase(),
          source: "system-profile",
        }
      : fail("invalid-target", candidate);
  }
  const name = canonical.split(sep).pop()?.toLowerCase();
  if (name === undefined) return fail("invalid-target", candidate);
  if (policy.classicRoots.some((root) => isInside(root, canonical))) {
    return { trusted: true, name, source: "classic-system" };
  }
  if (
    !pathQualified &&
    policy.runtimeDiagnosticNames.has(name) &&
    policy.runtimeDiagnosticPaths.has(canonical) &&
    !isInside(resolve(cwd), canonical)
  ) {
    return { trusted: true, name, source: "runtime-diagnostic" };
  }
  return fail("untrusted-source", candidate);
}

function trustedExecutableName(
  rawExecutable: string,
  cwd: string,
): string | undefined {
  const trust = resolveExecutableTrust(rawExecutable, cwd);
  return trust.trusted ? trust.name : undefined;
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
  if (containsSensitivePath(tokens, cwd)) return false;
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

const MUTATING_COMMANDS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "trash",
  "touch",
  "mkdir",
  "mktemp",
  "mv",
  "cp",
  "install",
  "tee",
  "truncate",
  "dd",
  "chmod",
  "chown",
  "chgrp",
  "ln",
  "patch",
  "git-apply",
  "xargs",
]);
const PACKAGE_MANAGERS = new Set([
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "pip3",
  "uv",
  "cargo",
  "gem",
  "make",
]);
const COMMAND_EXECUTORS = new Set([
  "eval",
  "source",
  ".",
  "trap",
  "function",
  "select",
  "coproc",
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "while",
  "until",
  "for",
  "in",
  "do",
  "done",
  "case",
  "esac",
]);
const UNCERTAIN_COMMAND_WRAPPERS = new Set([
  "busybox",
  "nice",
  "timeout",
  "stdbuf",
]);
const TEST_RUNNERS = new Set(["pytest", "jest", "vitest", "mocha", "go"]);
const NON_MUTATING_PACKAGE_COMMANDS = new Set([
  "list",
  "ls",
  "view",
  "info",
  "search",
  "outdated",
  "show",
  "version",
  "--version",
  "-v",
]);
const GIT_MUTATIONS = new Set([
  "add",
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "fetch",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "rm",
  "stash",
  "switch",
  "worktree",
]);
const GIT_READS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "branch",
  "remote",
  "config",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "blame",
  "grep",
  "describe",
  "tag",
]);

function gitAction(args: string[]): { action?: string; position: number } {
  const valueOptions = new Set(["-C", "-c", "--git-dir", "--work-tree"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return { action: arg.toLowerCase(), position: index };
  }
  return { position: args.length };
}

/**
 * Executable-level facts `classifyOperationEffect` reports to a caller that
 * wants to verify them (Plan Mode, see diagnosePlanModeCommand): every program
 * the shell would start, and every environment override that changes how
 * programs are found or loaded.
 */
type ExecutableCheck =
  { kind: "executable"; raw: string } | { kind: "env-override"; name: string };

/** Classifies shell intent without requiring every harmless executable to be allowlisted. */
export function classifyOperationEffect(
  command: string,
  cwd: string,
  onExecutable?: (check: ExecutableCheck) => void,
): OperationEffect {
  if (isSensitiveReference(command)) return "FORBIDDEN";
  if (/\brm\b[^;&|]*(?:^|\s)["']?\/(?:[/.])*["']?(?=\s|$)/i.test(command))
    return "FORBIDDEN";
  if (!command.trim()) return "SAFE";
  if (/[`]|\$\(/.test(command)) return "RISKY";

  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let redirect = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    const next = command[i + 1];
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
    if (char === ">") {
      if (next === "(") return "RISKY";
      const descriptorRedirect = next === "&";
      const target = command
        .slice(i + (descriptorRedirect ? 2 : 1))
        .trimStart()
        .split(/[\\s|;&]/, 1)[0];
      if (!descriptorRedirect && target !== "/dev/null") redirect = true;
      if (descriptorRedirect) i += 1;
      continue;
    }
    if (char === "<") {
      if (next === "(" || next === "<") return "RISKY";
      continue;
    }
    if (char.charCodeAt(0) === 10 || char.charCodeAt(0) === 13) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    if (char === "|" || char === ";" || char === "&") {
      if (char === "&" && next !== "&") return "RISKY";
      if ((char === "|" && next === "|") || (char === "&" && next === "&"))
        i += 1;
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote || escaped) return "RISKY";
  if (current.trim()) parts.push(current.trim());
  if (redirect) return "MUTATING";
  if (parts.length === 0) return "RISKY";

  for (const part of parts) {
    const tokens = tokenizeSegment(part);
    if (tokens.length === 0) return "RISKY";
    if (containsSensitivePath(tokens, cwd)) return "FORBIDDEN";
    let operationTokens = tokens;
    while (
      ["command", "builtin", "exec", "nohup", "time"].includes(
        operationTokens[0],
      )
    ) {
      if (operationTokens[0] === "nohup")
        onExecutable?.({ kind: "executable", raw: "nohup" });
      operationTokens = operationTokens.slice(1);
      while (operationTokens[0]?.startsWith("-") && operationTokens[0] !== "--")
        operationTokens = operationTokens.slice(1);
      if (operationTokens[0] === "--")
        operationTokens = operationTokens.slice(1);
    }
    const { executable, args, raw, viaEnv, assignedNames } =
      executableToken(operationTokens);
    if (!executable) return "RISKY";
    if (onExecutable) {
      for (const name of assignedNames)
        onExecutable({ kind: "env-override", name });
      if (viaEnv) onExecutable({ kind: "executable", raw: "env" });
      onExecutable({ kind: "executable", raw });
    }
    if (
      COMMAND_EXECUTORS.has(executable) ||
      UNCERTAIN_COMMAND_WRAPPERS.has(executable)
    )
      return "RISKY";
    if (executable.startsWith("(") || executable === "{") return "RISKY";
    if (
      /^(sudo|su|service|mount|umount|reboot|shutdown|poweroff|useradd|usermod|passwd)$/.test(
        executable,
      )
    )
      return "RISKY";
    if (
      executable === "systemctl" &&
      !["status", "show", "list-units", "is-active"].includes(args[0])
    )
      return "RISKY";
    if (MUTATING_COMMANDS.has(executable)) return "MUTATING";
    if (
      executable === "find" &&
      args.some((arg) =>
        ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(arg),
      )
    )
      return "MUTATING";
    if (
      ["awk", "gawk", "mawk"].includes(executable) &&
      args.some((arg) => /\bsystem\s*\(|\b(?:print|printf)\b[^;]*>/.test(arg))
    )
      return "RISKY";
    if (
      (executable === "eslint" ||
        executable === "prettier" ||
        executable === "biome") &&
      args.some(
        (arg) => ["--fix", "--write"].includes(arg) || arg.startsWith("--fix-"),
      )
    )
      return "MUTATING";
    if (
      TEST_RUNNERS.has(executable) &&
      !(executable === "go" && args[0] === "version")
    )
      return "RISKY";
    if (executable === "tsc" && !args.includes("--noEmit")) return "RISKY";
    if (executable === "sed" && args.some((arg) => /^-.*i/.test(arg)))
      return "MUTATING";
    if (
      (executable === "sort" || executable === "tree") &&
      args.some((arg) => arg === "-o" || arg === "--output")
    )
      return "MUTATING";
    if (
      executable === "git" &&
      args.some((arg) => /^--output(?:=|$)/.test(arg))
    )
      return "MUTATING";
    if (
      (executable === "curl" &&
        args.some((arg) =>
          [
            "-o",
            "--output",
            "-O",
            "--remote-name",
            "-d",
            "--data",
            "-X",
            "--request",
          ].includes(arg),
        )) ||
      executable === "wget"
    )
      return "MUTATING";
    if (PACKAGE_MANAGERS.has(executable)) {
      const action = args.find((arg) => !arg.startsWith("-"))?.toLowerCase();
      if (action && NON_MUTATING_PACKAGE_COMMANDS.has(action)) continue;
      if (executable === "npm" && args[0] === "exec" && args.includes("--"))
        return "RISKY";
      return "RISKY";
    }
    if (executable === "git") {
      if (args.some((arg) => ["--ext-diff", "--textconv"].includes(arg)))
        return "RISKY";
      const { action, position } = gitAction(args);
      if (action && GIT_MUTATIONS.has(action)) return "MUTATING";
      if (
        action === "config" &&
        !args
          .slice(position + 1)
          .some((arg) =>
            ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(
              arg,
            ),
          )
      )
        return "MUTATING";
      if (
        ["remote", "branch", "tag"].includes(action ?? "") &&
        args.slice(position + 1).some((arg) => !arg.startsWith("-"))
      )
        return "MUTATING";
      if (args.some((arg) => arg === "--global" || arg === "--system"))
        return "RISKY";
      if (!action || !GIT_READS.has(action)) return "RISKY";
      continue;
    }
    if (
      [
        "node",
        "nodejs",
        "python",
        "python3",
        "ruby",
        "perl",
        "php",
        "bash",
        "dash",
        "ksh",
        "sh",
        "zsh",
        "deno",
        "lua",
      ].includes(executable)
    ) {
      if (args.some((arg) => /^(--version|-V|-v)$/.test(arg))) continue;
      return "RISKY";
    }
  }
  return "SAFE";
}

/**
 * Environment overrides that change which program the shell starts or how it
 * is loaded. The executable gate resolves programs against the process PATH,
 * so a command that rewrites any of these cannot be verified.
 */
const EXECUTION_ENV_OVERRIDE =
  /^(?:PATH|LD_[A-Z_]+|DYLD_[A-Z_]+|BASH_ENV|ENV)$/;

export type PlanModeCommandDiagnosis =
  | { safe: true }
  /** Classified as mutating, risky or forbidden by `classifyOperationEffect`. */
  | { safe: false; cause: "command-not-allowed"; effect: OperationEffect }
  /**
   * The effect is harmless, but the program the shell would start could not be
   * verified as a trusted system program (fake binary, user/project PATH hit,
   * path-qualified executable, PATH/loader override).
   */
  | {
      safe: false;
      cause: "executable-untrusted";
      executable: string;
      reason: "project-controlled" | "relative-path" | "env-override";
      path?: string;
    };

/**
 * Plan Mode decision for one shell command:
 * effect classification -> executable discovery -> trust of source and target.
 *
 * Plan Mode must be able to read and explore, so the gate is deliberately
 * open: a program passes whatever its source (system profile, user profile,
 * dev-shell store path, user bin dir) as long as its effect is harmless. Only
 * what a project could plant is refused: the first PATH hit or an absolute
 * path inside the project (`bin/ls`, `node_modules/.bin`, a relative or empty
 * PATH entry), relative path-qualified executables (`./ls`), and PATH/loader
 * overrides in front of the command. Trust (resolveExecutableTrust) stays
 * available for callers that need to know whether a program is a system one.
 */
export function diagnosePlanModeCommand(
  command: string,
  cwd: string,
  /** Injectable for tests that model a different system layout. */
  trust?: { policy?: ExecutableTrustPolicy; pathEnv?: string },
): PlanModeCommandDiagnosis {
  let untrusted:
    | Extract<PlanModeCommandDiagnosis, { cause: "executable-untrusted" }>
    | undefined;
  const effect = classifyOperationEffect(command, cwd, (check) => {
    if (untrusted) return;
    if (check.kind === "env-override") {
      if (EXECUTION_ENV_OVERRIDE.test(check.name)) {
        untrusted = {
          safe: false,
          cause: "executable-untrusted",
          executable: `${check.name}=`,
          reason: "env-override",
        };
      }
      return;
    }
    const resolved = resolveExecutableTrust(
      check.raw,
      cwd,
      trust?.policy,
      trust?.pathEnv,
    );
    if (resolved.trusted) return;
    const projectRoot = resolve(cwd);
    const hit = resolved.path;
    const reason =
      resolved.reason === "relative-path"
        ? "relative-path"
        : hit !== undefined &&
            (isInside(projectRoot, hit) ||
              isInside(projectRoot, canonicalOrUndefined(hit) ?? hit))
          ? "project-controlled"
          : undefined;
    if (!reason) return;
    untrusted = {
      safe: false,
      cause: "executable-untrusted",
      executable: check.raw,
      reason,
      path: hit,
    };
  });
  if (effect !== "SAFE") {
    return { safe: false, cause: "command-not-allowed", effect };
  }
  return untrusted ?? { safe: true };
}

export function isPlanModeDiagnosticCommand(
  command: string,
  cwd: string,
): boolean {
  return diagnosePlanModeCommand(command, cwd).safe;
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
  /** The command word as written (path included), before basename folding. */
  raw: string;
  /** True when an `env` prefix was skipped to reach the command word. */
  viaEnv: boolean;
  /** Names of `NAME=value` assignments skipped before the command word. */
  assignedNames: string[];
} {
  let index = 0;
  let viaEnv = false;
  const assignedNames: string[] = [];
  const skipAssignments = (allowOptions: boolean) => {
    while (index < tokens.length) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=.*/.exec(tokens[index]);
      if (assignment) assignedNames.push(assignment[1]);
      else if (!(allowOptions && tokens[index].startsWith("-"))) break;
      index += 1;
    }
  };
  skipAssignments(false);
  if (tokens[index] === "env") {
    viaEnv = true;
    index += 1;
    skipAssignments(true);
  }
  return {
    executable: tokens[index]?.split("/").pop()?.toLowerCase() ?? "",
    args: tokens.slice(index + 1),
    raw: tokens[index] ?? "",
    viaEnv,
    assignedNames,
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
  const identity = resolvePathScope(value, cwd);
  return identity.scope === "project" && !identity.symlinkEscape;
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
 * YOLO 3 allows without a special root-filesystem exception.
 */
function decideExtendedYoloBash(
  permissionLevel: "yolo-ask" | "yolo-full",
  command: string,
  cwd: string,
): PolicyDecision {
  if (permissionLevel === "yolo-full") return YOLO_FULL_ALLOW;
  // Check independently of the first boundary hit, so a root wipe cannot
  // hide behind another hard boundary in YOLO 2.
  if (CRITICAL_BASH_PATTERNS[0][0].test(command)) {
    return ask(ROOT_WIPE_REASON, true);
  }
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
