/**
 * End-to-End-Smoke gegen den echten (gepatchten) pi-Prozess — auf der
 * Bridge-Ebene, die die GUI benutzt: Session, Prompt, Streaming,
 * Tool-Ereignis, agent_settled, Cancel, sauberes Beenden.
 *
 * Läuft headless und schreibt keine Sessiondaten (--no-session).
 * Ausführung: node gui/test/e2e-rpc.mjs   (braucht Netz + Modellzugriff)
 */
import { PiRpcManager } from "../main/pi-rpc-manager.js";

const cwd = process.cwd();
const manager = new PiRpcManager({
  piPath: process.env.PI_GUI_PI_PATH || "pi",
  cwd,
  noSession: true,
});

let assistantText = "";
let sawToolStart = false;
let settled = false;
let bridgeState = null;
let sawBridgeStateEntry = false;
const seenTypes = new Set();

manager.on("event", (msg) => {
  seenTypes.add(msg.type);
  if (msg.type === "agent_settled") settled = true;
  if (msg.type === "tool_execution_start") sawToolStart = true;
  if (
    msg.type === "message_update" &&
    msg.assistantMessageEvent &&
    msg.assistantMessageEvent.type === "text_delta"
  ) {
    assistantText += String(msg.assistantMessageEvent.delta ?? "");
  }
  // Phase 5: Core-Zustände müssen über die frontend-bridge ankommen.
  const entry = msg.type === "entry_appended" ? msg.entry : msg;
  if (
    (msg.type === "entry_appended" || msg.type === "custom") &&
    entry &&
    entry.customType === "frontend-bridge/state"
  ) {
    sawBridgeStateEntry = true;
    bridgeState = entry.data?.state ?? null;
  }
});

const hardTimeout = setTimeout(() => {
  console.error("E2E FAIL: globales Timeout");
  process.exit(1);
}, 180_000);

function fail(message) {
  clearTimeout(hardTimeout);
  console.error(`E2E FAIL: ${message}`);
  process.exit(1);
}

async function waitForSettled() {
  const start = Date.now();
  while (!settled && Date.now() - start < 150_000) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!settled) throw new Error("agent_settled blieb aus");
}

async function run() {
  manager.start();
  const state = await manager.request({ type: "get_state" });
  if (!state.sessionId) fail("keine sessionId nach get_state");
  console.log("E2E: Session", state.sessionId);

  await manager.request({
    type: "prompt",
    message:
      "Lies docs/gui-baseline/baseline-tests.md und antworte ausschließlich mit: BASELINE-OK",
  });
  await waitForSettled();

  for (const required of [
    "message_update",
    "tool_execution_start",
    "tool_execution_end",
    "agent_end",
  ]) {
    if (!seenTypes.has(required)) fail(`Ereignis ${required} fehlt`);
  }
  if (!assistantText.includes("BASELINE-OK")) {
    fail(`Antwort enthielt BASELINE-OK nicht: ...${assistantText.slice(-120)}`);
  }

  // Phase 5: Die Bridge muss Core-Zustände strukturiert liefern.
  if (!sawBridgeStateEntry) fail("kein frontend-bridge/state-Eintrag gesehen");
  if (!bridgeState || typeof bridgeState.workflow?.label !== "string") {
    fail("frontend-bridge/state trägt kein workflow-Feld");
  }

  // Cancel-Pfad: neuer Prompt wird sofort abgebrochen; der Prozess muss
  // anschließend noch bedienbar sein. Nach dem Abort muss der Core den
  // Turn sauber beenden (Graceful-Stop, Testmatrix-Fall D).
  settled = false;
  await manager.request({
    type: "prompt",
    message: "Zähle langsam bis zehn.",
  });
  await manager.abort();
  const abortDeadline = Date.now() + 10_000;
  while (!settled && Date.now() < abortDeadline) {
    await new Promise((r) => setTimeout(r, 150));
  }
  const stateAfterAbort = await manager.request({ type: "get_state" });
  if (!stateAfterAbort.sessionId) fail("Pi nach Abort nicht bedienbar");

  await manager.stop();
  clearTimeout(hardTimeout);
  console.log(
    `E2E PASS (events=${seenTypes.size}; tool=${sawToolStart}; bridge=${sawBridgeStateEntry}; text=${JSON.stringify(assistantText.trim().slice(-30))})`,
  );
  process.exit(0);
}

run().catch(async (err) => {
  fail(err.message ?? String(err));
});
