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
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
      "b58567cd5cceff9740646bc7b9a6432e38227932543a92474ee7ef4ad275825a",
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
      "2b18123352ee0c942aa394d834c2abf7d71a16a2d0b525bbc017d62a983a90b8",
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
      "872bea5ed12c16202a3beb700bb4114c410a533e15cd713045b0142605e00160",
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
      "7347fb3fe9998be714d73e86e99aeb83db70d98de1b6dd182362bb705d5f0cf9",
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
      "5a649e24f9013bfa35a5aec7ce0401c0a2fea44e8ba967edbfd25ccd550f53bc",
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
      "7028a98569690d8dfab8ca2b2f17ed3eaa7d0d98cd6512d78e3d26e4af80d805",
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
      "7305b0e46552000f59d19bdf518e0dfb1083a91ff4131c49c34bbad0bd3011de",
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
      "9b71ee507a4c1f94b4833f98a3f33d8cb80e69e4725b3ca0ba2d8cdea9b91996",
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
      "c44c80916d6b243a30bf8480dfe59491d1ad97d7b4d9b408da3d223431103d93",
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
      "40c19fae13bd20fa4884e392da8278e64b992cabe3deeb5eeb9b029757ac0c13",
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
      "46799f5204e2751edba928b84534581e300a8d779683a2b1ad33081534de996f",
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
};
