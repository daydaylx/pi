import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const subagentsSkillsSections = {
  "native subagent profiles": async (context) => {
    const { section } = context;

    await section("native subagent profiles", async () => {
      const expectedProfiles = [
        "debugger.md",
        "investigator.md",
        "verifier.md",
      ];
      const agentsRoot = path.join(ROOT, "agents");
      eq(
        readdirSync(agentsRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => entry.name)
          .sort(),
        expectedProfiles,
        "investigator, debugger and verifier are the complete local role set",
      );
      const profileSources = Object.fromEntries(
        expectedProfiles.map((name) => [
          name,
          readFileSync(path.join(agentsRoot, name), "utf8"),
        ]),
      );
      const expectedTools = {
        "investigator.md": "read, grep, find, ls",
        "debugger.md": "read, grep, find, ls, bash",
        "verifier.md": "read, grep, find, ls, bash",
      };
      for (const [name, source] of Object.entries(profileSources)) {
        assert(
          source.includes(`name: ${name.slice(0, -3)}`),
          `${name} declares the exact active role name`,
        );
        assert(
          source.includes(`tools: ${expectedTools[name]}`),
          `${name} declares its exact runtime tool boundary`,
        );
        assert(
          source.includes("defaultContext: fresh") &&
            source.includes("inheritProjectContext: true") &&
            source.includes("inheritSkills: false"),
          `${name} starts with fresh context without inherited skills`,
        );
        assert(
          !/^tools:.*\b(?:task|delegate|spawn)\b/m.test(source),
          `${name} cannot perform nested delegation`,
        );
      }
      for (const name of expectedProfiles) {
        assert(
          !/^tools:.*\b(?:edit|write)\b/m.test(profileSources[name]),
          `${name} has no project write tool`,
        );
        assert(
          !/^(?:model|fallbackModels|thinking):/m.test(profileSources[name]),
          `${name} carries no model or thinking fields; settings.json agentOverrides are the single model source`,
        );
      }
      for (const name of ["investigator.md", "verifier.md"]) {
        const source = profileSources[name];
        assert(
          source.includes("## Acceptance Contract") &&
            source.includes("`acceptance-report`") &&
            source.includes("Teil des Ausgabeformats"),
          `${name} treats a required acceptance report as part of its fixed output format`,
        );
      }
      assert(
        !/^tools:.*\bbash\b/m.test(profileSources["investigator.md"]),
        "investigator has no shell access",
      );
      for (const name of ["debugger.md", "verifier.md"]) {
        assert(
          /^tools:.*\bbash\b/m.test(profileSources[name]),
          `${name} may run diagnostic shell commands`,
        );
      }
      const archivedRoot = path.join(ROOT, "docs", "archive", "subagents-v1");
      assert(
        !existsSync(archivedRoot),
        "retired v1 subagent profiles have been cleaned up; only the active 3-role model remains",
      );
      for (const activeDoc of ["AGENTS.md", "README.md", "docs/subagents.md"]) {
        const source = readFileSync(path.join(ROOT, activeDoc), "utf8");
        assert(
          !/\b(?:planner|worker|reviewer)\b/i.test(source),
          `${activeDoc} does not present retired roles as active`,
        );
      }
      assert(
        /Hauptagent.*(?:Patch-Eigentümer|implementiert)/is.test(
          readFileSync(path.join(ROOT, "docs/subagents.md"), "utf8"),
        ),
        "documentation keeps regular patch ownership with the main agent",
      );
      assert(
        readFileSync(path.join(ROOT, "docs/subagents.md"), "utf8").includes(
          "Aufrufer geben ihnen keinen\n`output`-Pfad vor",
        ),
        "documentation keeps read-only subagent findings inline instead of requiring a child-written output path",
      );
    });
  },

  "native project skills": async (context) => {
    const { section } = context;

    await section("native project skills", async () => {
      const expectedSkills = [
        "agent-docs",
        "bug-triage",
        "context-checkpoint",
        "doc-diff",
        "git-check",
        "lsp-navigation",
        "prompt-compiler",
        "release-changelog",
        "repo-analyse",
        "security-audit",
        "test-ci",
        "ui-ux-review",
      ];
      const skillsRoot = path.join(ROOT, "skills");
      eq(
        readdirSync(skillsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort(),
        expectedSkills,
        "the twelve project skills use Pi's standard skill directories",
      );

      for (const name of expectedSkills) {
        const skillPath = path.join(skillsRoot, name, "SKILL.md");
        assert(existsSync(skillPath), name + " has a native SKILL.md file");
        if (!existsSync(skillPath)) continue;
        const source = readFileSync(skillPath, "utf8");
        assert(
          new RegExp(
            "^---\\nname: " +
              name +
              '\\ndescription: (?:\\"[^\\n]+\\"|[^\\n]+)\\n---\\n',
          ).test(source),
          name + " has Pi-compatible name and description frontmatter",
        );
        assert(
          !/^allowed-tools:/m.test(source),
          name +
            " does not present experimental allowed-tools as a security boundary",
        );
      }

      const checkpointSkill = readFileSync(
        path.join(skillsRoot, "context-checkpoint", "SKILL.md"),
        "utf8",
      );
      const agentRules = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
      const ledger = readFileSync(
        path.join(ROOT, "docs", "CONTEXT_LEDGER.md"),
        "utf8",
      );
      const projectState = readFileSync(
        path.join(ROOT, "docs", "PROJECT_STATE.md"),
        "utf8",
      );
      const ledgerDecision = readFileSync(
        path.join(
          ROOT,
          "docs",
          "decisions",
          "008-context-ledger-is-documentation.md",
        ),
        "utf8",
      );
      assert(
        /\bcontext-checkpoint\b/.test(agentRules) &&
          !/Ledger\s+wird\s+zusätzlich\s+automatisch[\s\S]{0,120}plan-mode\s+konsolidiert/i.test(
            agentRules,
          ),
        "AGENTS routes checkpoints through the manual skill without a runtime ledger claim",
      );
      assert(
        /keine\s+automatische\s+Konsolidierung/i.test(checkpointSkill) &&
          checkpointSkill.includes("docs/PROJECT_STATE.md") &&
          checkpointSkill.includes("docs/CONTEXT_LEDGER.md"),
        "context-checkpoint is the sole ledger maintenance path",
      );
      assert(
        ledger.includes("# Context Ledger") &&
          projectState.includes("# Project State") &&
          ledgerDecision.includes("keine Laufzeitkomponente"),
        "ledger, project state and ADR retain their separate non-runtime roles",
      );
    });

    // ─────────────────────── security and plan helpers ───────────────────────
    // Doom-Loop- und Edit-Fallback-Module wurden entfernt: sie waren seit 4c7a201
    // von keiner Extension mehr geladen (setup-core/index.ts importierte sie nicht)
    // und damit wirkungslos. Ihre Tests entfallen mit ihnen.
  },
};
