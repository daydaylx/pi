#!/usr/bin/env node
/**
 * Standalone LSP smoke harness for issue #98.
 *
 * Unlike `tests/run.mjs` (deterministic, fake-LSP only, runs in the regular
 * `verify`/PR gate), this harness boots the REAL LSP extension against REAL
 * language servers installed on the host. It is intentionally NOT part of
 * `npm run verify` so the regular CI stays deterministic and fast.
 *
 * Run it locally or via `.github/workflows/lsp-smoke.yml`:
 *     node tests/lsp-smoke.mjs
 *
 * Result semantics:
 *   - ok    : server started, accepted requests, shut down cleanly.
 *   - skip  : server binary not installed -> not a failure (host has no server).
 *   - fail  : server crashed, threw, or left a live process behind.
 *
 * Exit code is non-zero only if at least one configured server FAILs.
 * Skips never fail the run, because servers are optional.
 *
 * This script loads the real `extensions/lsp/*` modules via jiti (same loader
 * as `tests/run.mjs`); it does NOT reimplement any client logic.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { createJiti } = require(path.join(ROOT, "npm", "node_modules", "jiti"));
const jiti = createJiti(ROOT, { interopDefault: true });

async function load(relativePath) {
  return jiti.import(path.join(ROOT, relativePath));
}

// --- Smoke targets -----------------------------------------------------------
// Each entry describes a real server profile plus a probe position for a
// deterministic symbol in the fixture. The profile id must match a built-in
// profile in extensions/lsp/server-profiles.ts.
const TARGETS = [
  {
    profileId: "typescript",
    fixture: path.join(ROOT, "tests", "fixtures", "lsp-smoke", "probe.ts"),
    targetFile: "probe.ts",
    languageId: "typescript",
    rootMarker: "tsconfig.json",
    // `answer` usage at `const value = answer();`
    probeLine: 8,
    probeCharacter: 16,
  },
  {
    profileId: "python",
    fixture: path.join(ROOT, "tests", "fixtures", "lsp-smoke", "probe.py"),
    targetFile: "probe.py",
    languageId: "python",
    rootMarker: "pyrightconfig.json",
    // `add` usage at `total = add(1, 2)`
    probeLine: 10,
    probeCharacter: 9,
  },
];

function summarize(results) {
  const lines = ["", "LSP smoke summary", "=================="];
  for (const r of results) {
    const tag = r.status.toUpperCase();
    lines.push(`[${tag}] ${r.profileId}: ${r.detail}`);
  }
  lines.push("");
  const failed = results.filter((r) => r.status === "fail");
  const ok = results.filter((r) => r.status === "ok");
  const skipped = results.filter((r) => r.status === "skip");
  lines.push(
    `ok=${ok.length} skip=${skipped.length} fail=${failed.length}`,
  );
  console.log(lines.join("\n"));
  return failed.length === 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeServer({ profile, fixture, targetFile, languageId, rootMarker, probeLine, probeCharacter }) {
  const { LspClient } = await load("extensions/lsp/client.ts");
  const { getDocumentSync } = await load("extensions/lsp/documents.ts");

  const workspace = mkdtempSync(path.join(tmpdir(), `pi-lsp-smoke-${profile.id}-`));
  // A root marker helps the server resolve the workspace root.
  writeFileSync(path.join(workspace, rootMarker), "{}\n");
  copyFileSync(fixture, path.join(workspace, targetFile));

  const diagnosticsByUri = new Map();
  let client;
  try {
    client = new LspClient({
      serverId: profile.id,
      workspaceRoot: workspace,
      command: profile.command,
      args: profile.args,
      initializationOptions: profile.initializationOptions,
      requestTimeoutMs: 15_000,
      process: {
        maxRestarts: 0, // smoke: do not mask a crash with a restart
        backoffBaseMs: 50,
        backoffMaxMs: 100,
        shutdownGraceMs: 800,
      },
    });

    client.on("notification", (message) => {
      if (message?.method === "textDocument/publishDiagnostics") {
        const uri = message.params?.uri ?? "";
        diagnosticsByUri.set(uri, message.params?.diagnostics ?? []);
      }
    });

    let init;
    try {
      init = await client.start();
    } catch (error) {
      if (error?.kind === "missing_binary") {
        return { status: "skip", detail: `binary not installed (${profile.command})` };
      }
      throw error;
    }

    if (!init?.capabilities) {
      throw new Error("initialize returned no capabilities");
    }

    const filePath = path.join(workspace, targetFile);
    const uri = pathToFileURL(filePath).href;
    const sync = getDocumentSync(client, workspace);
    sync.openOrSync(filePath, languageId);

    // Give the real server time to publish diagnostics (async, like the fake).
    // Soft check: we report whether diagnostics arrived, but do not fail on
    // zero — server versions and indexing latency vary.
    let diagnostics = [];
    for (let i = 0; i < 40; i++) {
      diagnostics = diagnosticsByUri.get(uri) ?? [];
      if (diagnostics.length > 0) break;
      await wait(250);
    }

    // Definition probe: a well-formed request must get a well-formed response
    // (Location, LocationLink[], or null). A thrown/errored response is a fail.
    let definitionShape = "none";
    try {
      const def = await client.request("textDocument/definition", {
        textDocument: { uri },
        position: { line: probeLine, character: probeCharacter },
      });
      if (def == null) definitionShape = "null";
      else if (Array.isArray(def)) definitionShape = `array[${def.length}]`;
      else definitionShape = "single";
    } catch (error) {
      throw new Error(
        `definition request failed: ${error?.message ?? String(error)}`,
      );
    }

    // Hover probe (same tolerance).
    let hoverShape = "none";
    try {
      const hover = await client.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: probeLine, character: probeCharacter },
      });
      hoverShape = hover?.contents ? "contents" : hover == null ? "null" : "other";
    } catch (error) {
      throw new Error(`hover request failed: ${error?.message ?? String(error)}`);
    }

    const diagCount = diagnostics.length;
    return {
      status: "ok",
      detail: `started; definition=${definitionShape}; hover=${hoverShape}; diagnostics=${diagCount}`,
    };
  } finally {
    if (client) {
      try {
        await client.shutdown();
      } catch {
        /* best-effort */
      }
      if (client.processRunning) {
        // Force-mark as fail: a leaked process is a hard regression.
        throw new Error("process still running after shutdown");
      }
    }
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* ignore temp cleanup */
    }
  }
}

async function main() {
  const profilesMod = await load("extensions/lsp/server-profiles.ts");
  const results = [];
  for (const target of TARGETS) {
    const profile = profilesMod.PROFILES?.[target.profileId];
    if (!profile) {
      results.push({
        profileId: target.profileId,
        status: "fail",
        detail: "no built-in profile in server-profiles.ts",
      });
      continue;
    }
    try {
      const res = await probeServer({ profile, ...target });
      results.push({ profileId: target.profileId, ...res });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({
        profileId: target.profileId,
        status: "fail",
        detail,
      });
    }
  }
  const ok = summarize(results);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error("lsp-smoke harness crashed:", error);
  process.exitCode = 1;
});
