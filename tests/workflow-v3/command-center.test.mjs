/**
 * Command Center: vollständige Kategorisierung, lokale Navigation und
 * kanonische Slash-Ausführung mit Entwurfsschutz.
 */
import { assert, eq, test } from "./assertions.mjs";
import { createHarness } from "../shared/harness.mjs";
import { load } from "./harness.mjs";

const commandCenter = await load("extensions/plan-mode/command-center.ts");
const commandRuntime = await load("extensions/shared/command-runtime.ts");
const menuUi = await load("extensions/shared/menu-ui.ts");

const emptyState = {
  hasActivePlan: false,
  hasActiveDirectTask: false,
  migrationRequired: false,
};

function findEntry(entries, id) {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    const nested = findEntry(entry.children ?? [], id);
    if (nested) return nested;
  }
  return undefined;
}

await test("command center groups canonical commands and dynamic resources", () => {
  if (!commandCenter) return;
  const entries = commandCenter.buildCommandCenterEntries(
    [
      { name: "daily", description: "Tagesprompt", source: "prompt" },
      { name: "reviewer", description: "Review-Skill", source: "skill" },
      { name: "vendor-extra", description: "Zusatzcommand", source: "extension" },
      { name: "go", description: "Alias", source: "extension" },
    ],
    emptyState,
  );

  eq(entries.length, 8, "the root exposes exactly eight task areas");
  eq(
    entries.map((entry) => entry.shortcut),
    ["A", "P", "M", "R", "C", "S", "V", "T"],
    "every root area has its agreed local letter shortcut",
  );
  assert(Boolean(findEntry(entries, "command-work")), "canonical /work is present");
  assert(!findEntry(entries, "dynamic-command-extension-go"), "aliases are not duplicated");
  assert(
    Boolean(findEntry(entries, "dynamic-command-prompt-daily")),
    "loaded prompt commands appear under resources",
  );
  assert(
    Boolean(findEntry(entries, "dynamic-command-skill-reviewer")),
    "active skill commands appear under resources",
  );
  assert(
    Boolean(findEntry(entries, "dynamic-command-extension-vendor-extra")),
    "unknown runtime commands remain reachable",
  );
  assert(
    findEntry(entries, "command-work")?.disabled,
    "/work is visibly disabled without an active plan",
  );
  assert(
    !findEntry(entries, "command-task")?.disabled,
    "/task stays available without a plan",
  );
});

await test("command center root letters open the matching submenu", async () => {
  if (!commandCenter || !menuUi) return;
  const harness = createHarness({ columns: 100, rows: 32 });
  const context = harness.makeContext();
  const pending = menuUi.runMenu(
    context,
    "Command Center · /commands",
    commandCenter.buildCommandCenterEntries([], emptyState),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const component = harness.customComponents.at(-1);
  assert(Boolean(component), "command center opens the shared overlay");
  if (!component) return;

  component.handleInput("m");
  assert(
    component.render(90).some((line) => String(line).includes("Modelle & Denken")),
    "lower-case m opens the models submenu",
  );
  component.handleInput("\r");
  eq((await pending)?.name, "model", "Enter selects the first canonical model command");
});

await test("canonical command submission preserves or protects editor drafts", async () => {
  if (!commandRuntime) return;
  const preserved = createHarness({ editorText: "wichtige Notiz" });
  const preservedContext = preserved.makeContext();
  assert(
    await commandRuntime.submitCanonicalCommand(
      preservedContext,
      "/model",
      "preserve-draft",
    ),
    "a non-destructive command is submitted",
  );
  eq(preserved.submittedCommands, ["/model"], "the canonical slash line is submitted");
  eq(preserved.editorText, "wichtige Notiz", "the existing draft is restored");

  const refused = createHarness({ editorText: "nicht verlieren", confirm: false });
  const refusedContext = refused.makeContext();
  assert(
    !(await commandRuntime.submitCanonicalCommand(
      refusedContext,
      "/plan quick",
      "starts-turn",
    )),
    "a turn-starting command can be cancelled",
  );
  eq(refused.submittedCommands, [], "cancelled execution submits nothing");
  eq(refused.editorText, "nicht verlieren", "cancelled execution keeps the draft");

  const accepted = createHarness({ editorText: "verwerfen", confirm: true });
  const acceptedContext = accepted.makeContext();
  assert(
    await commandRuntime.submitCanonicalCommand(
      acceptedContext,
      "/new",
      "replaces-session",
    ),
    "a confirmed session command is submitted",
  );
  eq(accepted.editorText, "", "confirmed replacement consumes the draft");
});
