/**
 * P6's own private state root ("pi-p6"), separate from P5's ("pi-p5").
 * Everything else (per-run paths, private-dir helpers) is reused unchanged
 * from p5/io.mjs — none of those hardcode the "pi-p5" folder name, only
 * stateRoot() does.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function stateRoot() {
  const base = process.env.XDG_STATE_HOME
    ? resolve(process.env.XDG_STATE_HOME)
    : join(homedir(), ".local", "state");
  const state = join(base, "pi-p6");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  return state;
}

export {
  assertSafeStatePath,
  codexRunPaths,
  fail,
  piRunPaths,
  privateDir,
  readJson,
  writePrivateJson,
} from "../p5/io.mjs";
