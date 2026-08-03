/**
 * Fixed P4 CLI parameters: paths and the launch model/thinking used for the
 * main session role. Subagent roles are not passed explicit overrides here —
 * the same-model manifest pins every active role to the same model/thinking
 * as main, and pi-subagents' builtin agents inherit the parent session's
 * model/thinking by default when their frontmatter sets neither (verified:
 * agents/investigator.md, agents/debugger.md, agents/verifier.md set neither).
 * A production-stack manifest with per-role model overrides is out of scope
 * for this CLI; see P1-10/docs for that series.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_ROOT = resolve(HERE, "..", "..");
export const GLOBAL_PI_BIN = join(homedir(), ".npm-global", "bin", "pi");
