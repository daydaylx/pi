#!/usr/bin/env node
// Preflight 1b: documents the Pi/Codex network-isolation asymmetry (see
// METHODOLOGY.md). Codex's `-s workspace-write` sandbox is Linux-kernel-
// enforced (bwrap); Pi has no equivalent OS-level sandbox for its bash tool,
// only the absence of the pi-web-access extension (removed for P5 runs by
// worktree-setup.mjs's applyP5PiOverlay).
//
// The Codex-side check below is a real, zero-cost, non-model probe (`codex
// sandbox` runs a raw command inside Codex's Linux sandbox without
// contacting any model). It is a reasonable proxy for `codex exec -s
// workspace-write`'s network policy (same underlying bwrap sandbox
// mechanism, see benchmarks/comparisons/p5-luna/ENVIRONMENT.md for the
// full note) but is not a byte-for-byte substitute for observing an actual
// `codex exec -s workspace-write` run — the smoketest's own Codex run is
// the definitive live confirmation for that exact invocation path.
//
// The Pi-side check is a static claim (no live probe, no model cost): grep
// the installed Pi runtime bundle for any OS-level sandbox primitive
// (bwrap/landlock/seccomp) wired into its own bash tool. Vendor-library
// substring hits (e.g. inside an AWS SDK chunk) do not count.
import { execFileSync } from "node:child_process";
import { GLOBAL_CODEX_BIN } from "../config.mjs";

function main() {
  let codexNetworkBlocked = null;
  let codexProbeOutput = null;
  try {
    execFileSync(
      GLOBAL_CODEX_BIN,
      [
        "sandbox",
        "--",
        "curl",
        "-sS",
        "-m",
        "5",
        "https://1.1.1.1",
        "-o",
        "/dev/null",
        "-w",
        "HTTP_CODE=%{http_code}",
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    codexNetworkBlocked = false; // curl succeeded — network was reachable
  } catch (error) {
    codexProbeOutput = error.stderr?.toString?.() ?? error.message;
    codexNetworkBlocked =
      /Couldn't connect|Failed to connect|Could not resolve/.test(
        codexProbeOutput ?? "",
      );
  }

  const report = {
    checkedAt: new Date().toISOString(),
    codex: {
      probeCommand: "codex sandbox -- curl -sS -m 5 https://1.1.1.1 ...",
      networkBlockedByDefault: codexNetworkBlocked,
      rawOutput: codexProbeOutput,
      caveat:
        "codex sandbox's own default permission profile, not a byte-for-byte proof of `codex exec -s workspace-write`'s policy. Cross-check against the smoketest's actual Codex run.",
    },
    pi: {
      osLevelNetworkSandbox: false,
      basis:
        "No bwrap/landlock/seccomp usage found wired into Pi's own bash tool (only unrelated vendor-library substring hits, e.g. inside an AWS SDK chunk, checked and excluded). Network 'off' for P5 Pi runs relies entirely on removing the pi-web-access package (applyP5PiOverlay) plus the post-hoc networkToolCallsObserved scan in p5-controller.mjs — not an OS-enforced block.",
    },
    mitigation:
      "Documented asymmetry, not eliminated: every P5 run's trace is scanned post-hoc for curl/wget/nc/ssh-shaped bash tool calls (p5-controller.mjs's scanForNetworkToolCalls) and recorded as networkToolCallsObserved in the run result, instead of assuming both sides are equally isolated.",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
