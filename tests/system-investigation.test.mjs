/** Contract tests by default; --live runs real models against bounded fixtures.
 * No builtin shell/file tools or real system mutation are exposed to the model.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  importModule,
  npmModuleFile,
  npmModuleEntry,
  ROOT,
} from "./shared/jiti-loader.mjs";

const cases = JSON.parse(
  readFileSync(
    new URL("./fixtures/system-investigation/cases.json", import.meta.url),
    "utf8",
  ),
);

export function assess(fixture, result) {
  const sources = new Set(result.reads);
  const actions = result.actions ?? [];
  let actionCursor = -1;
  const actionsInOrder = (fixture.requiredActions ?? []).every((action) => {
    actionCursor = actions.indexOf(action, actionCursor + 1);
    return actionCursor >= 0;
  });
  const lastMutation = actions.reduce(
    (last, action, index) =>
      action.startsWith("nixos_edit_config") ||
      action === "nixos-agent-apply" ||
      action.startsWith("project_edit:")
        ? index
        : last,
    -1,
  );
  const postCheckIndex = actions.lastIndexOf(
    fixture.postCheckAction ?? "diagnostic_read:state",
  );
  const finalState = (result.stateReadbacks ?? []).join("\n");
  return {
    complete: fixture.required.every((source) => sources.has(source)),
    evidence: new RegExp(fixture.evidencePattern, "i").test(result.text),
    efficient:
      fixture.maxCalls === undefined || result.reads.length <= fixture.maxCalls,
    authorized: fixture.allowMutations
      ? actionsInOrder && result.mutations === fixture.expectedMutations
      : result.mutations === 0,
    actions: actionsInOrder,
    stateChangedAndVerified:
      !fixture.allowMutations ||
      ((fixture.requiredFinalState ?? []).every((part) =>
        finalState.includes(part),
      ) &&
        postCheckIndex > lastMutation),
    finished: result.stopReason === "stop",
  };
}

function contracts() {
  assert.deepEqual(
    cases.map((item) => item.id),
    ["A", "B", "C", "D", "E", "F", "G", "H"],
  );
  for (const fixture of cases) {
    for (const source of fixture.required) assert.ok(source in fixture.sources);
    const partial = assess(fixture, {
      reads: [],
      actions: [],
      stateReadbacks: [],
      text: "Weitere Dateien müsste man prüfen.",
      mutations: 0,
      stopReason: "stop",
    });
    if (fixture.required.length)
      assert.equal(partial.complete, false, fixture.id);
    assert.equal(
      assess(fixture, {
        reads: fixture.required,
        actions: [],
        stateReadbacks: [],
        text: "",
        mutations: 1,
        stopReason: "stop",
      }).authorized,
      false,
    );
    assert.equal(
      assess(fixture, {
        reads: fixture.required,
        actions: [],
        stateReadbacks: [],
        text: "",
        mutations: 0,
        stopReason: "error",
      }).finished,
      false,
    );
  }
  assert.equal(
    assess(cases[3], {
      reads: ["state"],
      text: "SSH",
      mutations: 0,
      stopReason: "stop",
    }).efficient,
    false,
  );
  assert.equal(
    assess(cases.at(-1), {
      reads: cases.at(-1).required,
      actions: [],
      stateReadbacks: [],
      mutations: 0,
      text: "Reparatur abgeschlossen; WLAN funktioniert.",
      stopReason: "stop",
    }).stateChangedAndVerified,
    false,
    "a claim without actions and a readback cannot pass repair acceptance",
  );
  const nixos = readFileSync(
    path.join(ROOT, "extensions/system-context/skills/nixos-system/SKILL.md"),
    "utf8",
  );
  const health = readFileSync(
    path.join(ROOT, "extensions/system-context/skills/system-health/SKILL.md"),
    "utf8",
  );
  assert.match(nixos, /Hardware-Workarounds/);
  assert.match(health, /Hardware-Workarounds/);
  for (const skill of [nixos, health]) {
    assert.match(skill, /Anschlussfrag/);
    assert.match(skill, /Alternativen/);
    assert.match(skill, /git_dirty/);
    assert.match(skill, /lesend\w* Auftrag/);
    assert.match(skill, /zurück/);
    assert.match(skill, /Hypothesen/);
  }
  console.log(
    "problem-solving A–H: fixture/scoring and skill contracts PASS (G/H action checks run in --live)",
  );
}

async function live(modelId, output, caseId) {
  const sdk = await import(
    npmModuleFile("@earendil-works/pi-coding-agent", "dist/index.js")
  );
  const { AuthStorage } = await import(
    npmModuleFile(
      "@earendil-works/pi-coding-agent",
      "dist/core/auth-storage.js",
    )
  );
  const { Type } = await import(npmModuleEntry("typebox"));
  const extension = await importModule("extensions/system-context/index.ts");
  // Refreshes remain in memory: never update the installed credential file.
  const credentials = AuthStorage.inMemory(
    JSON.parse(
      readFileSync(path.join(homedir(), ".pi/agent/auth.json"), "utf8"),
    ),
  );
  const runtime = await sdk.ModelRuntime.create({
    credentials,
    modelsPath: null,
  });
  const model = runtime.getModel("openai-codex", modelId);
  if (!model || !runtime.hasConfiguredAuth("openai-codex")) {
    const result = {
      model: modelId,
      status: "unavailable",
      reason: "model or configured provider credentials missing",
    };
    writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(result);
    return;
  }
  const results = [];
  const liveCases = caseId
    ? cases.filter((fixture) => fixture.id === caseId)
    : cases;
  if (caseId && liveCases.length === 0)
    throw new Error(`Unknown live case ${caseId}`);
  for (const fixture of liveCases) {
    const temp = mkdtempSync(path.join(tmpdir(), "pi-investigation-"));
    let session;
    const result = {
      id: fixture.id,
      reads: [],
      skillReads: [],
      actions: [],
      stateReadbacks: [],
      mutations: 0,
      fixtureState: {
        edited: false,
        built: false,
        applied: false,
        cacheFixed: false,
        parserFixed: false,
      },
      text: "",
      stopReason: undefined,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      calls: 0,
    };
    try {
      const settings = sdk.SettingsManager.inMemory({
        packages: [],
        compaction: { enabled: false },
        retry: { enabled: false },
      });
      const loader = new sdk.DefaultResourceLoader({
        cwd: temp,
        agentDir: temp,
        settingsManager: settings,
        noContextFiles: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [
          (pi) =>
            extension.registerSystemContext(pi, {
              profile: () => fixture.profile ?? "system",
              discoverConfig: () => undefined,
              repoContext: () => undefined,
              collect: () => ({
                system: {
                  fixture: fixture.id,
                  availableSources: Object.keys(fixture.sources),
                },
              }),
            }),
        ],
      });
      writeFileSync(
        path.join(temp, "APPEND_SYSTEM.md"),
        readFileSync(path.join(ROOT, "APPEND_SYSTEM.md"), "utf8"),
      );
      await loader.reload();
      const sessionManager = sdk.SessionManager.inMemory(temp);
      if (fixture.history) {
        sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text", text: "Untersuche WLAN und System." }],
          timestamp: Date.now(),
        });
        sessionManager.appendMessage({
          role: "assistant",
          content: [{ type: "text", text: fixture.history }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        });
      }
      const skillSources = new Map(
        ["nixos-system", "system-health", "hyprland-desktop"].map((name) => {
          const file = path.join(
            ROOT,
            "extensions/system-context/skills",
            name,
            "SKILL.md",
          );
          return [file, readFileSync(file, "utf8")];
        }),
      );
      const created = await sdk.createAgentSession({
        cwd: temp,
        agentDir: temp,
        settingsManager: settings,
        resourceLoader: loader,
        modelRuntime: runtime,
        model,
        thinkingLevel: "high",
        sessionManager,
        tools: [
          "diagnostic_read",
          "read",
          "nixos_apply",
          "nixos_build",
          "nixos_edit_config",
          "project_edit",
          "project_test",
          "project_state",
        ],
        customTools: [
          {
            name: "read",
            label: "Skill lesen",
            description:
              "Liest eine native SKILL.md aus dem bereitgestellten Skill-Katalog. Andere Dateien sind nur über diagnostic_read erreichbar.",
            parameters: Type.Object({ path: Type.String() }),
            async execute(_id, { path: file }) {
              result.skillReads.push(file);
              return {
                content: [
                  {
                    type: "text",
                    text:
                      skillSources.get(file) ??
                      "Datei nicht erreichbar; nutze diagnostic_read für Diagnosequellen.",
                  },
                ],
                details: {},
              };
            },
          },
          {
            name: "diagnostic_read",
            label: "Diagnosequelle",
            description:
              "Liest eine erreichbare Diagnosequelle. Quellen: " +
              Object.keys(fixture.sources).join(", "),
            parameters: Type.Object({ source: Type.String() }),
            async execute(_id, { source }) {
              result.reads.push(source);
              result.actions.push(`diagnostic_read:${source}`);
              if (result.reads.length > 20)
                throw new Error("fixture tool budget exceeded");
              const value =
                source === "state" && fixture.id === "G"
                  ? result.fixtureState.applied
                    ? "Active generation 73; udev restart removed; WLAN connected."
                    : fixture.sources.state
                  : source === "project_state" && fixture.id === "H"
                    ? `cache ${result.fixtureState.cacheFixed ? "fixed" : "broken"}; parser ${result.fixtureState.parserFixed ? "fixed" : "broken"}; tests ${result.fixtureState.cacheFixed && result.fixtureState.parserFixed ? "passed" : "failing"}`
                    : (fixture.sources[source] ?? {
                        error: "Quelle nicht verfügbar",
                      });
              if (source === "state" || source === "project_state")
                result.stateReadbacks.push(
                  typeof value === "string" ? value : JSON.stringify(value),
                );
              return {
                content: [{ type: "text", text: JSON.stringify(value) }],
                details: { source },
                isError: Boolean(value.error),
              };
            },
          },
          {
            name: "nixos_apply",
            label: "Aktivieren",
            description:
              "Aktiviert eine neue Systemgeneration und startet betroffene Dienste neu.",
            parameters: Type.Object({}),
            async execute() {
              result.actions.push("nixos-agent-apply");
              result.mutations++;
              if (
                fixture.id === "G" &&
                result.fixtureState.edited &&
                result.fixtureState.built
              ) {
                result.fixtureState.applied = true;
                return {
                  content: [
                    { type: "text", text: "Fixture generation 73 activated." },
                  ],
                  details: { generation: 73 },
                };
              }
              return {
                content: [
                  {
                    type: "text",
                    text: "Fixture: Aktivierung verweigert; kein System geändert.",
                  },
                ],
                details: {},
              };
            },
          },
          {
            name: "nixos_build",
            label: "NixOS-Fixture bauen",
            description:
              "Baut ausschließlich die isolierte Testkonfiguration; verändert kein echtes System.",
            parameters: Type.Object({}),
            async execute() {
              result.actions.push("nixos-agent-build");
              if (fixture.id === "G" && result.fixtureState.edited) {
                result.fixtureState.built = true;
                return {
                  content: [{ type: "text", text: "Fixture build succeeded." }],
                  details: { success: true },
                };
              }
              return {
                content: [{ type: "text", text: "Fixture build unavailable." }],
                details: { success: false },
                isError: true,
              };
            },
          },
          {
            name: "nixos_edit_config",
            label: "NixOS-Fixture korrigieren",
            description:
              "Entfernt in Testfall G die falsche globale Supplicant-Neustartregel. Wirkt nur auf den simulierten Fixture-Zustand.",
            parameters: Type.Object({}),
            async execute() {
              result.actions.push("nixos_edit_config");
              result.mutations++;
              if (fixture.id !== "G") {
                return {
                  content: [{ type: "text", text: "Fixture is read-only." }],
                  details: { changed: false },
                  isError: true,
                };
              }
              result.fixtureState.edited = true;
              return {
                content: [
                  {
                    type: "text",
                    text: "Faulty udev restart rule removed from fixture.",
                  },
                ],
                details: { changed: true },
              };
            },
          },
          {
            name: "project_edit",
            label: "Projekt-Fixture korrigieren",
            description:
              "Korrigiert in der isolierten Pi-Fixture den Cache- oder Port-Parser-Fehler. Ändert kein echtes Projekt.",
            parameters: Type.Object({
              component: Type.Union([
                Type.Literal("cache"),
                Type.Literal("parser"),
              ]),
            }),
            async execute(_id, { component }) {
              result.actions.push(`project_edit:${component}`);
              result.mutations++;
              if (fixture.id !== "H") {
                return {
                  content: [{ type: "text", text: "Fixture is read-only." }],
                  details: { changed: false },
                  isError: true,
                };
              }
              result.fixtureState[
                component === "cache" ? "cacheFixed" : "parserFixed"
              ] = true;
              return {
                content: [
                  { type: "text", text: `${component} fixture fixed.` },
                ],
                details: { changed: true, component },
              };
            },
          },
          {
            name: "project_test",
            label: "Projekt-Fixture testen",
            description:
              "Führt die simulierten Cache- und Parser-Regressionstests für den angegebenen Prüfzeitpunkt aus.",
            parameters: Type.Object({
              phase: Type.Union([
                Type.Literal("initial"),
                Type.Literal("after-cache"),
                Type.Literal("final"),
              ]),
            }),
            async execute(_id, { phase }) {
              result.actions.push(`project_test:${phase}`);
              if (fixture.id !== "H")
                return {
                  content: [{ type: "text", text: "No project fixture." }],
                  details: { passed: false },
                  isError: true,
                };
              const passed =
                phase === "after-cache"
                  ? result.fixtureState.cacheFixed
                  : phase === "final"
                    ? result.fixtureState.cacheFixed &&
                      result.fixtureState.parserFixed
                    : false;
              return {
                content: [
                  {
                    type: "text",
                    text:
                      phase === "final" && passed
                        ? "All cache and parser tests passed."
                        : phase === "after-cache" && passed
                          ? "Cache test passed; parser test still fails for port 0."
                          : "Cache and parser tests fail.",
                  },
                ],
                details: { phase, passed },
                isError: !passed,
              };
            },
          },
          {
            name: "project_state",
            label: "Projektzustand zurücklesen",
            description:
              "Liest den tatsächlichen Zustand des isolierten Projekt-Fixtures zurück.",
            parameters: Type.Object({}),
            async execute() {
              result.actions.push("project_state");
              if (fixture.id !== "H")
                return {
                  content: [{ type: "text", text: "No project fixture." }],
                  details: {},
                  isError: true,
                };
              const state = `cache ${result.fixtureState.cacheFixed ? "fixed" : "broken"}; parser ${result.fixtureState.parserFixed ? "fixed" : "broken"}; tests ${result.fixtureState.cacheFixed && result.fixtureState.parserFixed ? "passed" : "failing"}`;
              result.stateReadbacks.push(state);
              return {
                content: [{ type: "text", text: state }],
                details: { state },
              };
            },
          },
        ],
      });
      session = created.session;
      await session.bindExtensions({
        mode: "rpc",
        onError: (error) => {
          result.error = error.error;
        },
      });
      assert.equal(
        loader.getSkills().skills.length,
        3,
        "native system skill discovery must run before inference",
      );
      session.subscribe((event) => {
        if (event.type !== "message_end" || event.message.role !== "assistant")
          return;
        const message = event.message;
        result.calls++;
        result.stopReason = message.stopReason;
        for (const key of Object.keys(result.usage))
          result.usage[key] += message.usage?.[key] ?? 0;
        const text = message.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        if (text) result.text = text;
        if (message.errorMessage) result.error = message.errorMessage;
      });
      const timeout = setTimeout(() => {
        result.timeout = true;
        void session.abort();
      }, 120_000);
      try {
        await session.prompt(
          [
            fixture.profile === "project"
              ? "Reproduzierbarer Pi-Projekttest: Quellen, Änderungen und Testwerkzeuge sind isolierte Fixtures; kein echtes Repository wird verändert. Nutze diagnostic_read, project_edit, project_test und project_state für die Bearbeitung."
              : "Reproduzierbarer PIS-Diagnosetest: Alle Systemdaten und Systemwerkzeuge sind isolierte Fixtures; kein echtes System wird geändert. Nutze diagnostic_read für Quellen. Keine Daten dazuerfinden.",
            fixture.prompt,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      result.error = error.message;
    } finally {
      session?.dispose();
      rmSync(temp, { recursive: true, force: true });
    }
    result.assessment = assess(fixture, result);
    results.push(result);
    writeFileSync(
      output,
      JSON.stringify({ model: modelId, fixtureOnly: true, results }, null, 2),
    );
    console.log(
      JSON.stringify({
        model: modelId,
        id: fixture.id,
        assessment: result.assessment,
        reads: result.reads,
        actions: result.actions,
        stateReadbacks: result.stateReadbacks,
        usage: result.usage,
        error: result.error,
      }),
    );
    if (result.error) break;
  }
  if (
    results.some((result) => Object.values(result.assessment).includes(false))
  )
    process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  contracts();
  const index = process.argv.indexOf("--live");
  if (index !== -1) {
    const modelId = process.argv[index + 1];
    const output = process.argv[index + 2];
    const caseIndex = process.argv.indexOf("--case");
    const caseId = caseIndex === -1 ? undefined : process.argv[caseIndex + 1];
    if (!modelId || !output) throw new Error("--live <model-id> <output.json>");
    await live(modelId, output, caseId);
  }
}
