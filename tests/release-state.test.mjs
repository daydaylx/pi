import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { releaseState } from "../scripts/release-state.mjs";

test("release inventory separates checkout, installed files and actual process inode; never reads private state", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-release-state-"));
  try {
    const checkoutRoot = path.join(dir, "checkout");
    const installedRoot = path.join(dir, "installed");
    const procRoot = path.join(dir, "proc");
    const guiPath = path.join(dir, "gui");
    for (const root of [checkoutRoot, installedRoot]) {
      mkdirSync(
        path.join(root, "npm/node_modules/@earendil-works/pi-coding-agent"),
        { recursive: true },
      );
      mkdirSync(path.join(root, "frontend-server"));
      writeFileSync(
        path.join(root, "npm/package.json"),
        JSON.stringify({
          devDependencies: { "@earendil-works/pi-coding-agent": "1.2.0" },
        }),
      );
      writeFileSync(
        path.join(
          root,
          "npm/node_modules/@earendil-works/pi-coding-agent/package.json",
        ),
        JSON.stringify({ version: "1.3.0" }),
      );
      writeFileSync(path.join(root, "frontend-server/host.mjs"), "old bytes");
      writeFileSync(path.join(root, "auth.json"), "PRIVATE-TOKEN");
    }
    writeFileSync(
      path.join(checkoutRoot, "frontend-server/host.mjs"),
      "new bytes",
    );
    mkdirSync(path.join(procRoot, "123"), { recursive: true });
    const node = path.join(dir, "node");
    writeFileSync(node, "running executable");
    symlinkSync(node, path.join(procRoot, "123/exe"));
    writeFileSync(
      path.join(procRoot, "123/cmdline"),
      [
        "node",
        path.join(installedRoot, "frontend-server/host.mjs"),
        "PRIVATE-PROMPT",
      ].join("\0"),
    );
    const before = readFileSync(
      path.join(installedRoot, "frontend-server/host.mjs"),
      "utf8",
    );
    const report = releaseState({
      checkoutRoot,
      installedRoot,
      procRoot,
      guiPath,
    });
    assert.equal(report.checkout.declaredRuntime, "1.2.0");
    assert.equal(report.installed.runtimeOnDisk, "1.3.0");
    assert.equal(report.installed.commit, null);
    assert.equal(
      report.checkoutMatchesInstalledFiles["frontend-server/host.mjs"],
      false,
    );
    assert.equal(
      report.checkoutMatchesInstalledFiles["bin/pi"],
      null,
      "two missing files are not a match",
    );
    assert.equal(report.processes[0].kind, "host");
    assert.equal(report.processes[0].loadedSourceIdentity, "unknown");
    assert.equal(report.installed.patchExecutionStatus, "unknown");
    assert.equal(report.gui.installedPath, null);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE-TOKEN|PRIVATE-PROMPT/);
    assert.equal(
      readFileSync(
        path.join(installedRoot, "frontend-server/host.mjs"),
        "utf8",
      ),
      before,
    );
    writeFileSync(guiPath, "new wrapper");
    writeFileSync(path.join(dir, ".pisystem-wrapped"), "new GUI");
    mkdirSync(path.join(dir, "old"));
    const oldGui = path.join(dir, "old/.pisystem-wrapped");
    writeFileSync(oldGui, "old GUI");
    mkdirSync(path.join(procRoot, "124"));
    symlinkSync(oldGui, path.join(procRoot, "124/exe"));
    writeFileSync(path.join(procRoot, "124/cmdline"), "pisystem\0");
    const mismatch = releaseState({
      checkoutRoot,
      installedRoot,
      procRoot,
      guiPath,
    });
    const runningGui = mismatch.processes.find(
      (process) => process.kind === "gui",
    );
    assert.equal(runningGui.matchesInstalledExecutable, false);
    assert.equal(runningGui.loadedSourceIdentity, "executable-inode");
    writeFileSync(path.join(dir, ".pisystem-wrapped"), "old GUI");
    assert.equal(
      releaseState({
        checkoutRoot,
        installedRoot,
        procRoot,
        guiPath,
      }).processes.find((process) => process.kind === "gui")
        .matchesInstalledExecutable,
      true,
    );
    rmSync(procRoot, { recursive: true });
    assert.deepEqual(
      releaseState({ checkoutRoot, installedRoot, procRoot, guiPath })
        .processes,
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
