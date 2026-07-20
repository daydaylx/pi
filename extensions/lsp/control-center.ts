import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  CONTROL_CENTER_EVENTS,
  type OpenControlCenterMenuEvent,
} from "../shared/control-center-events.ts";
import { runMenu, type MenuEntry } from "../shared/menu-ui.ts";
import { EXTENSION_LANGUAGE_MAP } from "./server-profiles.ts";
import { runLspDiagnostics, type LspToolsDeps } from "./tools.ts";

const MAX_DIAGNOSTIC_CANDIDATES = 200;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".next",
  "coverage",
  "out",
  "target",
  "vendor",
]);

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Lists a bounded set of regular, supported files below the workspace root. */
export function findLspDiagnosticCandidates(
  cwd: string,
  limit = MAX_DIAGNOSTIC_CANDIDATES,
): string[] {
  let root: string;
  try {
    root = realpathSync(resolve(cwd));
  } catch {
    return [];
  }
  const candidates: string[] = [];
  const visit = (directory: string): void => {
    if (candidates.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (candidates.length >= limit || entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(absolute);
        continue;
      }
      if (!entry.isFile() || !EXTENSION_LANGUAGE_MAP[extname(entry.name)])
        continue;
      const file = resolve(absolute);
      if (!isInside(root, file)) continue;
      candidates.push(relative(root, file));
    }
  };
  visit(root);
  return candidates.sort((a, b) => a.localeCompare(b));
}

/**
 * Revalidates a previously displayed candidate immediately before LSP access.
 * The canonical regular file must still be inside the workspace and may not
 * have become a symlink since enumeration.
 */
export function resolveLspDiagnosticCandidate(
  cwd: string,
  candidate: string,
): string | undefined {
  try {
    const root = realpathSync(resolve(cwd));
    const path = resolve(root, candidate);
    if (!isInside(root, path)) return undefined;
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) return undefined;
    const canonical = realpathSync(path);
    if (!isInside(root, canonical)) return undefined;
    const after = lstatSync(canonical);
    return after.isFile() && !after.isSymbolicLink() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

type DiagnosticsAction = "status" | "pick-file";

function buildDiagnosticsMenu(status: string): MenuEntry<DiagnosticsAction>[] {
  return [
    {
      id: "lsp-status",
      label: `LSP-Status: ${status}`,
      description: "Aktueller berechneter Status der lokalen LSP-Integration",
      value: "status",
      current: true,
    },
    {
      id: "lsp-pick-file",
      label: "Datei prüfen",
      description:
        "Eine unterstützte reguläre Workspace-Datei auswählen und diagnostizieren",
      value: "pick-file",
    },
  ];
}

export function registerLspControlCenter(
  pi: ExtensionAPI,
  options: {
    getStatus: () => string;
    refreshStatus: (ctx: ExtensionContext) => void;
    captureSession: (ctx: ExtensionContext) => unknown;
    isSessionCurrent: (ctx: ExtensionContext, token: unknown) => boolean;
    captureDeps: () => LspToolsDeps;
  },
): void {
  pi.events.on(CONTROL_CENTER_EVENTS.openDiagnostics, async (event) => {
    const ctx = (event as OpenControlCenterMenuEvent).ctx;
    const session = options.captureSession(ctx);
    if (!options.isSessionCurrent(ctx, session)) return;

    const status = options.getStatus();
    const selected = await runMenu(
      ctx,
      "LSP-Diagnose",
      buildDiagnosticsMenu(status),
      {
        fallbackPrompt: "LSP-Diagnose wählen",
      },
    );
    if (!selected || !options.isSessionCurrent(ctx, session)) return;
    if (selected === "status") {
      ctx.ui.notify(`LSP: ${status}`, "info");
      return;
    }

    const candidates = findLspDiagnosticCandidates(ctx.cwd);
    if (candidates.length === 0) {
      ctx.ui.notify(
        "Keine unterstützten regulären Dateien im Arbeitsbereich gefunden.",
        "info",
      );
      return;
    }
    const selectedPath = await runMenu(
      ctx,
      "LSP-Datei auswählen",
      candidates.map((candidate) => ({
        id: `lsp-file-${candidate}`,
        label: candidate,
        description:
          EXTENSION_LANGUAGE_MAP[extname(candidate)]?.languageId ?? "",
        value: candidate,
      })),
      { fallbackPrompt: "Datei für LSP-Diagnose wählen" },
    );
    if (!selectedPath || !options.isSessionCurrent(ctx, session)) return;

    const path = resolveLspDiagnosticCandidate(ctx.cwd, selectedPath);
    if (!path) {
      ctx.ui.notify(
        "Die ausgewählte Datei ist nicht mehr eine sichere reguläre Workspace-Datei.",
        "warning",
      );
      return;
    }

    const result = await runLspDiagnostics(
      options.captureDeps(),
      path,
      ctx.cwd,
    );
    if (!options.isSessionCurrent(ctx, session)) return;
    ctx.ui.notify(result.content[0].text, "info");
    options.refreshStatus(ctx);
  });
}
