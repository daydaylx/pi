import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, eq } from "../../shared/assertions.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const installerSections = {
  "installer greenfield deployment": async (context) => {
    const { section } = context;
    await section("installer greenfield deployment", async () => {
      const { ALLOWLIST, NEVER_COPY, NEVER_COPY_SUBTREE, SOURCE, collect } =
        await import(
          pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
        );

      // Greenfield: collect all files the installer would deploy, then
      // verify the target can resolve every active extension's imports.
      const deployed = ALLOWLIST.flatMap((entry) => {
        const absolute = path.join(SOURCE, entry);
        return existsSync(absolute) ? collect(SOURCE, entry) : [];
      });

      const deployedSet = new Set(deployed);

      // shared/workspace-snapshot.mjs is required by setup-core at runtime.
      assert(
        deployedSet.has("shared/workspace-snapshot.mjs"),
        "greenfield includes shared/workspace-snapshot.mjs",
      );

      // Custom subagent description must be installed.
      assert(
        deployedSet.has("subagent-tool-description.md"),
        "greenfield includes the agent-level custom subagent description",
      );
      assert(
        !deployedSet.has(".pi/subagent-tool-description.md"),
        "greenfield does not deploy the retired agent-shipped .pi description",
      );

      assert(
        deployedSet.has("APPEND_SYSTEM.md"),
        "greenfield includes the active communication rules",
      );
      for (const prompt of ["analyse.md", "docs-check.md", "review.md", "ui-review.md"]) {
        assert(
          deployedSet.has(`prompts/${prompt}`),
          `greenfield includes prompt template prompts/${prompt}`,
        );
      }

      // Exactly three agent profiles.
      const agentFiles = deployed.filter((f) => f.startsWith("agents/"));
      eq(
        agentFiles.length,
        3,
        "greenfield installs exactly three agent profiles",
      );
      for (const role of ["investigator.md", "debugger.md", "verifier.md"]) {
        assert(
          deployedSet.has(`agents/${role}`),
          `greenfield includes agents/${role}`,
        );
      }

      // No legacy agent profiles.
      for (const legacy of ["planner.md", "worker.md", "reviewer.md"]) {
        assert(
          !deployedSet.has(`agents/${legacy}`),
          `greenfield does not include legacy agents/${legacy}`,
        );
      }

      // Archive session logs must not be deployed. Match on a path boundary,
      // not a raw string prefix - docs/archive/session-logs.md is a policy
      // note (not a log), and a plain startsWith() would false-positive on
      // it merely because it shares a prefix with the excluded directory.
      const archiveFiles = deployed.filter(
        (f) =>
          f === "docs/archive/session-logs" ||
          f.startsWith("docs/archive/session-logs/"),
      );
      eq(
        archiveFiles.length,
        0,
        "greenfield excludes docs/archive/session-logs",
      );

      // Security: NEVER_COPY entries must not appear in deployed files.
      for (const forbidden of NEVER_COPY) {
        const violations = deployed.filter(
          (f) => f.startsWith(forbidden + "/") || f === forbidden,
        );
        eq(
          violations.length,
          0,
          `greenfield excludes NEVER_COPY entry ${forbidden}`,
        );
      }

      // Security: NEVER_COPY_SUBTREE entries must not appear. Path-boundary
      // match, same reasoning as the docs/archive/session-logs check above.
      for (const subtree of NEVER_COPY_SUBTREE) {
        const violations = deployed.filter(
          (f) => f === subtree || f.startsWith(subtree + "/"),
        );
        eq(
          violations.length,
          0,
          `greenfield excludes NEVER_COPY_SUBTREE entry ${subtree}`,
        );
      }

      // Verify real deployment to a temporary target works.
      const target = mkdtempSync(path.join(tmpdir(), "pi-install-greenfield-"));
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "install-user.mjs"),
            "--apply",
            "--target",
            target,
          ],
          { stdio: "pipe", timeout: 30_000 },
        );

        // shared/ must exist and be importable.
        const snapshotPath = path.join(
          target,
          "shared",
          "workspace-snapshot.mjs",
        );
        assert(
          existsSync(snapshotPath),
          "deployed target contains shared/workspace-snapshot.mjs",
        );

        // Custom subagent description.
        assert(
          existsSync(path.join(target, "subagent-tool-description.md")),
          "deployed target contains the agent-level custom subagent description",
        );
        assert(
          !existsSync(path.join(target, ".pi", "subagent-tool-description.md")),
          "deployed target has no retired agent-shipped .pi description",
        );

        // Exactly three agents.
        const deployedAgents = readdirSync(path.join(target, "agents")).filter(
          (f) => f.endsWith(".md"),
        );
        eq(
          deployedAgents.length,
          3,
          "deployed target has exactly three agent profiles",
        );

        // No archive session logs.
        const archivePath = path.join(
          target,
          "docs",
          "archive",
          "session-logs",
        );
        assert(
          !existsSync(archivePath),
          "deployed target does not contain docs/archive/session-logs",
        );
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  },

  "installer upgrade deployment": async (context) => {
    const { section } = context;
    await section("installer upgrade deployment", async () => {
      const { LEGACY_MANAGED } = await import(
        pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
      );

      const target = mkdtempSync(path.join(tmpdir(), "pi-install-upgrade-"));
      try {
        // Pre-populate a target with known legacy agent profiles and one
        // user-owned file.
        mkdirSync(path.join(target, "agents"), { recursive: true });
        writeFileSync(
          path.join(target, "agents", "planner.md"),
          "# legacy planner",
        );
        writeFileSync(
          path.join(target, "agents", "worker.md"),
          "# legacy worker",
        );
        writeFileSync(
          path.join(target, "agents", "reviewer.md"),
          "# legacy reviewer",
        );
        const legacyDescription = path.join(
          target,
          ".pi",
          "subagent-tool-description.md",
        );
        mkdirSync(path.dirname(legacyDescription), { recursive: true });
        writeFileSync(legacyDescription, "# legacy installer description");
        // Aurora dropped its editor component; an older install still carries
        // the file, and the upgrade has to remove it rather than orphan it.
        const legacyEditor = path.join(
          target,
          "extensions",
          "aurora-ui",
          "editor.ts",
        );
        mkdirSync(path.dirname(legacyEditor), { recursive: true });
        writeFileSync(legacyEditor, "// legacy Aurora editor");
        const userFile = path.join(target, "agents", "custom-user-agent.md");
        writeFileSync(userFile, "# user-owned custom agent");

        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "install-user.mjs"),
            "--apply",
            "--target",
            target,
          ],
          { stdio: "pipe", timeout: 30_000 },
        );

        // Legacy managed files must be gone.
        for (const legacy of LEGACY_MANAGED) {
          assert(
            !existsSync(path.join(target, legacy)),
            `upgrade removes legacy ${legacy}`,
          );
        }
        assert(
          existsSync(path.join(target, "subagent-tool-description.md")),
          "upgrade installs the current agent-level custom subagent description",
        );

        // User-owned file must survive.
        assert(
          existsSync(userFile),
          "upgrade preserves user-owned file agents/custom-user-agent.md",
        );

        // Current agents are installed.
        for (const role of ["investigator.md", "debugger.md", "verifier.md"]) {
          assert(
            existsSync(path.join(target, "agents", role)),
            `upgrade installs agents/${role}`,
          );
        }
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  },

  "installer security boundaries": async (context) => {
    const { section } = context;
    await section("installer security boundaries", async () => {
      const target = mkdtempSync(path.join(tmpdir(), "pi-install-security-"));
      try {
        // Symlink in target path must be rejected.
        const symDir = mkdtempSync(path.join(tmpdir(), "pi-install-symlink-"));
        const linkPath = path.join(symDir, "link");
        symlinkSync(target, linkPath, "dir");
        try {
          execFileSync(
            process.execPath,
            [
              path.join(ROOT, "scripts", "install-user.mjs"),
              "--apply",
              "--target",
              path.join(linkPath, "sub"),
            ],
            { stdio: "pipe", timeout: 10_000 },
          );
          assert(false, "installer must reject symlink in target path");
        } catch (error) {
          assert(
            error.stderr?.includes("Symlink") ||
              error.message?.includes("Symlink") ||
              error.code !== 0,
            "installer rejects symlink in target path",
          );
        } finally {
          rmSync(symDir, { recursive: true, force: true });
        }

        // Sensitive files must not appear in deployed target.
        const { NEVER_COPY } = await import(
          pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
        );
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "install-user.mjs"),
            "--apply",
            "--target",
            target,
          ],
          { stdio: "pipe", timeout: 30_000 },
        );
        for (const forbidden of NEVER_COPY) {
          assert(
            !existsSync(path.join(target, forbidden)),
            `deployed target must not contain ${forbidden}`,
          );
        }
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  },
};
