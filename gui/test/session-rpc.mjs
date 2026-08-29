import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiRpcManager } from "../main/pi-rpc-manager.js";

const guiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(guiDir, "..");
const sessionDir = mkdtempSync(path.join(os.tmpdir(), "pi-gui-session-rpc-"));
const previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir;

const manager = new PiRpcManager({
  piPath:
    process.env.PI_GUI_PI_PATH ||
    path.join(repo, "npm", "node_modules", ".bin", "pi"),
  cwd: repo,
});
manager.on("error", () => {});

const fixtureId = "018f0000-0000-7000-8000-000000000001";
const fixturePath = path.join(sessionDir, "resume-fixture.jsonl");
writeFileSync(
  fixturePath,
  `${JSON.stringify({
    type: "session",
    version: 3,
    id: fixtureId,
    timestamp: "2024-01-01T00:00:00.000Z",
    cwd: repo,
  })}\n`,
);

async function run() {
  manager.start();
  const first = await manager.request({ type: "get_state" });
  if (!first.sessionId) {
    throw new Error("erste isolierte Sitzung besitzt keine ID");
  }

  const created = await manager.request({ type: "new_session" });
  if (created?.cancelled)
    throw new Error("neue Sitzung wurde unerwartet abgebrochen");
  const second = await manager.request({ type: "get_state" });
  if (!second.sessionId || second.sessionId === first.sessionId) {
    throw new Error("new_session hat keine neue isolierte Sitzung erzeugt");
  }

  const switched = await manager.request({
    type: "switch_session",
    sessionPath: fixturePath,
  });
  if (switched?.cancelled)
    throw new Error("Sitzungswechsel wurde unerwartet abgebrochen");
  const resumed = await manager.request({ type: "get_state" });
  if (resumed.sessionId !== fixtureId || resumed.sessionFile !== fixturePath) {
    throw new Error(
      "switch_session hat die persistierte Fixture nicht geladen",
    );
  }

  const history = await manager.request({ type: "get_messages" });
  if (!Array.isArray(history?.messages)) {
    throw new Error("get_messages liefert keine Nachrichtenliste");
  }
  await manager.stop();
  console.log("SESSION RPC PASS (isolierte neue/resumierte Sitzung)");
}

run()
  .catch(async (error) => {
    try {
      await manager.stop();
    } catch {
      // Der ursprüngliche Fehler bleibt maßgeblich.
    }
    console.error(`SESSION RPC FAIL: ${error.message ?? error}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (previousSessionDir === undefined)
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir;
    rmSync(sessionDir, { recursive: true, force: true });
  });
