import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadRecentProjects,
  rememberProject,
} from "../main/recent-projects.js";

function withStore(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-gui-recent-projects-"));
  const storeFile = path.join(root, "nested", "recent-projects.json");
  const previous = process.env.PI_GUI_RECENT_PROJECTS_FILE;
  process.env.PI_GUI_RECENT_PROJECTS_FILE = storeFile;
  try {
    return fn(root);
  } finally {
    if (previous === undefined) delete process.env.PI_GUI_RECENT_PROJECTS_FILE;
    else process.env.PI_GUI_RECENT_PROJECTS_FILE = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test("ohne Datei liefert loadRecentProjects eine leere Liste", () => {
  withStore(() => {
    assert.deepEqual(loadRecentProjects(), []);
  });
});

test("rememberProject persistiert und loadRecentProjects liest es zurück", () => {
  withStore((root) => {
    const project = mkdtempSync(path.join(root, "proj-"));
    rememberProject(project);
    const recent = loadRecentProjects();
    assert.equal(recent.length, 1);
    assert.equal(recent[0].path, project);
  });
});

test("erneutes Merken desselben Pfads dedupliziert (Upsert)", () => {
  withStore((root) => {
    const project = mkdtempSync(path.join(root, "proj-"));
    rememberProject(project);
    rememberProject(project);
    const recent = loadRecentProjects();
    assert.equal(recent.length, 1);
  });
});

test("Liste ist auf 10 Einträge gedeckelt, neueste zuerst", () => {
  withStore((root) => {
    const projects = Array.from({ length: 12 }, () =>
      mkdtempSync(path.join(root, "proj-")),
    );
    for (const project of projects) {
      rememberProject(project);
    }
    const recent = loadRecentProjects();
    assert.equal(recent.length, 10);
    // Die zuletzt gemerkten (letzten 10) müssen enthalten sein, die
    // ältesten zwei sind rausgefallen.
    const recentPaths = new Set(recent.map((entry) => entry.path));
    assert.ok(recentPaths.has(projects.at(-1)));
    assert.ok(!recentPaths.has(projects[0]));
  });
});

test("nicht mehr existierende Projektverzeichnisse werden herausgefiltert", () => {
  withStore((root) => {
    const gone = mkdtempSync(path.join(root, "gone-"));
    const stays = mkdtempSync(path.join(root, "stays-"));
    rememberProject(gone);
    rememberProject(stays);
    rmdirSync(gone);
    const recent = loadRecentProjects();
    assert.deepEqual(
      recent.map((entry) => entry.path),
      [stays],
    );
  });
});
