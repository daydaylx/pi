/**
 * Task input staging, the prompt and its fingerprint.
 *
 * The fingerprint makes the prompt part of the recorded run identity: two runs
 * with the same id but different prompts are not comparable.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, privateDir, writePrivateJson } from "./io.mjs";
import { stageHarnessInput } from "./worktree.mjs";

export function prepareTaskInput(worktree, run) {
  const fixture = join(worktree, "benchmarks", "tasks", run.task, "fixture");
  if (existsSync(fixture)) {
    const destination = join(worktree, "benchmark-fixture");
    cpSync(fixture, destination, { recursive: true });
    stageHarnessInput(worktree, "benchmark-fixture");
  }
  if (run.task === "09-hanging-tool-call") {
    const piDir = join(worktree, ".pi");
    privateDir(piDir);
    const lspPath = join(piDir, "lsp.json");
    writePrivateJson(lspPath, {
      languages: {
        typescript: {
          enabled: true,
          command: "python3",
          args: [join(worktree, "benchmark-fixture", "fake-lsp.py"), "--hang"],
          rootMarkers: ["package.json"],
        },
      },
    });
    stageHarnessInput(worktree, ".pi/lsp.json");
  }
}

export function taskPrompt(run, worktree) {
  if (run.task === "08-long-session-compaction") {
    return [
      "Lies extensions/lsp/server-profiles.ts und extensions/lsp/roots.ts und fasse das Zusammenspiel in eigenen Worten zusammen.",
      'Füge ein neues, standardmäßig deaktiviertes Profil zig hinzu (Server zls, rootMarkers: ["build.zig"], Sprachzuordnung .zig → { profileId: "zig", languageId: "zig" }).',
      "Ergänze einen Regressionstest analog zu den bestehenden Server-Profil-Tests in tests/run.mjs.",
      "Fasse am Ende zusammen, was in dieser Sitzung geändert wurde und ob noch etwas fehlt.",
    ];
  }
  const spec = readFileSync(join(worktree, "benchmarks", "tasks", run.task, "TASK.md"), "utf8");
  const quoted = spec
    .split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2))
    .join("\n")
    .trim();
  if (!quoted) fail(`Task ${run.task} has no quoted prompt.`);
  return [quoted];
}

export function promptFingerprint(run, worktree) {
  return createHash("sha256")
    .update(JSON.stringify({ prompts: taskPrompt(run, worktree), system: appendSystemPrompt(run) ?? null }))
    .digest("hex");
}

export function appendSystemPrompt(run) {
  if (run.variant === "without-subagent") return "Bearbeite dies vollständig selbst, ohne das subagent-Tool zu verwenden.";
  if (run.variant === "with-subagent") return "Du darfst Teilaufgaben an Subagenten delegieren, wenn das sinnvoll ist (zum Beispiel Recherche durch einen Scout).";
  if (run.task === "09-hanging-tool-call") return "Für diese Aufgabe ist die projektlokale LSP-Testkonfiguration bereits vorbereitet. Nutze extensions/diff-viewer/change-tracker.ts als Ziel für den Definitions-Lookup.";
  return undefined;
}
