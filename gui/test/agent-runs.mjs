import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentRun,
  AgentRunStore,
  RUN_STATES,
  formatDuration,
  formatTime,
} from "../renderer/agent-runs.js";

test("AgentRun: Initialer Zustand und Lifecycle", () => {
  const run = new AgentRun({
    id: "run-1",
    agentName: "Investigator",
    task: "Repository analysieren",
    model: "gpt-5.6-terra",
    thinking: "high",
  });

  assert.equal(run.id, "run-1");
  assert.equal(run.agentName, "Investigator");
  assert.equal(run.task, "Repository analysieren");
  assert.equal(run.model, "gpt-5.6-terra");
  assert.equal(run.thinking, "high");
  assert.equal(run.state, RUN_STATES.STARTING);
  assert.equal(run.isFinished, false);
  assert.equal(run.isRunning, true);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].type, "run.started");
});

test("AgentRun: Tool-Aufrufe Start, Update und End", () => {
  const run = new AgentRun({
    id: "run-2",
    agentName: "Investigator",
  });

  // Tool Start
  const toolCall = run.recordToolStart({
    toolCallId: "tc-1",
    toolName: "read",
    summary: "READ src/index.ts",
    args: { path: "src/index.ts" },
  });

  assert.equal(run.toolCalls.size, 1);
  assert.equal(toolCall.running, true);
  assert.equal(run.usage.toolCount, 1);
  assert.equal(run.events.length, 2);
  assert.equal(run.events[1].type, "tool.started");

  // Tool Update (z.B. progress/streaming)
  run.recordToolUpdate("tc-1", { linesRead: 50 });
  assert.deepEqual(run.toolCalls.get("tc-1").partialResult, { linesRead: 50 });

  // Tool End
  run.recordToolEnd("tc-1", { content: "console.log('hello')" }, false);
  const finishedTool = run.toolCalls.get("tc-1");
  assert.equal(finishedTool.running, false);
  assert.equal(finishedTool.isError, false);
  assert.ok(typeof finishedTool.durationMs === "number");
  assert.equal(run.events.length, 3);
  assert.equal(run.events[2].type, "tool.completed");
});

test("AgentRun: Edit/Write registriert Dateiänderungen", () => {
  const run = new AgentRun({ id: "run-edit", agentName: "Worker" });

  run.recordToolStart({
    toolCallId: "tc-edit",
    toolName: "edit",
    summary: "EDIT lib/util.ts",
    args: { path: "lib/util.ts" },
  });

  run.recordToolEnd("tc-edit", { success: true }, false);

  assert.equal(run.fileChanges.size, 1);
  assert.ok(run.fileChanges.has("lib/util.ts"));
  const lastEvent = run.events[run.events.length - 1];
  assert.equal(lastEvent.type, "tool.completed");
  const fileChangeEvent = run.events.find((e) => e.type === "file.changed");
  assert.ok(fileChangeEvent);
  assert.equal(fileChangeEvent.path, "lib/util.ts");
});

test("AgentRun: Fehlerhafter Tool-Aufruf wird als tool.failed markiert", () => {
  const run = new AgentRun({ id: "run-err", agentName: "Debugger" });

  run.recordToolStart({
    toolCallId: "tc-bash",
    toolName: "bash",
    summary: "BASH npm test",
    args: { command: "npm test" },
  });

  run.recordToolEnd("tc-bash", { error: "Exit code 1" }, true);

  const tool = run.toolCalls.get("tc-bash");
  assert.equal(tool.isError, true);
  const failedEvent = run.events.find((e) => e.type === "tool.failed");
  assert.ok(failedEvent);
  assert.equal(failedEvent.isError, true);
});

test("AgentRun: Abschluss erfolgreich, fehlgeschlagen oder abgebrochen", () => {
  const run1 = new AgentRun({ id: "r1" });
  run1.complete({ summary: "3 Probleme gefunden" }, { isError: false });
  assert.equal(run1.state, RUN_STATES.COMPLETED);
  assert.equal(run1.isFinished, true);
  assert.deepEqual(run1.result, { summary: "3 Probleme gefunden" });

  const run2 = new AgentRun({ id: "r2" });
  run2.complete("Syntaxfehler im Test", { isError: true });
  assert.equal(run2.state, RUN_STATES.FAILED);
  assert.equal(run2.isFinished, true);
  assert.equal(run2.error, "Syntaxfehler im Test");

  const run3 = new AgentRun({ id: "r3" });
  run3.complete("Vom Nutzer abgebrochen", { cancelled: true });
  assert.equal(run3.state, RUN_STATES.CANCELLED);
  assert.equal(run3.isFinished, true);
  assert.equal(run3.error, "Vom Nutzer abgebrochen");
});

test("AgentRun: Tool-Breakdown Zählung", () => {
  const run = new AgentRun({ id: "r-breakdown" });
  run.recordToolStart({ toolCallId: "1", toolName: "read" });
  run.recordToolStart({ toolCallId: "2", toolName: "read" });
  run.recordToolStart({ toolCallId: "3", toolName: "grep" });
  run.recordToolStart({ toolCallId: "4", toolName: "bash" });

  const breakdown = run.getToolBreakdown();
  assert.deepEqual(breakdown, {
    Read: 2,
    Grep: 1,
    Bash: 1,
  });
});

test("AgentRunStore: Verwaltung von Main und Subagents", () => {
  const store = new AgentRunStore();

  const main = store.ensureMainRun("sess-1", {
    model: "gpt-5.6-terra",
    thinking: "high",
  });
  assert.equal(main.agentName, "Main");
  assert.equal(store.rootRunId, main.id);

  // Subagent starten
  const sub1 = store.startSubagentRun({
    id: "sub-1",
    parentRunId: main.id,
    agentName: "Investigator",
    task: "Codebase prüfen",
  });

  assert.equal(sub1.parentRunId, main.id);
  assert.deepEqual(main.childRunIds, ["sub-1"]);
  assert.equal(store.getAllRuns().length, 2);
  assert.equal(store.getSubagentRuns().length, 1);
  assert.equal(store.getActiveSubagents().length, 1);

  // Subagent abschließen
  sub1.complete({ findings: [] });
  assert.equal(store.getActiveSubagents().length, 0);
  assert.equal(store.getCompletedSubagents().length, 1);
});

test("AgentRunStore: Verschachtelte Parent-Child Beziehungen (Main -> Investigator -> Verifier)", () => {
  const store = new AgentRunStore();
  const main = store.ensureMainRun("sess-nested");

  const investigator = store.startSubagentRun({
    id: "sub-inv",
    parentRunId: main.id,
    agentName: "Investigator",
    task: "Architektur prüfen",
  });

  const verifier = store.startSubagentRun({
    id: "sub-ver",
    parentRunId: investigator.id,
    agentName: "Verifier",
    task: "Änderungen verifizieren",
  });

  assert.equal(verifier.parentRunId, "sub-inv");
  assert.deepEqual(investigator.childRunIds, ["sub-ver"]);
  assert.deepEqual(store.getChildrenOf("sub-inv"), [verifier]);
  assert.deepEqual(store.getChildrenOf(main.id), [investigator]);
});

test("AgentRunStore: Parallele Subagenten", () => {
  const store = new AgentRunStore();
  const main = store.ensureMainRun("sess-parallel");

  const subA = store.startSubagentRun({
    id: "sub-a",
    parentRunId: main.id,
    agentName: "Investigator",
    task: "Suche A",
  });

  const subB = store.startSubagentRun({
    id: "sub-b",
    parentRunId: main.id,
    agentName: "Verifier",
    task: "Prüfung B",
  });

  assert.equal(store.getActiveSubagents().length, 2);
  assert.deepEqual(main.childRunIds, ["sub-a", "sub-b"]);
});

test("AgentRunStore: Tab-Management (Öffnen, Schließen, Wechseln)", () => {
  const store = new AgentRunStore();
  store.ensureMainRun("sess-tabs");

  const sub1 = store.startSubagentRun({
    id: "sub-1",
    agentName: "Investigator",
  });
  const sub2 = store.startSubagentRun({ id: "sub-2", agentName: "Verifier" });

  assert.deepEqual(store.openTabs, ["chat"]);

  // Tab für sub1 öffnen
  store.openTab("sub-1");
  assert.deepEqual(store.openTabs, ["chat", "sub-1"]);
  assert.equal(store.activeRunId, "sub-1");

  // Tab für sub2 öffnen
  store.openTab("sub-2");
  assert.deepEqual(store.openTabs, ["chat", "sub-1", "sub-2"]);
  assert.equal(store.activeRunId, "sub-2");

  // Zu Chat wechseln
  store.setActiveTab("chat");
  assert.equal(store.activeRunId, null);

  // Tab sub2 schließen -> bleibt bei Chat oder vorherigem Tab
  store.closeTab("sub-2");
  assert.deepEqual(store.openTabs, ["chat", "sub-1"]);

  // Tab sub1 schließen
  store.setActiveTab("sub-1");
  store.closeTab("sub-1");
  assert.deepEqual(store.openTabs, ["chat"]);
  assert.equal(store.activeRunId, null);
});

test("AgentRun: 50+ Tool-Aufrufe Skalierung", () => {
  const run = new AgentRun({ id: "run-scale", agentName: "StressTester" });

  for (let i = 0; i < 60; i++) {
    const id = `tc-${i}`;
    run.recordToolStart({
      toolCallId: id,
      toolName: i % 2 === 0 ? "read" : "grep",
      summary: `Tool call ${i}`,
    });
    run.recordToolEnd(id, { output: `result ${i}` }, false);
  }

  assert.equal(run.toolCalls.size, 60);
  assert.equal(run.usage.toolCount, 60);
  const breakdown = run.getToolBreakdown();
  assert.equal(breakdown.Read, 30);
  assert.equal(breakdown.Grep, 30);
});

test("formatDuration und formatTime Hilfen", () => {
  assert.equal(formatDuration(320), "320ms");
  assert.equal(formatDuration(1500), "1s");
  assert.equal(formatDuration(42000), "42s");
  assert.equal(formatDuration(102000), "1m 42s");
  assert.equal(formatDuration(120000), "2m");
  assert.equal(formatDuration(3660000), "1h 1m");
  assert.equal(formatDuration(-10), "0s");

  assert.match(formatTime(Date.now()), /^\d{2}:\d{2}:\d{2}$/);
});
