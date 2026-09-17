// Reference fixtures and error-contract regressions for
// shared/workspace-snapshot.mjs (F-01/F-02/F-03 phase 1).
//
// The fingerprints below were captured by running the pre-fix synchronous
// implementation (execFileSync, no maxBuffer) and the streaming replacement
// side by side against identical fixture repos and comparing their output
// byte for byte — not merely asserted. All nine scenarios the old
// implementation could complete at all produced an identical SHA-256, which
// is the proof that switching stdout consumption from a materialized string
// to chunk-by-chunk hashing does not change what gets hashed. The two large
// scenarios could never be captured from the old implementation — it threw
// ENOBUFS on both — which is exactly the defect this phase closes.
//
// SNAP-001 re-froze every value below: WORKSPACE_SNAPSHOT_SCHEMA_VERSION
// moved "1" -> "2" (part of the hashed fingerprint input by design), which
// alone invalidates every prior fingerprint regardless of whether a given
// fixture configures a textconv/external-diff driver. None of these 11
// fixtures does, so the --no-textconv addition itself changed none of their
// raw diff bytes — confirmed by diffing old vs. new values against a run on
// unmodified `main` before applying the SNAP-001 code change.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { collectWorkspaceSnapshot } from "../../../shared/workspace-snapshot.mjs";

// Fixed author/committer identity and date: a commit hash folds in both, so
// leaving them to the ambient git config/clock would make every fingerprint
// fixture below different on every run and every machine.
const FIXTURE_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Workspace Snapshot Test",
  GIT_AUTHOR_EMAIL: "workspace-snapshot@example.test",
  GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Workspace Snapshot Test",
  GIT_COMMITTER_EMAIL: "workspace-snapshot@example.test",
  GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
};

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: FIXTURE_GIT_ENV,
  });
}

// Runs the same raw-diff shape collectWorkspaceSnapshot's patch hashes are
// built from, but with the caller's own extraArgs — used to prove a fixture
// actually depends on a textconv/external-diff driver (omitting
// --no-textconv reproduces the pre-SNAP-001 vulnerable hash) rather than
// merely asserting today's fixed behavior in isolation.
function rawDiffHash(ws, extraArgs) {
  const out = execFileSync("git", ["diff", ...extraArgs, "--binary", "-M"], {
    cwd: ws,
    env: FIXTURE_GIT_ENV,
  });
  return createHash("sha256").update(out).digest("hex");
}

// A textconv/external-diff driver that ignores its input and always emits
// the same constant text — the simplest possible stand-in for a real
// filter (e.g. one that redacts secrets or decodes a binary format) that
// can legitimately map different content onto identical diff output. Pure
// Node, no external interpreter, so it runs unmodified on every supported
// platform (global rule: portability).
function writeConstantOutputDriver(ws, name) {
  const scriptPath = path.join(ws, name);
  writeFileSync(
    scriptPath,
    "#!/usr/bin/env node\nprocess.stdout.write('CONSTANT-DRIVER-OUTPUT\\n');\n",
  );
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;
}

function makeRepo(prefix) {
  const workspace = mkdtempSync(
    path.join(tmpdir(), `pi-workspace-snapshot-${prefix}-`),
  );
  git(workspace, ["init", "--quiet"]);
  return workspace;
}

const FINGERPRINT_FIXTURES = [
  {
    name: "clean",
    build(ws) {
      writeFileSync(path.join(ws, "base.txt"), "base\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
    },
    fingerprint:
      "e284ae4e4f09a610b08df4bc32f8b92fc05f05208b5af92cc3e1b54b6edfb5d3",
  },
  {
    name: "staged",
    build(ws) {
      writeFileSync(path.join(ws, "base.txt"), "base\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      writeFileSync(path.join(ws, "base.txt"), "changed\n");
      git(ws, ["add", "base.txt"]);
    },
    fingerprint:
      "06b2296e461aa602997656d815f5925a2a89946a12318bf2214f5e8f96dfa5d9",
  },
  {
    name: "unstaged",
    build(ws) {
      writeFileSync(path.join(ws, "base.txt"), "base\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      writeFileSync(path.join(ws, "base.txt"), "changed\n");
    },
    fingerprint:
      "7d661583ec0dd3ae413e741c300569bf8e635f8e16d3b07f12124d90a7a553ac",
  },
  {
    name: "staged+unstaged",
    build(ws) {
      writeFileSync(path.join(ws, "a.txt"), "a\n");
      writeFileSync(path.join(ws, "b.txt"), "b\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      writeFileSync(path.join(ws, "a.txt"), "a-changed\n");
      git(ws, ["add", "a.txt"]);
      writeFileSync(path.join(ws, "b.txt"), "b-changed\n");
    },
    fingerprint:
      "c85e2d7a1d9289c201efa464af1a23e3fa5cbc75c869d3dd18721f1108006dd3",
  },
  {
    name: "rename",
    build(ws) {
      writeFileSync(
        path.join(ws, "old.txt"),
        "content that is long enough to be detected as a rename by git's similarity heuristic\n",
      );
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      git(ws, ["mv", "old.txt", "new.txt"]);
    },
    fingerprint:
      "38b4ee529e858ead37c18c9cc44bb2f42c82268f95b27c5d71c29598b5dba63e",
  },
  {
    name: "delete",
    build(ws) {
      writeFileSync(path.join(ws, "gone.txt"), "gone\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      git(ws, ["rm", "-q", "gone.txt"]);
    },
    fingerprint:
      "15b5219295965b9a304fe1d5cb05b9bacc6a3d3de891b78e4c1fffe85c06ab5d",
  },
  {
    name: "untracked text file",
    build(ws) {
      writeFileSync(path.join(ws, "base.txt"), "base\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      writeFileSync(path.join(ws, "loose.txt"), "untracked content\n");
    },
    fingerprint:
      "df56029010962d5ca07c408a063fa5920bf632bb6525d0cc2d8740f2ee4c4e20",
  },
  {
    name: "symlink",
    build(ws) {
      writeFileSync(path.join(ws, "base.txt"), "base\n");
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      symlinkSync("base.txt", path.join(ws, "link.txt"));
    },
    fingerprint:
      "87f43e6e5ffebeec9636d829cc93f1d763dbad9f3013eff2c00d95f641e720b6",
  },
  {
    name: "small binary diff (Base85 patch bytegleichheit)",
    build(ws) {
      writeFileSync(
        path.join(ws, "blob.bin"),
        Buffer.from([0, 1, 2, 3, 255, 254, 253]),
      );
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      writeFileSync(
        path.join(ws, "blob.bin"),
        Buffer.from([9, 8, 7, 6, 0, 0, 0]),
      );
    },
    fingerprint:
      "2bb599c9beb92bfec840a2bd2c86c594d3d00ee981eca7ecdde2383dbe4c04df",
  },
  {
    // >350 KB changed text: the old execFileSync implementation threw
    // ENOBUFS here (F-01/F-02's root cause). No "old" fingerprint exists to
    // compare against — a real fingerprint coming back at all is the
    // regression proof.
    name: "large text diff (>350 KB changed, previously ENOBUFS)",
    build(ws) {
      const base = [];
      for (let i = 0; i < 15000; i += 1)
        base.push(`line ${i} ${"x".repeat(30)}`);
      writeFileSync(path.join(ws, "big.txt"), `${base.join("\n")}\n`);
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      const changed = [];
      for (let i = 0; i < 15000; i += 1)
        changed.push(`line ${i} CHANGED ${"y".repeat(30)}`);
      writeFileSync(path.join(ws, "big.txt"), `${changed.join("\n")}\n`);
    },
    fingerprint:
      "17d6b118e2b7eabd01f51392a05f8d0a2a05039c6ed350390def49af553c353b",
  },
  {
    // ~900 KB binary diff: same previously-ENOBUFS'd class as above, via the
    // Base85 patch-encoding path instead of plain text.
    name: "large binary diff (~900 KB, previously ENOBUFS)",
    build(ws) {
      writeFileSync(path.join(ws, "blob.bin"), Buffer.alloc(900_000, 1));
      git(ws, ["add", "-A"]);
      git(ws, ["commit", "-q", "-m", "base"]);
      writeFileSync(path.join(ws, "blob.bin"), Buffer.alloc(900_000, 2));
    },
    fingerprint:
      "a489277070b30f7ebedf6074c5099b415459fbd165f2ebc88c1a026191a893e0",
  },
];

export const workspaceSnapshotSections = {
  "workspace snapshot fingerprint stability": async (context) => {
    const { section } = context;
    await section("workspace snapshot fingerprint stability", async () => {
      for (const fixture of FINGERPRINT_FIXTURES) {
        const ws = makeRepo(fixture.name.replace(/[^a-z0-9]+/gi, "-"));
        try {
          fixture.build(ws);
          const result = await collectWorkspaceSnapshot(ws);
          assert(
            result.ok,
            `${fixture.name}: snapshot collection succeeds (${
              result.ok ? "" : `${result.error.code}: ${result.error.message}`
            })`,
          );
          if (!result.ok) continue;
          eq(
            result.snapshot.fingerprint,
            fixture.fingerprint,
            `${fixture.name}: fingerprint matches the frozen reference value`,
          );
        } finally {
          rmSync(ws, { recursive: true, force: true });
        }
      }
    });
  },

  "workspace snapshot error categories": async (context) => {
    const { section } = context;
    await section("workspace snapshot error categories", async () => {
      // no_repository: no .git at all.
      const noRepo = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-norepo-"),
      );
      try {
        const result = await collectWorkspaceSnapshot(noRepo);
        assert(!result.ok, "a directory with no .git is never ok:true");
        eq(
          result.ok ? undefined : result.error.code,
          "no_repository",
          "a missing repository is classified as no_repository, not a generic failure",
        );
      } finally {
        rmSync(noRepo, { recursive: true, force: true });
      }

      // git_unavailable: git cannot be found on PATH. Scoped tightly and
      // restored in finally — tests run strictly sequentially (tests/run.mjs
      // awaits one section at a time), so this is safe.
      const gitUnavailableRepo = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-nogit-"),
      );
      const originalPath = process.env.PATH;
      // An empty string is not enough: glibc's execvp falls back to a system
      // default path (confstr(_CS_PATH), typically /bin:/usr/bin) when PATH
      // is empty, so git is still found. A PATH pointing at a real-but-
      // git-free directory has no such fallback.
      const emptyPathDir = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-empty-path-"),
      );
      try {
        process.env.PATH = emptyPathDir;
        const result = await collectWorkspaceSnapshot(gitUnavailableRepo);
        assert(!result.ok, "an unresolvable git binary is never ok:true");
        eq(
          result.ok ? undefined : result.error.code,
          "git_unavailable",
          "a git binary that cannot be spawned is classified as git_unavailable",
        );
      } finally {
        process.env.PATH = originalPath;
        rmSync(gitUnavailableRepo, { recursive: true, force: true });
        rmSync(emptyPathDir, { recursive: true, force: true });
      }

      // Error messages must never leak file content or patch text — only a
      // bounded, operational git error description.
      const corrupt = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-corrupt-"),
      );
      try {
        git(corrupt, ["init", "--quiet"]);
        writeFileSync(
          path.join(corrupt, "secret.txt"),
          "sk-super-secret-token\n",
        );
        git(corrupt, ["add", "-A"]);
        git(corrupt, ["commit", "-q", "-m", "base"]);
        writeFileSync(path.join(corrupt, ".git", "HEAD"), "not a valid ref\n");
        const result = await collectWorkspaceSnapshot(corrupt);
        assert(!result.ok, "a corrupted .git/HEAD is never ok:true");
        if (!result.ok) {
          assert(
            !result.error.message.includes("sk-super-secret-token"),
            "the error message never includes tracked file content",
          );
        }
      } finally {
        rmSync(corrupt, { recursive: true, force: true });
      }
    });
  },

  "workspace snapshot mutation during capture": async (context) => {
    const { section } = context;
    await section("workspace snapshot mutation during capture", async () => {
      // A mutation that stops after one retry: the snapshot still succeeds,
      // against the state present once the workspace settled.
      const flaky = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-flaky-"),
      );
      try {
        git(flaky, ["init", "--quiet"]);
        writeFileSync(path.join(flaky, "base.txt"), "base\n");
        git(flaky, ["add", "-A"]);
        git(flaky, ["commit", "-q", "-m", "base"]);
        let mutated = false;
        const result = await collectWorkspaceSnapshot(flaky, {
          onAttemptState(attempt) {
            if (attempt === 1 && !mutated) {
              mutated = true;
              writeFileSync(path.join(flaky, "raced.txt"), "raced\n");
            }
          },
        });
        assert(
          result.ok,
          "a single mid-capture mutation is retried and eventually succeeds",
        );
        if (result.ok) {
          assert(
            result.snapshot.untracked.includes("raced.txt"),
            "the successful retry reflects the post-mutation state, not a mix of before/after",
          );
        }
      } finally {
        rmSync(flaky, { recursive: true, force: true });
      }

      // Regression for a reviewer-found gap: a content-only edit to an
      // *already*-modified file (still status "M", same added/removed line
      // count as the prior edit) must still be detected — name-status and
      // numstat alone cannot see it, only the contentStamp() mtime/size
      // check can.
      const contentRace = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-contentrace-"),
      );
      try {
        git(contentRace, ["init", "--quiet"]);
        writeFileSync(path.join(contentRace, "already-dirty.txt"), "base\n");
        git(contentRace, ["add", "-A"]);
        git(contentRace, ["commit", "-q", "-m", "base"]);
        writeFileSync(
          path.join(contentRace, "already-dirty.txt"),
          "first edit\n",
        );
        let attempts = 0;
        let mutatedAgain = false;
        const result = await collectWorkspaceSnapshot(contentRace, {
          onAttemptState(attempt) {
            attempts += 1;
            if (attempt === 1 && !mutatedAgain) {
              mutatedAgain = true;
              writeFileSync(
                path.join(contentRace, "already-dirty.txt"),
                "second edit same linecount\n",
              );
            }
          },
        });
        assert(
          result.ok,
          "a same-status content edit mid-capture is retried and eventually succeeds",
        );
        assert(
          attempts > 1,
          "the content-only mutation forces at least one retry rather than being silently folded into the first attempt's patch hash",
        );
      } finally {
        rmSync(contentRace, { recursive: true, force: true });
      }

      // A workspace that never settles exhausts the retry budget and reports
      // unstable_workspace instead of returning an inconsistent snapshot.
      const chaotic = mkdtempSync(
        path.join(tmpdir(), "pi-workspace-snapshot-chaotic-"),
      );
      try {
        git(chaotic, ["init", "--quiet"]);
        writeFileSync(path.join(chaotic, "base.txt"), "base\n");
        git(chaotic, ["add", "-A"]);
        git(chaotic, ["commit", "-q", "-m", "base"]);
        let counter = 0;
        const result = await collectWorkspaceSnapshot(chaotic, {
          maxAttempts: 3,
          onAttemptState() {
            counter += 1;
            writeFileSync(path.join(chaotic, `churn-${counter}.txt`), "x\n");
          },
        });
        assert(
          !result.ok,
          "a workspace that keeps changing on every attempt never returns ok:true",
        );
        eq(
          result.ok ? undefined : result.error.code,
          "unstable_workspace",
          "exhausting the retry budget is classified as unstable_workspace",
        );
        eq(
          counter,
          3,
          "exactly maxAttempts attempts were made, never unbounded retry",
        );
      } finally {
        rmSync(chaotic, { recursive: true, force: true });
      }
    });
  },

  "workspace snapshot content identity (textconv/ext-diff independence)":
    async (context) => {
      const { section } = context;
      await section(
        "workspace snapshot content identity (textconv/ext-diff independence)",
        async () => {
          // 1. Two different raw contents that a textconv driver maps onto
          // the same diff output must still produce two different
          // fingerprints (SNAP-001's core regression). rawDiffHash without
          // --no-textconv reproduces the pre-fix vulnerable hash on the
          // same fixture, proving the collision is real, not hypothetical.
          const ab = makeRepo("textconv-ab");
          try {
            writeFileSync(
              path.join(ab, ".gitattributes"),
              "*.secret diff=redact\n",
            );
            writeFileSync(path.join(ab, "file.secret"), "base\n");
            git(ab, ["add", "-A"]);
            git(ab, ["commit", "-q", "-m", "base"]);
            const driver = writeConstantOutputDriver(ab, "textconv-redact.js");
            execFileSync("git", ["config", "diff.redact.textconv", driver], {
              cwd: ab,
              env: FIXTURE_GIT_ENV,
            });

            writeFileSync(path.join(ab, "file.secret"), "content-one\n");
            const vulnerableA = rawDiffHash(ab, ["--no-ext-diff"]);
            const fixedA = rawDiffHash(ab, ["--no-ext-diff", "--no-textconv"]);
            const snapA = await collectWorkspaceSnapshot(ab);

            execFileSync("git", ["checkout", "--", "file.secret"], {
              cwd: ab,
              env: FIXTURE_GIT_ENV,
            });
            writeFileSync(
              path.join(ab, "file.secret"),
              "content-two-different\n",
            );
            const vulnerableB = rawDiffHash(ab, ["--no-ext-diff"]);
            const fixedB = rawDiffHash(ab, ["--no-ext-diff", "--no-textconv"]);
            const snapB = await collectWorkspaceSnapshot(ab);

            eq(
              vulnerableA,
              vulnerableB,
              "sanity check: the fixture's textconv driver really does collide two different raw contents onto the same diff bytes without --no-textconv",
            );
            assert(
              fixedA !== fixedB,
              "the same two contents produce different raw diff hashes once --no-textconv is added — this is exactly what collectWorkspaceSnapshot now does",
            );
            assert(
              snapA.ok && snapB.ok,
              "snapshot collection succeeds for both textconv-driven states",
            );
            if (snapA.ok && snapB.ok) {
              assert(
                snapA.snapshot.fingerprint !== snapB.snapshot.fingerprint,
                "two different raw contents with identical textconv output produce different fingerprints",
              );
            }
          } finally {
            rmSync(ab, { recursive: true, force: true });
          }

          // 2. --no-ext-diff must actually suppress the external diff
          // driver's output from the hash, not merely be present alongside
          // a driver that is never invoked in this fixture shape.
          const extDiff = makeRepo("ext-diff");
          try {
            writeFileSync(path.join(extDiff, "base.txt"), "base\n");
            git(extDiff, ["add", "-A"]);
            git(extDiff, ["commit", "-q", "-m", "base"]);
            const marker = path.join(extDiff, "ext-diff-invoked.marker");
            const scriptPath = path.join(extDiff, "ext-diff-driver.js");
            writeFileSync(
              scriptPath,
              `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(
                marker,
              )}, 'invoked');\nprocess.stdout.write('EXTERNAL-DIFF-OUTPUT\\n');\n`,
            );
            const originalExternalDiff = process.env.GIT_EXTERNAL_DIFF;
            try {
              process.env.GIT_EXTERNAL_DIFF = `${process.execPath} ${scriptPath}`;
              writeFileSync(path.join(extDiff, "base.txt"), "changed\n");
              const result = await collectWorkspaceSnapshot(extDiff);
              assert(
                result.ok,
                "snapshot collection succeeds with GIT_EXTERNAL_DIFF configured",
              );
              assert(
                !existsSync(marker),
                "--no-ext-diff means the external diff driver is never invoked at all",
              );
              if (result.ok) {
                const reference = await collectWorkspaceSnapshot(extDiff);
                eq(
                  result.snapshot.fingerprint,
                  reference.snapshot.fingerprint,
                  "the fingerprint is unaffected by GIT_EXTERNAL_DIFF being set in the environment",
                );
              }
            } finally {
              if (originalExternalDiff === undefined)
                delete process.env.GIT_EXTERNAL_DIFF;
              else process.env.GIT_EXTERNAL_DIFF = originalExternalDiff;
            }
          } finally {
            rmSync(extDiff, { recursive: true, force: true });
          }

          // 3. Same textconv collision, but through the --binary path for a
          // genuinely binary file, and with attributes set locally in
          // .git/info/attributes instead of a versioned .gitattributes —
          // machine-local attributes must not be able to mask content
          // changes either.
          const binTextconv = makeRepo("binary-textconv");
          try {
            writeFileSync(
              path.join(binTextconv, ".git", "info", "attributes"),
              "*.bin diff=redact-binary\n",
            );
            writeFileSync(
              path.join(binTextconv, "blob.bin"),
              Buffer.from([0, 1, 2, 3]),
            );
            git(binTextconv, ["add", "-A"]);
            git(binTextconv, ["commit", "-q", "-m", "base"]);
            const driver = writeConstantOutputDriver(
              binTextconv,
              "textconv-redact-binary.js",
            );
            execFileSync(
              "git",
              ["config", "diff.redact-binary.textconv", driver],
              { cwd: binTextconv, env: FIXTURE_GIT_ENV },
            );

            writeFileSync(
              path.join(binTextconv, "blob.bin"),
              Buffer.from([9, 8, 7, 6]),
            );
            const snapBinA = await collectWorkspaceSnapshot(binTextconv);
            execFileSync("git", ["checkout", "--", "blob.bin"], {
              cwd: binTextconv,
              env: FIXTURE_GIT_ENV,
            });
            writeFileSync(
              path.join(binTextconv, "blob.bin"),
              Buffer.from([5, 4, 3, 2]),
            );
            const snapBinB = await collectWorkspaceSnapshot(binTextconv);
            assert(
              snapBinA.ok && snapBinB.ok,
              "snapshot collection succeeds for binary content behind a .git/info/attributes-configured textconv driver",
            );
            if (snapBinA.ok && snapBinB.ok) {
              assert(
                snapBinA.snapshot.fingerprint !== snapBinB.snapshot.fingerprint,
                "two different binary contents behind a local (non-versioned) textconv driver still produce different fingerprints",
              );
            }
          } finally {
            rmSync(binTextconv, { recursive: true, force: true });
          }

          // 4. A gitlink (submodule-shaped index entry, mode 160000) must
          // not crash snapshot collection, and a changed pointer SHA must
          // change the fingerprint.
          const gitlink = makeRepo("gitlink");
          try {
            writeFileSync(path.join(gitlink, "base.txt"), "base\n");
            git(gitlink, ["add", "-A"]);
            git(gitlink, ["commit", "-q", "-m", "base"]);
            const shaA = "a".repeat(40);
            const shaB = "b".repeat(40);
            git(gitlink, [
              "update-index",
              "--add",
              "--cacheinfo",
              `160000,${shaA},submod`,
            ]);
            const snapLinkA = await collectWorkspaceSnapshot(gitlink);
            git(gitlink, [
              "update-index",
              "--cacheinfo",
              `160000,${shaB},submod`,
            ]);
            const snapLinkB = await collectWorkspaceSnapshot(gitlink);
            assert(
              snapLinkA.ok && snapLinkB.ok,
              "a gitlink (submodule-shaped, mode 160000) index entry never crashes snapshot collection",
            );
            if (snapLinkA.ok && snapLinkB.ok) {
              assert(
                snapLinkA.snapshot.fingerprint !==
                  snapLinkB.snapshot.fingerprint,
                "a changed gitlink pointer SHA changes the fingerprint",
              );
            }
          } finally {
            rmSync(gitlink, { recursive: true, force: true });
          }

          // 5. A mode-only change (chmod +x) with byte-identical content
          // must change the fingerprint — proof that mode is carried by the
          // raw patch stream itself, with no separate mode field needed.
          if (process.platform !== "win32") {
            const modeOnly = makeRepo("mode-only");
            try {
              const filePath = path.join(modeOnly, "script.sh");
              writeFileSync(filePath, "#!/bin/sh\necho hi\n");
              git(modeOnly, ["add", "-A"]);
              git(modeOnly, ["commit", "-q", "-m", "base"]);
              const clean = await collectWorkspaceSnapshot(modeOnly);
              chmodSync(filePath, 0o755);
              const executable = await collectWorkspaceSnapshot(modeOnly);
              assert(
                clean.ok && executable.ok,
                "snapshot collection succeeds before and after a mode-only change",
              );
              if (clean.ok && executable.ok) {
                assert(
                  clean.snapshot.fingerprint !==
                    executable.snapshot.fingerprint,
                  "a chmod-only change with unchanged content still changes the fingerprint",
                );
              }
            } finally {
              rmSync(modeOnly, { recursive: true, force: true });
            }
          }

          // 6. Determinism: two calls against the exact same, unchanging
          // workspace must produce the exact same fingerprint (the
          // documented serialization contract, checked directly rather than
          // only implied by the frozen fixtures above).
          const deterministic = makeRepo("deterministic");
          try {
            writeFileSync(path.join(deterministic, "a.txt"), "a\n");
            writeFileSync(path.join(deterministic, "b.txt"), "b\n");
            git(deterministic, ["add", "-A"]);
            git(deterministic, ["commit", "-q", "-m", "base"]);
            writeFileSync(path.join(deterministic, "a.txt"), "a-changed\n");
            git(deterministic, ["add", "a.txt"]);
            writeFileSync(path.join(deterministic, "b.txt"), "b-changed\n");
            writeFileSync(path.join(deterministic, "c.txt"), "untracked\n");
            const first = await collectWorkspaceSnapshot(deterministic);
            const second = await collectWorkspaceSnapshot(deterministic);
            assert(
              first.ok && second.ok,
              "repeated snapshot collection against an unchanging workspace succeeds both times",
            );
            if (first.ok && second.ok) {
              eq(
                first.snapshot.fingerprint,
                second.snapshot.fingerprint,
                "two calls against the identical, unchanging workspace produce the identical fingerprint",
              );
            }
          } finally {
            rmSync(deterministic, { recursive: true, force: true });
          }
        },
      );
    },
};
