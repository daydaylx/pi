// Gives the regression run its own Pi agent directory.
//
// The verifier ticket resolves the verifier profile and its model override from
// `<agent dir>/agents/verifier.md`, `~/.agents/verifier.md` and
// `<agent dir>/settings.json`. Without this isolation the results depend on the
// installed setup of whoever runs the tests: green on a developer machine,
// 41 failures on the empty CI runner. The fixture is built from the committed
// files, so the tests exercise the repository's own configuration.
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const home = mkdtempSync(path.join(tmpdir(), "pi-test-home-"));
const agentDir = path.join(home, ".pi", "agent");
mkdirSync(path.join(agentDir, "agents"), { recursive: true });
cpSync(
  path.join(ROOT, "agents", "verifier.md"),
  path.join(agentDir, "agents", "verifier.md"),
);
cpSync(path.join(ROOT, "settings.json"), path.join(agentDir, "settings.json"));

process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
