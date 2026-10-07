import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { withHarness } from "./shared/harness.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const classify = await load("extensions/task-tier/classify.ts");
const tracker = await load("extensions/task-tier/read-tracker.ts");
const tier = await load("extensions/task-tier/index.ts");
const capabilities = await load("extensions/shared/workflow-capabilities.ts");
const hardPaths = await load(
  "extensions/permissions/verifier-required-paths.ts",
);

const opts = { planning: false };

await test("task-tier: Klassifikation (Tests A–F)", async () => {
  // A trivialer Config-Fix, C lokale UI-Änderung, B kleiner Bug
  eq(
    classify.classifyPrompt(
      "Setze in settings.json editorPaddingX auf 2",
      opts,
    ),
    "fast",
    "A config",
  );
  eq(
    classify.classifyPrompt(
      "Zeige im Footer den aktuellen Arbeitsordner an",
      opts,
    ),
    "fast",
    "C ui",
  );
  eq(
    classify.classifyPrompt(
      "Fix: parseArgs in extensions/foo/args.ts liefert bei leerem String undefined",
      opts,
    ),
    "fast",
    "B bug",
  );
  // Risikowörter allein führen zu NORMAL; kritische Pfade bleiben DEEP.
  eq(
    classify.classifyPrompt("Ändere die Permission-Prüfung für bash", opts),
    "normal",
    "E permission",
  );
  eq(
    classify.classifyPrompt("Sicherheitslücke im Login beheben", opts),
    "normal",
    "E security",
  );
  eq(
    classify.classifyPrompt("Passe extensions/permissions/guards.ts an", opts),
    "deep",
    "E hard path",
  );
  // Planmodus und explizite Tiefenprüfung bleiben DEEP.
  eq(
    classify.classifyPrompt("Kleine Sache", { planning: true }),
    "deep",
    "F plan mode",
  );
  eq(
    classify.classifyPrompt(
      "Führe ein gründliches Audit des Recovery-Flows durch",
      opts,
    ),
    "deep",
    "explizites Audit",
  );
  eq(
    classify.classifyPrompt("Refactore das Subsystem", opts),
    "normal",
    "Refactor-Wort allein",
  );
  eq(
    classify.classifyPrompt("Ein Tippfehler in der Verifier-Doku", opts),
    "normal",
    "Verifier-Wort allein",
  );
  eq(
    classify.classifyPrompt("Benenne die Funktion in allen Dateien um", opts),
    "normal",
    "broad",
  );
  eq(
    classify.classifyPrompt("a.ts b.ts c.ts d.ts ändern", opts),
    "normal",
    "viele Pfade",
  );
  eq(classify.classifyPrompt("", opts), "normal", "leer");
});

await test("task-tier: 30-Aufgaben-Korpus gegen alte Heuristik", async () => {
  // Repräsentative Aufgaben aus den lokalen Behebungsaufträgen und kleinen
  // Repo-Arbeiten; die Labels sind die erwartete Klasse nach beobachtetem Umfang.
  const corpus = [
    ["fast", "Setze editorPaddingX in settings.json auf 2"],
    ["fast", "Korrigiere den Tippfehler im Footer-Label"],
    [
      "fast",
      "Fix: parseArgs in extensions/foo/args.ts gibt bei leerem String undefined zurück",
    ],
    ["fast", "Ergänze einen Test für den leeren String in tests/foo.test.mjs"],
    ["fast", "Zeige im Footer den aktuellen Arbeitsordner an"],
    ["fast", "Ändere den Standardwert von retryCount in config.ts auf 3"],
    ["fast", "Entferne den ungenutzten Import aus extensions/foo/index.ts"],
    ["fast", "Ergänze den fehlenden Markdown-Link in README.md"],
    ["fast", "Benenne den lokalen Button-Text in Abbrechen um"],
    ["fast", "Korrigiere den Grenzfall für offset 0 in read-tracker.ts"],
    [
      "normal",
      "Prüfe den Timeout-Alias im Verifier und ergänze passende Tests",
    ],
    ["normal", "Untersuche den intermittierenden Fehler im LSP-Cache"],
    ["normal", "Refactore den Parser in args.ts und aktualisiere die Tests"],
    [
      "normal",
      "Prüfe die Sicherheitslücke im Login und beschreibe die Ursache",
    ],
    ["normal", "Ändere die Permission-Prüfung für bash"],
    ["normal", "Aktualisiere alle drei CLI-Hilfetexte in docs/"],
    [
      "normal",
      "Vergleiche die beiden Benchmark-Reports und fasse Unterschiede zusammen",
    ],
    ["normal", "Korrigiere den Plan-Modus-Text in der Dokumentation"],
    [
      "normal",
      "Der Verifier-Leitfaden enthält einen Tippfehler; korrigiere ihn",
    ],
    [
      "normal",
      "Ergänze Tests für den Recovery-Neustart und prüfe den betroffenen Workflow",
    ],
    [
      "deep",
      "Ändere extensions/permissions/guards.ts und prüfe den Permission-Vertrag",
    ],
    [
      "deep",
      "Überarbeite extensions/shared/permission-policy.ts für Symlink-Ziele",
    ],
    [
      "deep",
      "Repariere extensions/frontend-protocol/events.ts und die öffentliche Event-Kompatibilität",
    ],
    [
      "deep",
      "Ändere extensions/plan-mode/plan-store.ts für atomare Planpersistenz",
    ],
    [
      "deep",
      "Passe extensions/setup-core/dependency-prepare.ts an die Lockfile-Attestierung an",
    ],
    ["deep", "Führe ein gründliches Audit des Recovery-Flows durch"],
    [
      "deep",
      "Untersuche Root Cause und behebe den nicht reproduzierbaren Fehler im Recovery-State",
    ],
    [
      "deep",
      "Führe ein ausführliches Audit für Verifier-Ledger und Workflow-Capabilities durch",
    ],
    [
      "deep",
      "Ändere extensions/permissions/tool-policy.ts und extensions/resilience/recovery-state.ts",
    ],
    [
      "deep",
      "Ersetze den Workflow-Vertrag in extensions/shared/workflow-capabilities.ts",
    ],
  ];
  const legacyDeep =
    /security|sicherheit|permission|berechtigung|trust|secret|credential|auth(?:entication|orization|entifizierung)?\b|sandbox|architektur|architecture|migrat|refactor|umbau|neu\s*schreiben|rewrite|protokoll|protocol|frontend[- ]api|\bipc\b|dependenc|abhängigkeit|plan[- ]?mode|planmodus|\bplan\b|verifier|subagent|race condition|intermittier|nicht reproduzierbar|root cause|ursache.*unklar/i;
  const legacyTier = (prompt) => {
    if (legacyDeep.test(prompt)) return "deep";
    if (
      hardPaths.matchingVerifierRequiredPaths(classify.mentionedPaths(prompt))
        .length > 0
    )
      return "deep";
    if (
      /\b(commit\w*|push\w*|merge\w*|publish\w*|release\w*|deploy\w*|veröffentlich\w*|pull[- ]?request|pr)\b/i.test(
        prompt,
      )
    )
      return "normal";
    if (
      prompt.length > 500 ||
      /\b(alle[nrms]?|überall|komplett\w*|gesamte\w*|repo-?weit|projektweit|across|everywhere|all files|whole|entire)\b/i.test(
        prompt,
      )
    )
      return "normal";
    if (
      classify.mentionedPaths(prompt).length > 3 ||
      (prompt.match(/^\s*(?:[-*]|\d+[.)])\s+/gm)?.length ?? 0) > 2
    )
      return "normal";
    return "fast";
  };
  let oldFalseDeep = 0;
  let oldErrors = 0;
  let newErrors = 0;
  for (const [expected, prompt] of corpus) {
    const old = legacyTier(prompt);
    const current = classify.classifyPrompt(prompt, opts);
    if (old === "deep" && expected !== "deep") oldFalseDeep += 1;
    if (old !== expected) oldErrors += 1;
    if (current !== expected) {
      newErrors += 1;
    }
  }
  eq(corpus.length, 30, "10 Aufgaben je Klasse");
  eq(
    oldFalseDeep,
    7,
    "alte Heuristik stuft harmlose Risikowörter fälschlich deep ein",
  );
  eq(oldErrors, 9, "Gesamtfehler der alten Heuristik im Korpus");
  eq(newErrors, 0, "neue Heuristik trifft alle Korpuslabels");
});

await test("task-tier: Thinking-Ziele", async () => {
  eq(classify.thinkingForTier("fast", "kurz"), "low", "fast kurz");
  eq(classify.thinkingForTier("fast", "x".repeat(200)), "medium", "fast lang");
  eq(classify.thinkingForTier("normal", "x"), undefined, "normal unverändert");
  eq(classify.thinkingForTier("deep", "x"), "high", "deep");
});

await test("task-tier: Read-Tracker", async () => {
  const t = tracker.createReadTracker();
  const stamp = { mtimeMs: 1, size: 10 };
  t.record("/a", {}, stamp, false);
  assert(t.isRedundant("/a", {}, stamp), "identisch");
  assert(t.isRedundant("/a", { offset: 5, limit: 10 }, stamp), "Teilbereich");
  assert(!t.isRedundant("/a", {}, { mtimeMs: 2, size: 10 }), "geändert");
  t.invalidate("/a");
  assert(!t.isRedundant("/a", {}, stamp), "nach Invalidierung");
  t.record("/b", {}, stamp, true);
  assert(!t.isRedundant("/b", {}, stamp), "gekürzt zählt nicht");
  t.record("/c", { offset: 1, limit: 50 }, stamp, false);
  assert(!t.isRedundant("/c", { offset: 40, limit: 50 }, stamp), "ragt hinaus");
  assert(!t.isRedundant("/c", {}, stamp), "voller Read nicht abgedeckt");
  t.reset();
  assert(!t.isRedundant("/c", { offset: 1, limit: 10 }, stamp), "reset");
});

const tc = (toolName, input) => ({
  type: "tool_call",
  toolCallId: "t",
  toolName,
  input,
});
const tr = (toolName, input, extra = {}) => ({
  type: "tool_result",
  toolCallId: "t",
  toolName,
  input,
  content: [],
  isError: false,
  ...extra,
});

await test("task-tier: FAST blockt Subagenten, Duplicate-Reads, eskaliert", async () => {
  await withHarness(
    { extensions: [tier], files: { "a.txt": "x\n" } },
    async ({ harness, context, cwd }) => {
      const [start] = await harness.runHooks(
        "before_agent_start",
        {
          prompt: "Setze editorPaddingX in settings.json",
          systemPrompt: "SYS",
        },
        context,
      );
      assert(start.systemPrompt.includes("FAST"), "FAST-Prompt angehängt");
      eq(harness.api.getThinkingLevel(), "low", "Thinking gesenkt");

      const [sub] = await harness.runHooks(
        "tool_call",
        tc("subagent", { spec: { profile: "verify" } }),
        context,
      );
      assert(sub?.block === true, "Subagent geblockt");

      const read = { path: "a.txt" };
      eq(
        (await harness.runHooks("tool_call", tc("read", read), context))[0],
        undefined,
        "erster Read frei",
      );
      await harness.runHooks("tool_result", tr("read", read), context);
      const [dup] = await harness.runHooks(
        "tool_call",
        tc("read", read),
        context,
      );
      assert(dup?.block === true, "Duplicate-Read geblockt");
      await harness.runHooks("tool_result", tr("edit", read), context);
      eq(
        (await harness.runHooks("tool_call", tc("read", read), context))[0],
        undefined,
        "nach Edit wieder frei",
      );
      writeFileSync(join(cwd, "a.txt"), "y\n");

      // Eskalation: zu viele Searches vor dem ersten Edit (Edit-Flag zurücksetzen über neuen Turn)
      await harness.runHooks("agent_end", { messages: [] }, context);
      eq(harness.api.getThinkingLevel(), "high", "Thinking wiederhergestellt");
      const entry = harness.appended.find(
        (e) => e.customType === "task-tier.turn",
      );
      eq(entry.data.tier, "fast", "Telemetrie Klasse");
      eq(entry.data.dupReadsBlocked, 1, "Telemetrie Duplicate-Reads");
    },
  );

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Zeige im Footer den Ordner an", systemPrompt: "SYS" },
      context,
    );
    for (let i = 0; i < 3; i += 1)
      await harness.runHooks(
        "tool_result",
        tr("grep", { pattern: "x" }),
        context,
      );
    const [sub] = await harness.runHooks(
      "tool_call",
      tc("subagent", { spec: { profile: "analyse" } }),
      context,
    );
    eq(sub, undefined, "nach Eskalation Subagent erlaubt");
    assert(
      harness.sent.some((s) => s.message.customType === "task-tier.escalation"),
      "Steering-Hinweis",
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(entry.data.escalations.length, 1, "Eskalation protokolliert");
    eq(entry.data.tier, "normal", "Klasse NORMAL");
  });

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Kleiner Fix in foo.ts", systemPrompt: "SYS" },
      context,
    );
    await harness.runHooks(
      "tool_result",
      tr("edit", { path: "extensions/permissions/guards.ts" }),
      context,
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(entry.data.tier, "deep", "Hard-Pfad → DEEP");
    eq(entry.data.initialTier, "fast", "Anfangsklasse wird festgehalten");
    eq(entry.data.finalTier, "deep", "Endklasse wird festgehalten");
    assert(
      entry.data.observedRiskSignals.includes("hard_verifier_path"),
      "Hard-Pfad-Signal",
    );
    eq(
      entry.data.escalationReason.length,
      1,
      "Eskalationsgrund wird protokolliert",
    );
  });

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      {
        prompt:
          "Der Verifier-Leitfaden enthält einen Tippfehler; korrigiere ihn",
        systemPrompt: "SYS",
      },
      context,
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(entry.data.initialTier, "normal", "weiches Risikowort bleibt NORMAL");
    eq(
      entry.data.falsePositiveCandidate,
      true,
      "Kandidat für bisherige Überklassifikation",
    );
    eq(
      entry.data.observedRiskSignals.length,
      0,
      "keine Laufzeit-Risiken beobachtet",
    );
  });

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Kleiner Fix in foo.ts", systemPrompt: "SYS" },
      context,
    );
    await harness.runHooks(
      "tool_result",
      tr("edit", { path: "extensions/example/fix.ts" }),
      context,
    );
    await harness.runHooks(
      "tool_result",
      tr("edit", { path: "tests/example/fix.test.mjs" }),
      context,
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(
      entry.data.finalTier,
      "deep",
      "Subsystem-Änderungen heben auf DEEP hoch",
    );
    assert(
      entry.data.observedRiskSignals.includes("multiple_subsystems"),
      "Subsystem-Signal",
    );
  });

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Setze editorPaddingX in settings.json", systemPrompt: "SYS" },
      context,
    );
    await harness.runHooks(
      "tool_result",
      tr("bash", { command: "npm test" }, { isError: true }),
      context,
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(
      entry.data.finalTier,
      "normal",
      "fehlgeschlagener Check hebt FAST auf NORMAL",
    );
    assert(
      entry.data.observedRiskSignals.includes("test_build_failure"),
      "Check-Fehler-Signal",
    );
  });
});

await test("task-tier: Plan Mode → DEEP, Subagent erlaubt", async () => {
  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    harness.api.events.on(
      capabilities.WORKFLOW_CAPABILITY_EVENTS.request,
      (request) => request.respond({ mode: "detailed_plan" }),
    );
    const [start] = await harness.runHooks(
      "before_agent_start",
      { prompt: "kurz", systemPrompt: "SYS" },
      context,
    );
    assert(start.systemPrompt.includes("DEEP"), "DEEP im Planmodus");
    const [sub] = await harness.runHooks(
      "tool_call",
      tc("subagent", { spec: { profile: "analyse" } }),
      context,
    );
    eq(sub, undefined, "Subagent nicht geblockt");
  });
});

await test("task-tier: NORMAL lässt Prompt und Thinking unverändert", async () => {
  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    const [start] = await harness.runHooks(
      "before_agent_start",
      {
        prompt: "Benenne alles komplett um in allen Modulen",
        systemPrompt: "SYS",
      },
      context,
    );
    eq(start, undefined, "kein Prompt-Zusatz");
    eq(harness.api.getThinkingLevel(), "high", "Thinking unverändert");
  });
});

await test("task-tier: Commit/Push nie FAST, Fortsetzung erbt Klasse", async () => {
  for (const prompt of [
    "commit und push",
    "Bitte pushen",
    "merge den Branch",
    "mach den PR",
  ]) {
    assert(
      classify.classifyPrompt(prompt, opts) !== "fast",
      `release nicht fast: ${prompt}`,
    );
  }
  assert(classify.isContinuationPrompt("weiter"), "weiter");
  assert(classify.isContinuationPrompt("ja, mach das"), "ja");
  assert(
    !classify.isContinuationPrompt(
      "Setze in settings.json editorPaddingX auf 2",
    ),
    "kein Fortsetzungs-Prompt",
  );
  eq(classify.maxTier("fast", "deep"), "deep", "maxTier");
  eq(classify.maxTier("normal", "fast"), "normal", "maxTier2");
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
