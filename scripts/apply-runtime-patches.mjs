/**
 * Re-applies the local P1 patches to the installed Pi runtime.
 *
 * The patches live in `node_modules` and every `npm update` of the runtime
 * removes them — that already happened once, silently, between 0.82.0 and
 * 0.83.0. `tests/p1-runtime.mjs` notices the loss; this script repairs it
 * without anyone having to rewrite the edits by hand.
 *
 * Three rules it will not bend:
 *   - idempotent: an already patched file is reported and left alone;
 *   - loud: an anchor that no longer matches aborts the whole run, because a
 *     changed runtime means the patch has to be reviewed, not force-fitted;
 *   - reversible: originals are copied to backups/ before the first write.
 *
 * Usage:
 *   node scripts/apply-runtime-patches.mjs              # dry run
 *   node scripts/apply-runtime-patches.mjs --apply
 *   node scripts/apply-runtime-patches.mjs --apply --runtime <path>
 *   node scripts/apply-runtime-patches.mjs --apply --allow-version-drift
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeRoot } from "../shared/runtime-resolution.mjs";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The runtime version these patches were written and verified against. */
export const EXPECTED_RUNTIME_VERSION = "0.84.1";

/**
 * One edit. `detect` proves the patch is already in place, `anchor` is the
 * exact untouched text it replaces. Both must be unambiguous.
 */
export const PATCHES = [
  {
    id: "agent-session-builtin-command-import",
    file: "dist/core/agent-session.js",
    summary: "Built-in Slash-Commands für das Extension-Inventar importieren",
    detect: 'import { BUILTIN_SLASH_COMMANDS } from "./slash-commands.js";',
    anchor: `import { createSyntheticSourceInfo } from "./source-info.js";`,
    replacement: `import { createSyntheticSourceInfo } from "./source-info.js";
import { BUILTIN_SLASH_COMMANDS } from "./slash-commands.js";`,
  },
  {
    id: "agent-session-complete-command-inventory",
    file: "dist/core/agent-session.js",
    summary: "pi.getCommands() um Built-ins und aktive Skills ergänzen",
    detect: "const builtinCommands = BUILTIN_SLASH_COMMANDS.map",
    anchor: `        const getCommands = () => {
            const extensionCommands = runner.getRegisteredCommands().map((command) => ({
                name: command.invocationName,
                description: command.description,
                source: "extension",
                sourceInfo: command.sourceInfo,
            }));
            const templates = this.promptTemplates.map((template) => ({
                name: template.name,
                description: template.description,
                source: "prompt",
                sourceInfo: template.sourceInfo,
            }));
            const skills = this._resourceLoader.getSkills().skills.map((skill) => ({
                name: \`skill:\${skill.name}\`,
                description: skill.description,
                source: "skill",
                sourceInfo: skill.sourceInfo,
            }));
            return [...extensionCommands, ...templates, ...skills];
        };`,
    replacement: `        const getCommands = () => {
            const builtinCommands = BUILTIN_SLASH_COMMANDS.map((command) => ({
                name: command.name,
                description: command.description,
                source: "builtin",
                sourceInfo: createSyntheticSourceInfo(\`<builtin-command:\${command.name}>\`, { source: "builtin" }),
            }));
            const extensionCommands = runner.getRegisteredCommands().map((command) => ({
                name: command.invocationName,
                description: command.description,
                source: "extension",
                sourceInfo: command.sourceInfo,
            }));
            const templates = this.promptTemplates.map((template) => ({
                name: template.name,
                description: template.description,
                source: "prompt",
                sourceInfo: template.sourceInfo,
            }));
            const skills = this.settingsManager.getEnableSkillCommands()
                ? this._resourceLoader.getSkills().skills.map((skill) => ({
                    name: \`skill:\${skill.name}\`,
                    description: skill.description,
                    source: "skill",
                    sourceInfo: skill.sourceInfo,
                }))
                : [];
            return [...builtinCommands, ...extensionCommands, ...templates, ...skills];
        };`,
  },
  {
    id: "interactive-submit-slash-command",
    file: "dist/modes/interactive/interactive-mode.js",
    summary: "Slash-Commands aus Extension-Menüs direkt absenden",
    detect: "submitSlashCommand: async (commandLine)",
    anchor: `            setEditorText: (text) => this.editor.setText(text),
            getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),`,
    replacement: `            setEditorText: (text) => this.editor.setText(text),
            getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
            // P1: menu and shortcut actions use the same dispatcher as a
            // manually submitted slash command. Arbitrary prompts are rejected.
            submitSlashCommand: async (commandLine) => {
                const normalized = commandLine.trim();
                if (!/^\\/[^\\s/]+(?:\\s[^\\r\\n]*)?$/.test(normalized))
                    throw new Error("submitSlashCommand accepts one slash command only");
                await this.defaultEditor.onSubmit?.(normalized);
            },`,
  },
  {
    id: "interactive-focus-scoped-terminal-input",
    file: "dist/modes/interactive/interactive-mode.js",
    summary: "Globale Extension-Eingaben bei modaler Fokusübernahme aussetzen",
    detect: "P1: terminal input listeners are editor-scoped",
    anchor: `            onTerminalInput: (handler) => this.addExtensionTerminalInputListener(handler),`,
    replacement: `            // P1: terminal input listeners are editor-scoped. A global listener
            // must not consume arrows or Escape before a focused selector/overlay.
            onTerminalInput: (handler) => this.addExtensionTerminalInputListener((data) => this.ui.focusedComponent === this.editor ? handler(data) : undefined),`,
  },
  // P1-RETIRED (0.84.0): "loader-scoped-events" and "loader-unsubscriber-list"
  // used to scope each extension's pi.events.on() listeners to its own
  // lifecycle, so a reload didn't leave the old generation still answering.
  // Pi 0.84.0 solves the same problem natively via a generation-scoped
  // `eventBusUnsubscribers` set (loader.js: createExtensionRuntime() +
  // trackEventBusSubscription()), drained by runtime.invalidate(). See
  // docs/RUNTIME_PATCHES.md for the full history.
  // P1-RETIRED (0.84.0): "runner-dispose" and "session-reload-dispose" added
  // ExtensionRunner.dispose() and wired it into agent-session.js's reload().
  // reload() now calls the native oldRunner.invalidate() directly, which
  // already drains the generation's event-bus listeners — dispose() would be
  // an unused method calling into fields nothing else populates. See
  // docs/RUNTIME_PATCHES.md for the full history.
  {
    id: "package-manager-order-helper",
    file: "dist/core/package-manager.js",
    summary: "Sortierfunktion für die deklarierte Extension-Reihenfolge",
    detect: "function applyConfiguredExtensionOrder(",
    anchor: `/**
 * Apply patterns to paths and return a Set of enabled paths.
 * Pattern types:`,
    replacement: `/**
 * P1: order extensions by their explicit \`+path\` entries from settings.json.
 *
 * The precedence sort is stable, so within one rank the order came from the
 * directory scan — alphabetical, not the order the user declared. Extensions
 * that load each other's exports need the declared order to hold.
 */
function applyConfiguredExtensionOrder(resolved, overrides, fallbackBaseDir) {
    const forceIncludes = getOverridePatterns(overrides)
        .filter((pattern) => pattern.startsWith("+"))
        .map((pattern) => pattern.slice(1));
    if (forceIncludes.length === 0)
        return resolved;
    const declaredIndex = (entry) => {
        const baseDir = entry.metadata?.baseDir ?? fallbackBaseDir;
        if (!baseDir)
            return forceIncludes.length;
        for (let index = 0; index < forceIncludes.length; index += 1) {
            if (matchesAnyExactPattern(entry.path, [forceIncludes[index]], baseDir))
                return index;
        }
        return forceIncludes.length;
    };
    return resolved
        .map((entry, index) => ({ entry, index, declared: declaredIndex(entry) }))
        .sort((a, b) => resourcePrecedenceRank(a.entry.metadata) -
        resourcePrecedenceRank(b.entry.metadata) ||
        a.declared - b.declared ||
        a.index - b.index)
        .map((item) => item.entry);
}
/**
 * Apply patterns to paths and return a Set of enabled paths.
 * Pattern types:`,
  },
  {
    id: "package-manager-order-use",
    file: "dist/core/package-manager.js",
    summary: "toResolvedPaths() wendet die deklarierte Reihenfolge an",
    detect: `        const globalSettings = this.settingsManager.getGlobalSettings();
        const extensionOverrides = [
            ...(globalSettings.extensions ?? []),
        ];`,
    // The first 0.83.0 port used the removed getSettings() API. Recognize that
    // exact short-lived form and upgrade it atomically with the other patches.
    legacyDetect: `        const settings = this.settingsManager.getSettings();
        const extensionOverrides = [
            ...(settings?.extensions ?? []),
        ];`,
    legacyReplacement: `        const globalSettings = this.settingsManager.getGlobalSettings();
        const extensionOverrides = [
            ...(globalSettings.extensions ?? []),
        ];`,
    anchor: `    toResolvedPaths(accumulator) {
        const mapToResolved = (entries) => {
            const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
                path,
                enabled,
                metadata,
            }));
            resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata));
            const seen = new Set();
            return resolved.filter((entry) => {
                const canonicalPath = canonicalizePath(entry.path);
                if (seen.has(canonicalPath))
                    return false;
                seen.add(canonicalPath);
                return true;
            });
        };
        return {
            extensions: mapToResolved(accumulator.extensions),`,
    replacement: `    toResolvedPaths(accumulator) {
        const mapToResolved = (entries, extensionOverrides) => {
            let resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
                path,
                enabled,
                metadata,
            }));
            if (extensionOverrides) {
                resolved = applyConfiguredExtensionOrder(resolved, extensionOverrides, this.agentDir);
            }
            else {
                resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata));
            }
            const seen = new Set();
            return resolved.filter((entry) => {
                const canonicalPath = canonicalizePath(entry.path);
                if (seen.has(canonicalPath))
                    return false;
                seen.add(canonicalPath);
                return true;
            });
        };
        const globalSettings = this.settingsManager.getGlobalSettings();
        const extensionOverrides = [
            ...(globalSettings.extensions ?? []),
        ];
        return {
            extensions: mapToResolved(accumulator.extensions, extensionOverrides),`,
  },
  {
    id: "agent-session-compaction-failure-manual",
    file: "dist/core/agent-session.js",
    summary: "Fehlgeschlagene manuelle Kompaktierung an Extensions melden",
    detect:
      'if (!aborted && this._extensionRunner.hasHandlers("session_compact_failed")) {',
    anchor: `            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: undefined,
                aborted,
                willRetry: false,
                errorMessage: aborted ? undefined : \`Compaction failed: \${message}\`,
            });
            throw error;
        }
        finally {
            this._compactionAbortController = undefined;
        }
    }`,
    replacement: `            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: undefined,
                aborted,
                willRetry: false,
                errorMessage: aborted ? undefined : \`Compaction failed: \${message}\`,
            });
            if (!aborted && this._extensionRunner.hasHandlers("session_compact_failed")) {
                await this._extensionRunner.emit({
                    type: "session_compact_failed",
                    reason: "manual",
                    errorMessage: message,
                    willRetry: false,
                });
            }
            throw error;
        }
        finally {
            this._compactionAbortController = undefined;
        }
    }`,
  },
  {
    id: "agent-session-compaction-failure-auto",
    file: "dist/core/agent-session.js",
    summary: "Fehlgeschlagene automatische Kompaktierung an Extensions melden",
    detect:
      'if (this._extensionRunner.hasHandlers("session_compact_failed")) {',
    anchor: `            if (started) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage: reason === "overflow"
                        ? \`Context overflow recovery failed: \${errorMessage}\`
                        : \`Auto-compaction failed: \${errorMessage}\`,
                });
            }
            return false;`,
    replacement: `            if (started) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage: reason === "overflow"
                        ? \`Context overflow recovery failed: \${errorMessage}\`
                        : \`Auto-compaction failed: \${errorMessage}\`,
                });
                if (this._extensionRunner.hasHandlers("session_compact_failed")) {
                    await this._extensionRunner.emit({
                        type: "session_compact_failed",
                        reason,
                        errorMessage,
                        willRetry: false,
                    });
                }
            }
            return false;`,
  },
];

/**
 * Decide what a single patch would do to `content`, without writing.
 * Throws when the anchor is gone — a changed runtime needs a human, not a
 * best-effort guess.
 */
export function planPatch(patch, content) {
  if (content.includes(patch.detect)) return { state: "already", content };
  if (patch.legacyDetect && content.includes(patch.legacyDetect)) {
    const occurrences = content.split(patch.legacyDetect).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `Patch '${patch.id}': veralteter Anker kommt ${occurrences}× in ${patch.file} vor und ist damit nicht eindeutig.`,
      );
    }
    return {
      state: "pending",
      content: content.replace(patch.legacyDetect, patch.legacyReplacement),
    };
  }
  const occurrences = content.split(patch.anchor).length - 1;
  if (occurrences === 0) {
    throw new Error(
      `Patch '${patch.id}': Ankertext nicht gefunden in ${patch.file}. Die Runtime hat sich geändert — Patch prüfen und portieren, nicht erzwingen.`,
    );
  }
  if (occurrences > 1) {
    throw new Error(
      `Patch '${patch.id}': Ankertext kommt ${occurrences}× in ${patch.file} vor und ist damit nicht eindeutig.`,
    );
  }
  return {
    state: "pending",
    content: content.replace(patch.anchor, patch.replacement),
  };
}

function parseArgs(argv) {
  let apply = false;
  let runtime;
  let allowVersionDrift = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--allow-version-drift") allowVersionDrift = true;
    else if (arg === "--runtime") {
      const value = argv[index + 1];
      if (!value) throw new Error("--runtime benötigt einen Pfad");
      runtime = value;
      index += 1;
    } else {
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }
  return { apply, runtime, allowVersionDrift };
}

function assertNoSymlinkComponents(candidate) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlink im Runtime-Pfad nicht erlaubt: ${current}`);
    }
  }
}

function readRuntimeVersion(runtime) {
  const manifest = path.join(runtime, "package.json");
  if (!existsSync(manifest)) {
    throw new Error(`Keine Pi-Runtime unter ${runtime} (package.json fehlt).`);
  }
  const version = JSON.parse(readFileSync(manifest, "utf8")).version;
  if (typeof version !== "string") {
    throw new Error(`Runtime-Manifest ohne Version: ${manifest}`);
  }
  return version;
}

function main(argv) {
  const { apply, runtime: requestedRuntime, allowVersionDrift } = parseArgs(argv);
  const { root: runtime, source } = resolveRuntimeRoot({ runtime: requestedRuntime });
  assertNoSymlinkComponents(runtime);

  console.log(`Runtime-Ziel: ${runtime} (${source})`);

  const version = readRuntimeVersion(runtime);
  if (version !== EXPECTED_RUNTIME_VERSION) {
    const message = `Runtime ist ${version}, die Patches sind gegen ${EXPECTED_RUNTIME_VERSION} geschrieben.`;
    if (!allowVersionDrift) {
      throw new Error(
        `${message} Patches gegen die neue Version prüfen und EXPECTED_RUNTIME_VERSION nachziehen, oder bewusst mit --allow-version-drift fortfahren.`,
      );
    }
    console.warn(`WARNUNG: ${message} Fortsetzung wurde ausdrücklich erlaubt.`);
  }

  // Plan every patch before touching anything: a single bad anchor must not
  // leave the runtime half patched.
  const byFile = new Map();
  const results = [];
  for (const patch of PATCHES) {
    const absolute = path.join(runtime, patch.file);
    if (!existsSync(absolute)) {
      throw new Error(`Runtime-Datei fehlt: ${absolute}`);
    }
    if (!byFile.has(patch.file)) {
      byFile.set(patch.file, {
        original: readFileSync(absolute, "utf8"),
        content: readFileSync(absolute, "utf8"),
      });
    }
    const entry = byFile.get(patch.file);
    const planned = planPatch(patch, entry.content);
    entry.content = planned.content;
    results.push({ patch, state: planned.state });
  }

  const pending = results.filter((result) => result.state === "pending");
  for (const { patch, state } of results) {
    const tag = state === "already" ? "OK  " : apply ? "PATCH" : "DRY ";
    console.log(`${tag} ${patch.id} — ${patch.summary}`);
  }

  if (pending.length === 0) {
    console.log(
      `\nAlle ${PATCHES.length} Patches sind bereits angewendet (Runtime ${version}).`,
    );
    return;
  }
  if (!apply) {
    console.log(
      `\n${pending.length} von ${PATCHES.length} Patches fehlen; --apply schreibt sie.`,
    );
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(SOURCE, "backups", "runtime-patches", stamp);
  const changedFiles = [...byFile.entries()].filter(
    ([, entry]) => entry.content !== entry.original,
  );
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const [file, entry] of changedFiles) {
    const backupPath = path.join(backupDir, file);
    mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    copyFileSync(path.join(runtime, file), backupPath);
    writeFileSync(path.join(runtime, file), entry.content, "utf8");
  }
  console.log(
    `\n${pending.length} Patch(es) auf ${changedFiles.length} Datei(en) angewendet.`,
  );
  console.log(`Originale gesichert unter ${backupDir}`);
  console.log("Verifikation: node tests/p1-runtime.mjs");
}

// Only run as a CLI, so the tests can import PATCHES and planPatch.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Runtime-Patch: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
