#!/usr/bin/env node
// Preflight 2: captures the Codex CLI pre-benchmark facts required by
// Auftrag Abschnitt 4, without ever printing auth token/secret values.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GLOBAL_CODEX_BIN } from "../config.mjs";

// spawnSync (not execFileSync) so both stdout and stderr are captured
// explicitly — several codex subcommands (e.g. `login status`) print their
// human-readable result to stderr, not stdout.
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error) return `<error: ${result.error.message}>`;
  return combined;
}

function main() {
  const version = run(GLOBAL_CODEX_BIN, ["--version"]);
  const doctor = run(GLOBAL_CODEX_BIN, ["doctor"]);
  const loginStatus = run(GLOBAL_CODEX_BIN, ["login", "status"]);
  const installedPath = existsSync(GLOBAL_CODEX_BIN)
    ? realpathSync(GLOBAL_CODEX_BIN)
    : null;

  const configPath = join(homedir(), ".codex", "config.toml");
  const configToml = existsSync(configPath)
    ? readFileSync(configPath, "utf8")
    : null;

  const authPath = join(homedir(), ".codex", "auth.json");
  let authKeys = null;
  if (existsSync(authPath)) {
    try {
      authKeys = Object.keys(JSON.parse(readFileSync(authPath, "utf8")));
    } catch {
      authKeys = ["<unreadable>"];
    }
  }

  const report = {
    capturedAt: new Date().toISOString(),
    cliVersion: version,
    cliVersionPinnedNote:
      "Pinned for the entire P5-LUNA-HARNESS series; a newer version may be available (see doctorOutput) but must not be installed mid-series (Auftrag Abschnitt 4).",
    installedPath,
    doctorOutput: doctor,
    loginStatus,
    authJsonTopLevelKeys: authKeys,
    globalConfigTomlRaw: configToml,
    globalConfigNote:
      "Captured for documentation only — P5 never runs against this global config.toml; every P5 run uses an isolated CODEX_HOME with no config.toml and explicit -m/-c/-s/-a flags instead (see launch-codex.mjs).",
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
