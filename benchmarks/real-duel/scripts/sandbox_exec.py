#!/usr/bin/env python3
"""Tier-1-Host-Isolation fuer Kandidatenlaeufe (R21 im Risikoregister).

Startet ein Kommando in einer neuen bwrap-Mount-Namespace-Sandbox, die
AUSSCHLIESSLICH den Trial-Workspace beschreibbar und eine explizite
Allowlist von Laufzeitpfaden (Node/npm-Toolchain, minimales /etc) lesbar
macht. Alles andere auf dem Host -- /home/d/desk/*, /home/d/.pi/agent,
sessions/, dist/, Fremd-Worktrees, Fremd-Repo-Clones -- ist fuer den
sandboxten Prozess schlicht nicht vorhanden, unabhaengig von Tool-Policy
oder isolate_home=false in den Candidate-Manifesten. "Nicht binden" IST
der Sperrmechanismus, keine Denyliste noetig.

Tier 2 (Netzwerk-Allowlist, damit der Kandidat nur die Model-API erreicht,
nicht aber github.com/Suchmaschinen) ist ABSICHTLICH NICHT Teil dieses
Wrappers: --unshare-net wuerde auch die Model-API-Calls blocken, die der
Harness zum Funktionieren braucht. Das Netzwerk-Namespace bleibt geteilt.
Siehe Risikoregister R02 fuer den offenen Rest.

Nutzung:
    sandbox_exec.py --workspace <pfad> --home <synthetic-home-pfad> \\
        [--ro-bind <host-pfad>]... -- <command> [args...]
"""

import argparse
import os
import subprocess
import sys

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
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)

    if not args.command or args.command[0] != "--":
        parser.error("Kommando muss mit '--' eingeleitet werden, z.B. ... -- pi --version")
    command = args.command[1:]
    if not command:
        parser.error("kein Kommando angegeben")

    bwrap_args = build_bwrap_args(
        os.path.abspath(args.workspace), os.path.abspath(args.home), args.ro_bind
    )
    return subprocess.run([*bwrap_args, *command]).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
