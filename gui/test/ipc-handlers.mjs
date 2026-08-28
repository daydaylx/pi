import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { GuiSession, resolveSessionPath } from "../main/ipc-handlers.js";

test("Sitzungspfade bleiben nach Symlink-Auflösung im Session-Root", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-gui-sessions-"));
  const sessionRoot = path.join(root, "sessions");
  const outside = path.join(root, "outside.jsonl");
  const inside = path.join(sessionRoot, "inside.jsonl");
  const linked = path.join(sessionRoot, "linked.jsonl");
  try {
    mkdirSync(sessionRoot);
    writeFileSync(outside, "outside\n");
    writeFileSync(inside, "inside\n");
    symlinkSync(outside, linked);
    const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionRoot;
    try {
      assert.equal(resolveSessionPath(inside), inside);
      assert.equal(resolveSessionPath(linked), undefined);
      assert.equal(resolveSessionPath(outside), undefined);
    } finally {
      if (previous === undefined)
        delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = previous;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("erwarteter Shutdown lässt Hintergrund-Stats ohne IPC-Ausnahme auslaufen", async () => {
  const session = new GuiSession({
    isDestroyed: () => false,
    webContents: { send: () => {} },
  });
  session.manager = {
    running: true,
    request: async () => {
      throw new Error("Pi-Prozess beendet (code=143)");
    },
  };
  session.stopping = true;
  assert.equal(await session.getStats(), null);
});

test("laufender Manager verweigert einen widersprüchlichen Sitzungsmodus", () => {
  const session = new GuiSession({
    isDestroyed: () => false,
    webContents: { send: () => {} },
  });
  session.manager = { running: true };
  session.noSession = false;
  assert.throws(
    () => session.ensureManager({ noSession: true }),
    /Sitzungsmodus kann nicht während eines Laufs wechseln/,
  );
});
