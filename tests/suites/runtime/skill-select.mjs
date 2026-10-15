// Shift+Tab skill picker: a UI over the runtime's own skills. The pick only
// queues a name; the next real user message is transformed into the native
// `/skill:<name> …` form, which the runtime expands. These sections pin the
// parts that must not drift: no turn from the pick, one-shot use, no leak
// across sessions/reload, and only runtime-loaded skills.
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

const sourceInfo = (scope, origin = "top-level") => ({
  path: "<test>/SKILL.md",
  source: "test",
  scope,
  origin,
  baseDir: "<test>",
});

const skillCommand = (name, scope, origin) => ({
  name: `skill:${name}`,
  description: `Beschreibung ${name}`,
  source: "skill",
  sourceInfo: sourceInfo(scope, origin),
});

export const skillSelectSections = {
  "skill picker queues a native skill command": async (context) => {
    const { section, load } = context;

    await section("skill picker queues a native skill command", async () => {
      const extension = await load("extensions/skill-select/index.ts");
      assert(extension, "skill-select extension loads");
      if (!extension) return;

      const commands = [
        skillCommand("repo-analyse", "user"),
        skillCommand("projekt-skill", "project"),
        skillCommand("paket-skill", "user", "package"),
        { name: "model", source: "extension", sourceInfo: sourceInfo("user") },
      ];
      let pick;
      let shownLabels;
      const harness = createHarness({
        commands,
        select: (labels) => {
          shownLabels = labels;
          return pick;
        },
      });
      extension.default(harness.api);
      const ctx = harness.makeContext();
      // Deterministic fallback instead of the interactive overlay.
      ctx.ui.custom = async () => {
        throw new Error("use deterministic select fallback");
      };
      await harness.runHooks("session_start", { reason: "startup" }, ctx);

      const open = harness.commands.get("skill");
      const input = (text, source = "interactive") =>
        harness.runHooks("input", { type: "input", text, source }, ctx);

      // The list is exactly the runtime's loaded skills, project ones first.
      pick = undefined;
      await open("", ctx);
      eq(
        shownLabels,
        ["projekt-skill", "repo-analyse", "paket-skill"],
        "menu lists skill commands only, grouped by origin",
      );
      eq(harness.statuses.has("skill"), false, "Esc changes nothing");

      // Selecting queues the skill but starts no turn and keeps the draft.
      ctx.ui.setEditorText("halber Entwurf");
      pick = "repo-analyse";
      await open("", ctx);
      eq(harness.statuses.get("skill"), "Skill: repo-analyse", "indicator set");
      eq(harness.sent.length, 0, "selection sends no message / starts no turn");
      eq(ctx.ui.getEditorText(), "halber Entwurf", "editor text is untouched");

      // Commands, templates and extension-sourced input leave it queued.
      eq(
        (await input("/model"))[0],
        { action: "continue" },
        "slash commands pass through",
      );
      eq(
        (await input("normaler Text", "extension"))[0],
        { action: "continue" },
        "extension-sent messages pass through",
      );
      eq(harness.statuses.get("skill"), "Skill: repo-analyse", "still queued");

      // The next user message is rewritten to the native form, once.
      eq(
        (await input("Untersuche dieses Repository."))[0],
        {
          action: "transform",
          text: "/skill:repo-analyse Untersuche dieses Repository.",
        },
        "next user message is prefixed with the native skill command",
      );
      eq(harness.statuses.has("skill"), false, "consumed after use");
      eq(
        (await input("noch eine Nachricht"))[0],
        { action: "continue" },
        "no repeated activation",
      );

      // Selecting the queued skill again removes the queue entry.
      pick = "repo-analyse";
      await open("", ctx);
      await open("", ctx);
      eq(harness.statuses.has("skill"), false, "second pick toggles it off");

      // Direct argument form and --clear.
      await open("projekt-skill", ctx);
      eq(harness.statuses.get("skill"), "Skill: projekt-skill", "/skill <name>");
      await open("gibt-es-nicht", ctx);
      eq(
        harness.statuses.get("skill"),
        "Skill: projekt-skill",
        "unknown name keeps the queue",
      );
      assert(
        harness.notifications.some((n) => n.level === "error"),
        "unknown name is reported",
      );
      await open("--clear", ctx);
      eq(harness.statuses.has("skill"), false, "/skill --clear");

      // A new session / reload starts without a queued skill.
      await open("repo-analyse", ctx);
      await harness.runHooks("session_start", { reason: "new" }, ctx);
      eq(harness.statuses.has("skill"), false, "session_start resets");
      eq(
        (await input("Text"))[0],
        { action: "continue" },
        "nothing leaks into the next session",
      );

      // A skill that disappeared (reload) is not injected.
      await open("repo-analyse", ctx);
      commands.splice(0, commands.length);
      eq(
        (await input("Text"))[0],
        { action: "continue" },
        "removed skill is not loaded",
      );
      assert(
        harness.notifications.some((n) => n.level === "warning"),
        "removed skill is reported",
      );
      eq(harness.statuses.has("skill"), false, "stale queue is dropped");
    });
  },
  "skill picker footer chip": async (context) => {
    const { section, load } = context;

    await section("skill picker footer chip", async () => {
      const footer = await load("extensions/aurora-ui/footer.ts");
      assert(footer, "footer loads");
      if (!footer) return;
      const theme = {
        fg: (_color, text) => String(text),
        bg: (_color, text) => String(text),
        bold: (text) => String(text),
        inverse: (text) => String(text),
      };
      const state = {
        sessionEpoch: "skill-test",
        permissions: { level: "project-write" },
        lsp: {},
        model: { id: "m", thinking: "high" },
        activity: { kind: "idle" },
      };
      for (const width of [140, 70, 40]) {
        const withSkill = footer
          .renderFooterLines(theme, width, {
            state,
            statuses: new Map([["skill", "Skill: repo-analyse"]]),
            contextPercent: null,
            cwd: "/tmp/projekt",
          })
          .join("\n");
        assert(
          withSkill.includes("Skill: repo-analyse"),
          `queued skill is visible at ${width} columns`,
        );
      }
      const without = footer
        .renderFooterLines(theme, 140, {
          state,
          statuses: new Map(),
          contextPercent: null,
          cwd: "/tmp/projekt",
        })
        .join("\n");
      assert(!without.includes("Skill:"), "no chip without a queued skill");
    });
  },
};
