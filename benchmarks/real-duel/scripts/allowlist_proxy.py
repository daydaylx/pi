#!/usr/bin/env python3
"""Minimaler CONNECT-Allowlist-Proxy fuer Tier-2-Netzwerk-Isolation.

Laesst ausschliesslich HTTP CONNECT zu explizit erlaubten Hostnamen durch
(z.B. den Model-API-Host). Alles andere (github.com, Suchmaschinen,
allgemeines Web, npm-Registry ausserhalb des Setup-Preflights) wird mit
403 abgelehnt, bevor irgendeine Verbindung nach draussen aufgebaut wird.

Bewusst kein voller HTTP(S)-Proxy: CONNECT tunnelt TLS blind durch (der
Proxy sieht nur den Hostnamen aus dem CONNECT-Request, nie den
verschluesselten Inhalt) -- das reicht fuer eine Hostnamen-Allowlist und
vermeidet TLS-Interception (kein eigenes CA-Zertifikat noetig, keine
Manipulation des verschluesselten Datenstroms).

Nutzung:
    allowlist_proxy.py --allow api.openai.com --allow api.anthropic.com \
        --port 0 --ready-file /tmp/proxy-port.txt

Mit --port 0 waehlt das OS einen freien Port; die tatsaechliche Portnummer
wird nach --ready-file geschrieben, sobald der Server lauscht.
"""

import argparse
import re
import socket
import sys
import threading


def _host_allowed(host: str, allowlist: list[str]) -> bool:
    host = host.lower().rstrip(".")
    for allowed in allowlist:
        allowed = allowed.lower().rstrip(".")
        if host == allowed or host.endswith("." + allowed):
            return True
    return False


_CONNECT_RE = re.compile(rb"^CONNECT\s+([^\s:]+):(\d+)\s+HTTP/1\.\d\s*$")


def _relay(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        for sock in (a, b):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def _handle(client: socket.socket, allowlist: list[str], log) -> None:
    try:
        buf = b""
        while b"\r\n\r\n" not in buf and len(buf) < 8192:
            chunk = client.recv(4096)
            if not chunk:
                client.close()
                return
            buf += chunk
        request_line = buf.split(b"\r\n", 1)[0]
        match = _CONNECT_RE.match(request_line.rstrip(b"\r"))
        if not match:
            client.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            client.close()
            return
        host = match.group(1).decode("ascii", "replace")
        port = int(match.group(2))
        if not _host_allowed(host, allowlist):
            log(f"DENY {host}:{port}")
            client.sendall(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            client.close()
            return
        log(f"ALLOW {host}:{port}")
        try:
            upstream = socket.create_connection((host, port), timeout=15)
        except OSError as exc:
            client.sendall(f"HTTP/1.1 502 Bad Gateway\r\n\r\n{exc}".encode())
            client.close()
            return
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        t = threading.Thread(target=_relay, args=(client, upstream), daemon=True)
        t.start()
        _relay(upstream, client)
    except Exception as exc:  # noqa: BLE001 - eine Verbindung darf den Server nie mitreissen
        log(f"ERROR {exc}")
    finally:
        try:
            client.close()
        except OSError:
            pass


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow", action="append", default=[], metavar="HOST")
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--ready-file", help="Datei, in die die tatsaechliche Portnummer geschrieben wird")
    parser.add_argument("--log-file", help="Datei fuer ALLOW/DENY-Log (Standard: stderr)")
    args = parser.parse_args(argv)

    if not args.allow:
        parser.error("mindestens ein --allow HOST ist Pflicht (default-deny sonst sinnlos)")

    log_fh = open(args.log_file, "a", buffering=1) if args.log_file else sys.stderr

    def log(msg: str) -> None:
        print(msg, file=log_fh, flush=True)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.bind, args.port))
    server.listen(64)
    actual_port = server.getsockname()[1]

    if args.ready_file:
        with open(args.ready_file, "w") as f:
            f.write(str(actual_port))
    log(f"listening on {args.bind}:{actual_port}, allowlist={args.allow}")

    try:
        while True:
            client, _addr = server.accept()
            threading.Thread(
                target=_handle, args=(client, args.allow, log), daemon=True
            ).start()
    except KeyboardInterrupt:
        return 0
    finally:
        server.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
