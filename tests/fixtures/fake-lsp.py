#!/usr/bin/env python3
"""Deterministischer JSON-RPC/LSP-Server für die lokalen LSP-Regressionstests.

Das Node-Fixture bleibt als Referenz erhalten. Dieses Fixture verwendet nur die
Python-Standardbibliothek, weil die isolierte Test-Umgebung Node-Unterprozessen
auf stdin sofort EOF liefert. Der produktive LSP-Prozesspfad bleibt unverändert.
"""

import json
import os
import signal
import sys
import threading


ARGS = set(sys.argv[1:])
HANG = "--hang" in ARGS
CRASH_AFTER_INIT = "--crash-after-init" in ARGS
NO_DIAGNOSTICS = "--no-diagnostics" in ARGS
DEFINITION_LINKS = "--definition-links" in ARGS
NO_DEFINITION_PROVIDER = "--no-definition-provider" in ARGS
# Exercises client capability negotiation: no diagnostic push is sent unless
# initialize advertised textDocument.publishDiagnostics.
REQUIRE_DIAGNOSTICS_CAPABILITY = "--require-diagnostics-capability" in ARGS
CLIENT_SUPPORTS_DIAGNOSTICS = False

WRITE_LOCK = threading.Lock()


def range_of(text, needle, occurrence=1):
    """Berechnet einen LSP-``{start, end}``-Range aus der tatsaechlichen
    Position von ``needle`` im uebergebenen Fixture-Text, statt Zeichen-
    positionen von Hand zu zaehlen. ``occurrence`` waehlt das n-te
    (1-basiert) Auftreten, falls ``needle`` mehrfach vorkommt.

    Die vier bestehenden hart codierten Ranges unten (definition/references/
    workspace-symbol/diagnostics) bleiben bewusst unveraendert: ihr Ergebnis
    dient nur als Anzeige/Label, das nie auf echten Dateiinhalt angewendet
    wird -- ein falscher Range ist dort harmlos.

    Fuer einen KUENFTIGEN Handler, dessen Ergebnis-Range hingegen als
    Text-MUTATION angewendet wird (z.B. textDocument/rename), MUSS der Range
    exakt zur echten Zeichenposition passen -- dafuer ist diese Funktion da.
    Ohne sie fuehrte ein hart codierter, positionsunabhaengiger Range in
    einer frueheren real-05-lsp-rename-tool-Benchmarkrunde zu einem
    verstuemmelten Dateiinhalt: der canned Range traf " const" statt
    "target", weil "target" in "export const target = 1;\n" bei Zeichen 13
    beginnt, nicht bei 6 (dem hart gezaehlten, falschen Wert).
    """
    lines = text.split("\n")
    seen = 0
    for line_no, line in enumerate(lines):
        col = -1
        while True:
            col = line.find(needle, col + 1)
            if col == -1:
                break
            seen += 1
            if seen == occurrence:
                return {
                    "start": {"line": line_no, "character": col},
                    "end": {"line": line_no, "character": col + len(needle)},
                }
    raise ValueError(f"{needle!r} (Vorkommen {occurrence}) nicht in Fixture-Text gefunden")


def write(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    try:
        with WRITE_LOCK:
            sys.stdout.buffer.write(header + body)
            sys.stdout.buffer.flush()
    except BrokenPipeError:
        raise SystemExit(0)


def notify(method, params):
    write({"jsonrpc": "2.0", "method": method, "params": params})


def later(delay, callback):
    timer = threading.Timer(delay, callback)
    timer.daemon = True
    timer.start()


def publish_diagnostics(uri, version):
    if NO_DIAGNOSTICS or (
        REQUIRE_DIAGNOSTICS_CAPABILITY and not CLIENT_SUPPORTS_DIAGNOSTICS
    ):
        return

    def send():
        notify(
            "textDocument/publishDiagnostics",
            {
                "uri": uri,
                "version": version,
                "diagnostics": [
                    {
                        "severity": 1,
                        "range": {
                            "start": {"line": 0, "character": 0},
                            "end": {"line": 0, "character": 1},
                        },
                        "message": f"fake diagnostic for version {version}",
                        "source": "fake-lsp",
                    }
                ],
            },
        )

    later(0.01, send)


def handle_notification(note):
    method = note.get("method")
    if method == "exit":
        raise SystemExit(0)
    if method in ("textDocument/didOpen", "textDocument/didChange"):
        document = note.get("params", {}).get("textDocument", {})
        uri = document.get("uri")
        if uri is not None:
            publish_diagnostics(uri, document.get("version"))


def handle_request(request):
    global CLIENT_SUPPORTS_DIAGNOSTICS
    method = request.get("method")
    request_id = request.get("id")
    params = request.get("params") or {}

    if method == "initialize":
        CLIENT_SUPPORTS_DIAGNOSTICS = bool(
            params.get("capabilities", {})
            .get("textDocument", {})
            .get("publishDiagnostics")
        )
        capabilities = {
            "textDocumentSync": 1,
            "hoverProvider": True,
            "definitionProvider": True,
            "referencesProvider": True,
            "workspaceSymbolProvider": True,
        }
        if NO_DEFINITION_PROVIDER:
            del capabilities["definitionProvider"]
        write(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "capabilities": capabilities,
                    "serverInfo": {"name": "fake-lsp", "version": "0.0.0"},
                },
            }
        )
        if CRASH_AFTER_INIT:
            later(0.03, lambda: os._exit(1))
        return

    if method == "shutdown":
        write({"jsonrpc": "2.0", "id": request_id, "result": None})
        return
    if method in ("initialized", "exit", "$/cancelRequest"):
        return
    if method == "test/echo":
        if not HANG:
            write({"jsonrpc": "2.0", "id": request_id, "result": params})
        return
    if method == "test/parallel":
        if not HANG:
            later(
                0.015,
                lambda: write(
                    {"jsonrpc": "2.0", "id": request_id, "result": params}
                ),
            )
        return
    if method == "textDocument/definition":
        if HANG:
            return
        uri = params.get("textDocument", {}).get("uri", "file:///fake/target.ts")
        range_value = {
            "start": {"line": 4, "character": 2},
            "end": {"line": 4, "character": 10},
        }
        result = (
            [
                {
                    "targetUri": uri,
                    "targetRange": range_value,
                    "targetSelectionRange": range_value,
                }
            ]
            if DEFINITION_LINKS
            else {"uri": uri, "range": range_value}
        )
        write({"jsonrpc": "2.0", "id": request_id, "result": result})
        return
    if method == "textDocument/references":
        if HANG:
            return
        uri = params.get("textDocument", {}).get("uri", "file:///fake/target.ts")
        result = [
            {
                "uri": uri,
                "range": {
                    "start": {"line": line, "character": 0},
                    "end": {"line": line, "character": 5},
                },
            }
            for line in range(3)
        ]
        write({"jsonrpc": "2.0", "id": request_id, "result": result})
        return
    if method == "textDocument/hover":
        if not HANG:
            write(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "contents": {
                            "kind": "markdown",
                            "value": "**fake hover**\n\nDetailed hover contents for testing.",
                        }
                    },
                }
            )
        return
    if method == "workspace/symbol":
        if not HANG:
            query = params.get("query", "")
            write(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": [
                        {
                            "name": query or "fakeSymbol",
                            "kind": 12,
                            "location": {
                                "uri": "file:///fake/target.ts",
                                "range": {
                                    "start": {"line": 0, "character": 0},
                                    "end": {"line": 0, "character": 5},
                                },
                            },
                        }
                    ],
                }
            )
        return

    write(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"method not found: {method}"},
        }
    )


def read_message():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        name, separator, value = line.decode("ascii").partition(":")
        if separator:
            headers[name.lower()] = value.strip()
    try:
        length = int(headers["content-length"])
    except (KeyError, ValueError):
        return None
    body = sys.stdin.buffer.read(length)
    if len(body) != length:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def stop(_signum, _frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

while True:
    message = read_message()
    if message is None:
        break
    if message.get("id") is not None and message.get("method") is not None:
        handle_request(message)
    elif message.get("method") is not None:
        handle_notification(message)
