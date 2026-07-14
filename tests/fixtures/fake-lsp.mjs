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
 *   - any other notification -> ignored
 *
 * Modes (argv):
 *   --crash-after-init       exit(1) right after sending the initialize result
 *   --hang                   never reply to non-handshake requests (timeout/cancel probe)
 *
 * No real language server is required; this keeps the regular CI deterministic.
 */
import process from "node:process";

const argv = new Set(process.argv.slice(2));
const HANG = argv.has("--hang");
const CRASH_AFTER_INIT = argv.has("--crash-after-init");

let buf = Buffer.alloc(0);
const pending = [];

function write(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

function handle(message) {
  if (message.id !== undefined && message.method !== undefined) {
    handleRequest(message);
  }
  // notifications have no id and need no reply.
}

function handleRequest(req) {
  switch (req.method) {
    case "initialize": {
      write({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            workspaceSymbolProvider: true,
          },
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
