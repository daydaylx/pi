import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(guiDir, "..");
const localPi = path.join(repo, "npm", "node_modules", ".bin", "pi");
const piPath = process.env.PI_GUI_DIALOG_SMOKE_PI || localPi;
const wrapper = path.join(guiDir, "test", "dialog-pi-wrapper.sh");
const fixture = path.join(
  guiDir,
  "test",
  "fixtures",
  "rpc-dialog-extension.mjs",
);
const launcher = path.join(repo, "bin", "pi-gui");

for (const file of [piPath, wrapper, fixture, launcher]) {
  if (!existsSync(file)) throw new Error(`Dialog-Smoke-Datei fehlt: ${file}`);
}

function runDialogSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn("xvfb-run", ["-a", launcher, "--smoke-dialogs"], {
      cwd: repo,
      env: {
        ...process.env,
        PI_GUI_PI_PATH: wrapper,
        PI_GUI_DIALOG_SMOKE_PI: piPath,
        PI_GUI_DIALOG_SMOKE_EXTENSION: fixture,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => `${current}${chunk}`.slice(-8_000);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Dialog-Smoke-Timeout nach 45 Sekunden"));
    }, 45_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `Dialog-Smoke beendet (code=${code}, signal=${signal ?? "-"})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

try {
  const output = await runDialogSmoke();
  if (!/SMOKE PASS \(dialogs;/.test(output)) {
    throw new Error(`Dialog-Smoke meldete keinen PASS\n${output}`);
  }
  console.log(output.trim());
} catch (error) {
  console.error(`DIALOG SMOKE FAIL: ${error.message ?? error}`);
  process.exitCode = 1;
}
