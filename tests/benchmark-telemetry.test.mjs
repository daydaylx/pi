import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(root, "benchmarks", "real-duel", "scripts");
// Kandidaten-Worktrees schliessen benchmarks/real-duel/ per sparse-checkout aus
// (pi-duel). Ohne das Verzeichnis gibt es nichts zu testen: kein Infrastrukturfehler.
if (!existsSync(scriptsDir)) {
  console.log(
    "benchmark-telemetry: uebersprungen (benchmarks/real-duel/scripts fehlt, z. B. sparse-checkout im Kandidaten-Worktree)",
  );
  process.exit(0);
}

const result = spawnSync(
  "python3",
  [
    "-m",
    "unittest",
    "discover",
    "-s",
    "benchmarks/real-duel/scripts",
    "-p",
    "test_*.py",
  ],
  {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      PI_OPENBENCH_HOME: path.join(root, ".agent", "test-deps", "openbench"),
      PYTHONDONTWRITEBYTECODE: "1",
    },
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(
    `benchmark-telemetry: INFRASTRUKTUR (${result.error.code ?? result.error.message}): python3-Lauf nicht abgeschlossen`,
  );
  throw result.error;
}
if (result.status !== 0) process.exit(result.status ?? 1);
