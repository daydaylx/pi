#!/usr/bin/env node
/**
 * Deterministic fake Language Server used by the LSP tests (issue #93 / #98).
 *
 * It speaks JSON-RPC 2.0 over stdio with LSP `Content-Length` framing and
 * implements exactly the protocol paths the tests exercise:
 *   - `initialize` / `initialized`
 *   - `shutdown` / `exit`
 *   - `test/echo`            -> responds with `params` (correlation probe)
 *   - `test/parallel`        -> responds after a short delay (parallel probe)
 *   - `$/cancelRequest`      -> ignored
 *   - `textDocument/didOpen`/`didChange` -> schedules a deterministic
 *     `textDocument/publishDiagnostics` notification (issue #95)
 *   - `textDocument/didClose`            -> ignored (no reply expected)
 *   - `textDocument/definition`/`references`/`hover`, `workspace/symbol`
 *     -> fixed, deterministic results (issue #96)
 *   - any other notification -> ignored
 *
 * Modes (argv):
 *   --crash-after-init        exit(1) right after sending the initialize result
 *   --hang                    never reply to non-handshake requests (timeout/cancel probe)
 *   --no-diagnostics          never publish diagnostics (timeout probe for #95)
 *   --definition-links        textDocument/definition replies with LocationLink[] instead of Location
 *   --no-definition-provider  initialize result omits definitionProvider (capability-gating probe)
 *
 * No real language server is required; this keeps the regular CI deterministic.
 */
import process from "node:process";

const argv = new Set(process.argv.slice(2));
const HANG = argv.has("--hang");
const CRASH_AFTER_INIT = argv.has("--crash-after-init");
const NO_DIAGNOSTICS = argv.has("--no-diagnostics");
const DEFINITION_LINKS = argv.has("--definition-links");
const NO_DEFINITION_PROVIDER = argv.has("--no-definition-provider");

let buf = Buffer.alloc(0);
const pending = [];
const docVersions = new Map(); // uri -> last-seen version

function write(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function publishDiagnostics(uri, version) {
  if (NO_DIAGNOSTICS) return;
  // Deterministic content: one fixed "Error" diagnostic per version, so
  // tests can assert that a new version replaces (not appends to) the last
  // one. Delayed slightly so open/change and diagnostics are genuinely
  // asynchronous, like a real server.
  setTimeout(() => {
    notify("textDocument/publishDiagnostics", {
      uri,
      version,
      diagnostics: [
        {
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: `fake diagnostic for version ${version}`,
          source: "fake-lsp",
        },
      ],
    });
  }, 10);
}

function handle(message) {
  if (message.id !== undefined && message.method !== undefined) {
    handleRequest(message);
    return;
  }
  if (message.id === undefined && message.method !== undefined) {
    handleNotification(message);
  }
}

function handleNotification(note) {
  switch (note.method) {
    case "textDocument/didOpen": {
      const { uri, version } = note.params?.textDocument ?? {};
      if (uri === undefined) return;
      docVersions.set(uri, version);
      publishDiagnostics(uri, version);
      return;
    }
    case "textDocument/didChange": {
      const { uri, version } = note.params?.textDocument ?? {};
      if (uri === undefined) return;
      docVersions.set(uri, version);
      publishDiagnostics(uri, version);
      return;
    }
    case "textDocument/didClose": {
      const { uri } = note.params?.textDocument ?? {};
      if (uri !== undefined) docVersions.delete(uri);
      return;
    }
    default:
      return; // unknown notifications are ignored, per LSP spec
  }
}

function handleRequest(req) {
  switch (req.method) {
    case "initialize": {
      const capabilities = {
        textDocumentSync: 1,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        workspaceSymbolProvider: true,
      };
      if (NO_DEFINITION_PROVIDER) delete capabilities.definitionProvider;
      write({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          capabilities,
          serverInfo: { name: "fake-lsp", version: "0.0.0" },
        },
      });
      if (CRASH_AFTER_INIT) {
        // Exit asynchronously so the initialize response is flushed first.
        // 30ms keeps the test deterministic under CI load.
        setTimeout(() => process.exit(1), 30);
      }
      return;
    }
    case "initialized":
    case "exit":
    case "$/cancelRequest":
      return;
    case "shutdown": {
      write({ jsonrpc: "2.0", id: req.id, result: null });
      return;
    }
    case "test/echo": {
      if (HANG) return; // never reply -> exercises timeout/cancellation
      write({ jsonrpc: "2.0", id: req.id, result: req.params ?? null });
      return;
    }
    case "test/parallel": {
      if (HANG) return;
      // Reply slightly delayed so multiple requests are genuinely in flight.
      setTimeout(
        () => write({ jsonrpc: "2.0", id: req.id, result: req.params ?? null }),
        15,
      );
      return;
    }
    case "textDocument/definition": {
      if (HANG) return;
      const uri = req.params?.textDocument?.uri ?? "file:///fake/target.ts";
      const range = {
        start: { line: 4, character: 2 },
        end: { line: 4, character: 10 },
      };
      const result = DEFINITION_LINKS
        ? [
            {
              targetUri: uri,
              targetRange: range,
              targetSelectionRange: range,
            },
          ]
        : { uri, range };
      write({ jsonrpc: "2.0", id: req.id, result });
      return;
    }
    case "textDocument/references": {
      if (HANG) return;
      const uri = req.params?.textDocument?.uri ?? "file:///fake/target.ts";
      const result = [0, 1, 2].map((n) => ({
        uri,
        range: {
          start: { line: n, character: 0 },
          end: { line: n, character: 5 },
        },
      }));
      write({ jsonrpc: "2.0", id: req.id, result });
      return;
    }
    case "textDocument/hover": {
      if (HANG) return;
      write({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          contents: {
            kind: "markdown",
            value: "**fake hover**\n\nDetailed hover contents for testing.",
          },
        },
      });
      return;
    }
    case "workspace/symbol": {
      if (HANG) return;
      const query = req.params?.query ?? "";
      write({
        jsonrpc: "2.0",
        id: req.id,
        result: [
          {
            name: `${query || "fakeSymbol"}`,
            kind: 12,
            location: {
              uri: "file:///fake/target.ts",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
            },
          },
        ],
      });
      return;
    }
    default: {
      write({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `method not found: ${req.method}` },
      });
    }
  }
}

function tryParse() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buf.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buf = buf.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + length) return;
    const body = buf.subarray(bodyStart, bodyStart + length);
    buf = buf.subarray(bodyStart + length);
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      if (parsed && parsed.jsonrpc === "2.0") pending.push(parsed);
    } catch {
      /* skip malformed frame */
    }
  }
}

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  tryParse();
  while (pending.length) handle(pending.shift());
});

process.stdin.on("end", () => process.exit(0));

// Keep the event loop alive while the stream is open; exit cleanly on signals.
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
