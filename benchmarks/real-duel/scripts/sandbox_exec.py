#!/usr/bin/env python3
"""Host-Isolation fuer Kandidatenlaeufe (R21/R02 im Risikoregister).

Tier 1 (immer aktiv): startet das Kommando in einer bwrap-Mount-Namespace-
Sandbox, die AUSSCHLIESSLICH den Trial-Workspace beschreibbar und eine
explizite Allowlist von Laufzeitpfaden (Node/npm-Toolchain, minimales /etc)
lesbar macht. Alles andere auf dem Host -- /home/d/desk/*, /home/d/.pi/agent,
sessions/, dist/, Fremd-Worktrees, Fremd-Repo-Clones -- ist fuer den
sandboxten Prozess schlicht nicht vorhanden, unabhaengig von Tool-Policy
oder isolate_home=false in den Candidate-Manifesten. "Nicht binden" IST der
Sperrmechanismus, keine Denyliste noetig.

Tier 2 (Netzwerk-Allowlist, opt-in via --allow-host): der Kandidat braucht
Netzwerk fuer Model-API-Calls, darf aber github.com/Suchmaschinen/das
oeffentliche Repo nicht erreichen -- ein pauschales `bwrap --unshare-net`
wuerde auch die Model-API blocken. Stattdessen:

  1. `unshare --user --net --map-root-user` erzeugt ein neues, isoliertes
     Netzwerk-Namespace (Platzhalterprozess `sleep infinity`, damit es
     offen bleibt).
  2. `slirp4netns` haengt diesem Namespace echte (NAT'te) Konnektivitaet an
     -- der Host ist darin unter der festen Gateway-Adresse 10.0.2.2
     erreichbar.
  3. Ein lokaler CONNECT-Allowlist-Proxy (`allowlist_proxy.py`) laeuft auf
     dem HOST (ausserhalb jeder Sandbox) und laesst nur CONNECT zu den
     via --allow-host freigegebenen Hostnamen durch -- alles andere 403,
     bevor irgendeine Verbindung nach draussen aufgebaut wird.
  4. Das eigentliche Kommando laeuft via `nsenter` im selben Netzwerk-
     Namespace, zusaetzlich in der Tier-1-bwrap-Sandbox, mit
     HTTPS_PROXY/HTTP_PROXY auf `http://10.0.2.2:<proxy-port>` gesetzt.

Ohne --allow-host bleibt das Netzwerk-Namespace mit dem Host geteilt (reine
Tier-1-Dateisystem-Isolation, wie bisher).

Nutzung:
    sandbox_exec.py --workspace <pfad> --home <synthetic-home-pfad> \\
        [--ro-bind <host-pfad>]... [--allow-host <hostname>]... \\
        [--network-log <pfad>] -- <command> [args...]
"""

import argparse
import os
import select
import subprocess
import sys
import tempfile
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ALLOWLIST_PROXY = os.path.join(SCRIPT_DIR, "allowlist_proxy.py")

# Node/npm-Toolchain (System-Paket unter /usr) und globale CLI-Installationen
# (pi, codex) unter /home/d/.npm-global -- Laufzeit-Code, keine
# Benchmark-sensiblen Daten, deshalb standardmaessig lesbar freigegeben.
DEFAULT_RO_BINDS = [
    "/usr",
    "/lib",
    "/lib64",
    "/bin",
    "/sbin",
    "/etc",
    "/home/d/.npm-global",
    # /etc/resolv.conf is a symlink to the systemd-resolved stub; without this,
    # DNS resolution silently breaks and looks like network isolation even
    # though Tier 1 deliberately shares the host network namespace.
    "/run/systemd/resolve",
]


def build_bwrap_args(workspace: str, home: str, extra_ro_binds: list[str]) -> list[str]:
    args = [
        "bwrap",
        "--die-with-parent",
        "--unshare-pid",
        "--unshare-uts",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
    ]
    for src in [*DEFAULT_RO_BINDS, *extra_ro_binds]:
        if os.path.exists(src):
            args += ["--ro-bind", src, src]
    os.makedirs(home, exist_ok=True)
    os.makedirs(workspace, exist_ok=True)
    args += ["--bind", home, home]
    args += ["--bind", workspace, workspace]
    args += ["--setenv", "HOME", home]
    args += ["--chdir", workspace]
    return args


def _start_allowlist_proxy(allowed_hosts: list[str], log_path: str | None):
    """Startet allowlist_proxy.py als Hintergrundprozess auf dem HOST
    (ausserhalb jeder Sandbox) und wartet, bis er tatsaechlich lauscht."""
    ready_fd, ready_file = tempfile.mkstemp(prefix="allowlist-proxy-port-")
    os.close(ready_fd)
    os.remove(ready_file)  # nur der Name wird gebraucht; allowlist_proxy.py legt die Datei neu an
    cmd = [
        sys.executable, ALLOWLIST_PROXY,
        *[f"--allow={h}" for h in allowed_hosts],
        "--bind", "127.0.0.1", "--port", "0",
        "--ready-file", ready_file,
    ]
    if log_path:
        cmd += ["--log-file", log_path]
    proc = subprocess.Popen(cmd)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if os.path.exists(ready_file) and os.path.getsize(ready_file) > 0:
            with open(ready_file) as f:
                port = int(f.read().strip())
            os.remove(ready_file)
            return proc, port
        if proc.poll() is not None:
            raise RuntimeError("allowlist_proxy.py ist vorzeitig beendet")
        time.sleep(0.05)
    proc.kill()
    raise TimeoutError("allowlist_proxy.py wurde nicht rechtzeitig bereit")


def _wait_fd_ready(read_fd: int, timeout: float) -> None:
    ready, _, _ = select.select([read_fd], [], [], timeout)
    if not ready:
        raise TimeoutError("slirp4netns wurde nicht rechtzeitig bereit")
    os.read(read_fd, 1)


def run_network_sandboxed(
    workspace: str, home: str, extra_ro_binds: list[str],
    allowed_hosts: list[str], network_log: str | None, command: list[str],
) -> int:
    """Tier 1 + Tier 2: eigenes Netzwerk-Namespace mit NAT via slirp4netns,
    Zugriff ausschliesslich ueber den Allowlist-Proxy am festen Gateway
    10.0.2.2. Siehe Moduldocstring fuer den vollen Ablauf."""
    proxy_proc, proxy_port = _start_allowlist_proxy(allowed_hosts, network_log)
    placeholder = None
    slirp_proc = None
    try:
        placeholder = subprocess.Popen(
            ["unshare", "--user", "--net", "--map-root-user", "--", "sleep", "infinity"]
        )
        netns_pid = placeholder.pid
        # sleep infinity muss den unshare()-Syscall schon ausgefuehrt haben,
        # bevor slirp4netns dessen /proc/<pid>/ns/net anfassen kann.
        time.sleep(0.1)

        ready_r, ready_w = os.pipe()
        os.set_inheritable(ready_w, True)
        slirp_proc = subprocess.Popen(
            [
                "slirp4netns", "--configure", "--mtu=65520",
                f"--ready-fd={ready_w}", str(netns_pid), "tap0",
            ],
            pass_fds=(ready_w,),
        )
        os.close(ready_w)
        try:
            _wait_fd_ready(ready_r, timeout=10)
        finally:
            os.close(ready_r)

        bwrap_args = build_bwrap_args(workspace, home, extra_ro_binds)
        proxy_url = f"http://10.0.2.2:{proxy_port}"
        for var in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
            bwrap_args += ["--setenv", var, proxy_url]
        bwrap_args += ["--setenv", "NO_PROXY", "localhost,127.0.0.1"]

        nsenter_cmd = [
            "nsenter", "--target", str(netns_pid), "--net", "--user",
            "--preserve-credentials",
            "--", *bwrap_args, *command,
        ]
        return subprocess.run(nsenter_cmd).returncode
    finally:
        if slirp_proc is not None:
            slirp_proc.terminate()
            slirp_proc.wait(timeout=5)
        if placeholder is not None:
            placeholder.terminate()
            placeholder.wait(timeout=5)
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="einzig beschreibbarer Pfad")
    parser.add_argument("--home", required=True, help="synthetisches HOME fuer diesen Trial")
    parser.add_argument(
        "--ro-bind",
        action="append",
        default=[],
        metavar="PATH",
        help="zusaetzlicher, lesbar gebindeter Host-Pfad (z.B. Harness-Auth-Verzeichnis)",
    )
    parser.add_argument(
        "--allow-host",
        action="append",
        default=[],
        metavar="HOST",
        help="Tier 2 aktivieren: erlaubter Netzwerk-Hostname (wiederholbar). "
             "Ohne diese Option bleibt das Netzwerk mit dem Host geteilt (nur Tier 1).",
    )
    parser.add_argument(
        "--network-log",
        metavar="PATH",
        help="Datei fuer das ALLOW/DENY-Log des Allowlist-Proxys (nur mit --allow-host)",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)

    if not args.command or args.command[0] != "--":
        parser.error("Kommando muss mit '--' eingeleitet werden, z.B. ... -- pi --version")
    command = args.command[1:]
    if not command:
        parser.error("kein Kommando angegeben")

    workspace = os.path.abspath(args.workspace)
    home = os.path.abspath(args.home)

    if args.allow_host:
        return run_network_sandboxed(
            workspace, home, args.ro_bind, args.allow_host, args.network_log, command
        )

    bwrap_args = build_bwrap_args(workspace, home, args.ro_bind)
    return subprocess.run([*bwrap_args, *command]).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
