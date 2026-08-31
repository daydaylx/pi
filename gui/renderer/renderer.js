/**
 * Renderer-Logik der GUI (Phase 6: Chat als Hauptfläche, kompakte
 * Tool-Aktivität, Zustände auf Abruf). Spricht ausschließlich über die
 * preload-freigegebene window.piGui-API. Keine Geschäftslogik: Alle
 * fachlichen Entscheidungen bleiben im Pi-Prozess (R1/R2/R11).
 */
"use strict";

const api = window.piGui;
const interactions = window.piGuiInteractions;
const isSmokeMode = new URLSearchParams(window.location.search).has("smoke");
const initialCwdParam =
  new URLSearchParams(window.location.search).get("cwd") || "";

/* ----------------------------- Zustand -------------------------------- */

const state = {
  connected: false,
  busy: false,
  modelLabel: "",
  thinkingLabel: "",
  verificationStatus: "",
  notifications: [],
  editedFiles: new Set(),
  pendingLocalEchoes: [],
  currentAssistant: null,
  currentActivity: null,
  activeView: "chat",
  followScroll: true,
  sessionId: null,
  sessionTransitioning: false,
  /** Kernzustand aus frontend-bridge/state-Einträgen (Phase 5). */
  core: null,
  /** Welche Inspector-Übersichtszeilen gerade inline aufgeklappt sind (§5:
   * eine Übersicht statt Übersicht/Detail-Umschaltung). */
  expandedRows: new Set(),
  /** Rohdaten aus api.listSessions() (Task-Sidebar, Phase 2) — der aktuelle
   * Task wird beim Rendern live aus state.core überlagert. */
  taskListCache: [],
  /** Fokus vor dem Öffnen des Inspector-Drawers (Phase 4), für die Rückkehr
   * beim Schließen. */
  contextDrawerPreviousFocus: null,
  /** Letzter bekannter Diff je Datei (Pfad → DiffViewEntryData), Phase 6
   * Changes Review. Gespeist aus live gestreamten "diff-view"-Custom-
   * Einträgen und, beim Sitzungswechsel, aus api.getSessionDiffs(). Keine
   * zweite Wahrheit (R6): dieselben Rohdaten, die der diff-viewer bereits
   * in der Sitzungsdatei persistiert. */
  fileDiffs: new Map(),
  /** Welche Dateien in der Changes-Ansicht gerade den Diff aufgeklappt
   * zeigen. */
  expandedDiffFiles: new Set(),
  /** Gerade laufende, als "verification" klassifizierte Werkzeugaufrufe
   * (Phase 7): toolCallId → true. Reine Ableitung aus den ohnehin schon
   * durchgereichten tool_execution_*-Ereignissen (R2/R6) — core.verification
   * kennt nur abgeschlossene Läufe, kein Live-"läuft gerade". */
  runningVerificationCalls: new Map(),
  /** Letzter abgeschlossene Verification-Werkzeugaufruf (Phase 7): Sprungziel
   * für "Details ansehen", da core.verification keine Rohausgabe je Check
   * mitschickt, die Tool-Card das aber bereits anzeigt (Decision 005: Rohdaten
   * bleiben zugänglich). */
  lastVerificationToolCallId: null,
};

/** Kanonisches Workflow-Modus-Set (shared/workflow-mode.ts). */
const WORKFLOW_MODES = [
  { mode: "work", label: "Work" },
  { mode: "simple_plan", label: "Schnellplan" },
  { mode: "detailed_plan", label: "Architekturplan" },
];

const el = (id) => document.getElementById(id);
const chatEl = el("chat");
const bannerEl = el("banner");
const inputEl = el("input");
const dotEl = el("status-dot");
const statusTextEl = el("status-text");

function setDot(kind) {
  dotEl.className = `dot ${kind}`;
}

function setStatusText(text) {
  statusTextEl.textContent = text;
}

/** Meldungen stapeln sich statt sich gegenseitig zu überschreiben (§4):
 * transiente info-Meldungen verschwinden automatisch, Fehler bleiben
 * stehen bis zur expliziten Bestätigung. */
const MAX_BANNERS = 5;
let bannerIdCounter = 0;

function dismissBanner(id) {
  const item = bannerEl.querySelector(`[data-banner-id="${id}"]`);
  if (item) item.remove();
  bannerEl.hidden = bannerEl.children.length === 0;
}

function clearBanners() {
  bannerEl.replaceChildren();
  bannerEl.hidden = true;
}

function showBanner(message, kind = "error") {
  const id = ++bannerIdCounter;
  const item = document.createElement("div");
  item.className = kind === "info" ? "banner-item info" : "banner-item";
  item.dataset.bannerId = String(id);
  const text = document.createElement("span");
  text.className = "banner-text";
  text.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "banner-dismiss";
  dismiss.setAttribute("aria-label", "Meldung schließen");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => dismissBanner(id));
  item.append(text, dismiss);
  bannerEl.appendChild(item);
  bannerEl.hidden = false;
  while (bannerEl.children.length > MAX_BANNERS) {
    bannerEl.firstElementChild.remove();
  }
  if (kind === "info") {
    setTimeout(() => dismissBanner(id), 6000);
  }
}

/* ------------------------------ Chat ---------------------------------- */

function setFollowScroll(follow) {
  state.followScroll = follow;
  const jumpButton = el("btn-jump-latest");
  if (jumpButton) jumpButton.hidden = follow;
}

function scrollToBottom(force = false) {
  updateChatEmptyHint();
  if (!force && !state.followScroll) {
    const jumpButton = el("btn-jump-latest");
    if (jumpButton) jumpButton.hidden = false;
    return;
  }
  chatEl.scrollTop = chatEl.scrollHeight;
  setFollowScroll(true);
}

function clearChat() {
  if (state.currentAssistant?.pendingRenderTimer) {
    clearTimeout(state.currentAssistant.pendingRenderTimer);
  }
  chatEl.innerHTML = "";
  state.currentAssistant = null;
  state.pendingLocalEchoes = [];
  closeActivityGroup();
  setFollowScroll(true);
  updateChatEmptyHint();
}

/**
 * Rendert eine Assistant-Antwort als sicheres Markdown (Phase 3, P0).
 * `renderMarkdown` baut DOM ausschließlich über `createElement`/
 * `textContent` (siehe chat/markdown.js) — kein `innerHTML` mit
 * Modelltext, daher strukturell keine Injektionsfläche.
 */
function renderAssistantBubble(bubble, text) {
  bubble.replaceChildren();
  bubble.appendChild(
    window.piGuiMarkdown.renderMarkdown(text, {
      onCodeBlock: (lang, code) =>
        window.piGuiCodeBlock.buildCodeBlock(lang, code, {
          onCopy: (codeText) => api.copyToClipboard(codeText),
        }),
    }),
  );
}

function appendUserBubble(text, { scroll = true } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "msg user";
  const label = document.createElement("div");
  label.className = "role-label";
  label.textContent = "Du";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.append(label, bubble);
  chatEl.appendChild(wrap);
  updateChatEmptyHint();
  if (scroll) scrollToBottom();
}

function beginAssistantBlock() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  const label = document.createElement("div");
  label.className = "role-label";
  label.textContent = "Pi";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  wrap.append(label, bubble);
  chatEl.appendChild(wrap);
  return {
    wrap,
    bubble,
    text: "",
    thinking: "",
    thinkingView: null,
    pendingRenderTimer: null,
    lastRenderedAt: 0,
  };
}

/**
 * Streaming rendert Markdown bei jedem Token neu (Parser + volles
 * Bubble-DOM), was bei langen Antworten mit vielen Codeblöcken spürbar
 * teuer wird. Ein Trailing-Throttle begrenzt das auf höchstens einen
 * Rebuild pro STREAM_RENDER_INTERVAL_MS, ohne Deltas zu verlieren: der
 * jeweils letzte Text gewinnt, sobald das Intervall abgelaufen ist.
 * `setAssistantText` (Abschluss/Historie) rendert weiterhin sofort.
 */
const STREAM_RENDER_INTERVAL_MS = 80;

function scheduleStreamRender(block) {
  const now = Date.now();
  const elapsed = now - block.lastRenderedAt;
  const fire = () => {
    block.pendingRenderTimer = null;
    block.lastRenderedAt = Date.now();
    renderAssistantBubble(block.bubble, block.text);
    scrollToBottom();
  };
  if (elapsed >= STREAM_RENDER_INTERVAL_MS) {
    if (block.pendingRenderTimer) {
      clearTimeout(block.pendingRenderTimer);
      block.pendingRenderTimer = null;
    }
    fire();
    return;
  }
  if (block.pendingRenderTimer) return;
  block.pendingRenderTimer = setTimeout(
    fire,
    STREAM_RENDER_INTERVAL_MS - elapsed,
  );
}

/** Live-Text-Delta: throttled statt bei jedem Token neu zu rendern. */
function streamAssistantText(block, text) {
  block.text = text;
  scheduleStreamRender(block);
}

/** Reasoning bleibt sekundär (§12): kurze Zeile, Dauer erst beim Abschluss. */
function setAssistantThinking(block, text) {
  block.thinking = text;
  if (!text) {
    block.thinkingView?.details.remove();
    block.thinkingView = null;
    return;
  }
  if (!block.thinkingView) {
    block.thinkingStartedAt = Date.now();
    const details = document.createElement("details");
    details.className = "thinking-block";
    const summary = document.createElement("summary");
    summary.textContent = "Denken …";
    const pre = document.createElement("pre");
    pre.className = "mono";
    details.append(summary, pre);
    block.wrap.appendChild(details);
    block.thinkingView = { details, summary, pre };
  }
  block.thinkingView.pre.textContent = text;
}

/** Live-Turns zeigen die gemessene Dauer; historische Nachrichten (aus
 * geladenen Sitzungen) haben keine verlässliche Dauer und bleiben neutral. */
function finalizeAssistantThinking(block, { live = false } = {}) {
  const view = block.thinkingView;
  if (!view) return;
  if (live && block.thinkingStartedAt) {
    const seconds = Math.max(
      1,
      Math.round((Date.now() - block.thinkingStartedAt) / 1000),
    );
    view.summary.textContent = `Denken · ${seconds}s`;
  } else {
    view.summary.textContent = "Denken";
  }
}

function setAssistantText(block, text) {
  block.text = text;
  if (block.pendingRenderTimer) {
    clearTimeout(block.pendingRenderTimer);
    block.pendingRenderTimer = null;
  }
  block.lastRenderedAt = Date.now();
  renderAssistantBubble(block.bubble, text);
}

function applyAssistantContent(block, content, opts = {}) {
  setAssistantText(block, interactions.textFromContent(content).trim());
  setAssistantThinking(block, interactions.thinkingFromContent(content));
  finalizeAssistantThinking(block, opts);
}

function appendAssistantMessage(message, { scroll = true } = {}) {
  const block = beginAssistantBlock();
  applyAssistantContent(block, message.content);
  if (scroll) scrollToBottom();
  return block;
}

function renderMessageHistory(messages) {
  clearChat();
  for (const message of messages) {
    if (!message || message.role === "toolResult") continue;
    if (message.role === "user") {
      appendUserBubble(interactions.textFromContent(message.content), {
        scroll: false,
      });
    } else if (message.role === "assistant") {
      appendAssistantMessage(message, { scroll: false });
    }
  }
  scrollToBottom(true);
}

/** Kompakte Tool-Card (R8): eine Zeile, Details auf Abruf. */
function toolCardElement(card) {
  const details = document.createElement("details");
  details.className = `tool-card ${card.running ? "running" : card.isError ? "done-error" : "done-ok"}`;
  const summary = document.createElement("summary");
  summary.textContent = card.summary;
  const pre = document.createElement("pre");
  details.append(summary, pre);
  details.__toolCallId = card.toolCallId;
  return details;
}

function setToolCardOutput(pre, result) {
  let output = interactions.textFromContent(result?.content);
  if (output.length > 2_000)
    output = `${output.slice(0, 2_000)}\n… Ausgabe gekürzt`;
  if (result?.details?.truncation && !output.includes("Ausgabe gekürzt")) {
    output = `${output}\n… Ausgabe vom Werkzeug gekürzt`;
  }
  pre.textContent = output;
}

/* ------------------------ Activity Stream (Phase 3) --------------------- */
/**
 * Ersetzt die frühere, rein technische Toolspam-Zeile durch semantische
 * Aktivitätskarten (05_Phase_3_Activity_Stream.md): aufeinanderfolgende
 * Werkzeugaufrufe derselben Phase (explore/edit/verify/agent/command)
 * bilden EINE Karte. Titel + Kernzeilen sind immer sichtbar (auch bei
 * Fehlern, §"Fehler dürfen niemals wegaggregiert werden") — nur die
 * Rohdaten je Einzelaufruf (bestehende Tool-Cards) sind hinter "Details"
 * versteckt ("Rohdaten bleiben zugänglich").
 */
/** groupKey trennt aufeinanderfolgende Aufrufe zusätzlich zur Phase — nur
 * für "agent" genutzt (Phase 10, §12 "klare Zuordnung von Activity zu
 * Agent"): zwei verschiedene Subagenten-Rollen hintereinander dürfen nicht
 * in einer gemeinsamen, generisch betitelten Karte verschwinden. */
function ensureActivityCard(kind, groupKey, cardTitle) {
  const phase = interactions.activityPhaseFor(kind);
  if (!state.currentActivity) state.currentActivity = { cards: [] };
  const cards = state.currentActivity.cards;
  const last = cards[cards.length - 1];
  if (last && last.phase === phase && last.groupKey === groupKey) return last;
  const card = buildActivityCard(phase, groupKey, cardTitle);
  cards.push(card);
  return card;
}

function buildActivityCard(phase, groupKey, cardTitle) {
  const root = document.createElement("div");
  root.className = `activity-card phase-${phase} running`;

  const header = document.createElement("div");
  header.className = "activity-header";
  const title = document.createElement("span");
  title.className = "activity-title";
  title.textContent =
    cardTitle || interactions.ACTIVITY_PHASE_LABELS[phase] || "Aktivität";
  header.appendChild(title);

  const lines = document.createElement("div");
  lines.className = "activity-lines";

  const raw = document.createElement("details");
  raw.className = "activity-raw";
  const rawSummary = document.createElement("summary");
  rawSummary.textContent = "Details";
  raw.appendChild(rawSummary);

  root.append(header, lines, raw);
  chatEl.appendChild(root);
  return { root, header, title, lines, raw, phase, groupKey, entries: [] };
}

function closeActivityGroup() {
  state.currentActivity = null;
}

function activityLineEl(text, kind) {
  const line = document.createElement("div");
  line.className = kind ? `activity-line ${kind}` : "activity-line";
  line.textContent = text;
  return line;
}

/** Kernzeilen je Phase — grobe, aber immer verständliche Verdichtung statt
 * einer reinen Werkzeug-Aufzählung. */
function activitySummaryLines(card) {
  if (card.phase === "explore") {
    const count = (kind) =>
      card.entries.filter((entry) => entry.kind === kind).length;
    const reads = count("file_read");
    const searches = count("search");
    const analysis = count("analysis");
    const bits = [];
    if (reads) {
      bits.push(`${reads} ${reads === 1 ? "Datei" : "Dateien"} gelesen`);
    }
    if (searches) {
      bits.push(`${searches} ${searches === 1 ? "Suche" : "Suchen"}`);
    }
    if (analysis) {
      bits.push(`${analysis} ${analysis === 1 ? "Analyse" : "Analysen"}`);
    }
    return bits.length ? [bits.join(" · ")] : [];
  }
  if (card.phase === "edit") {
    const files = new Set(
      card.entries.map((entry) => entry.target).filter(Boolean),
    );
    const count = files.size || card.entries.length;
    return [`${count} ${count === 1 ? "Datei" : "Dateien"} geändert`];
  }
  if (["verify", "command", "agent"].includes(card.phase)) {
    return card.entries
      .map((entry) => entry.target)
      .filter(Boolean)
      .slice(-3);
  }
  return card.entries.map((entry) => entry.toolName);
}

function refreshActivityCard(card) {
  const running = card.entries.some((entry) => entry.running);
  const failed = card.entries.filter(
    (entry) => !entry.running && entry.isError,
  );
  card.root.classList.toggle("running", running);
  card.root.classList.toggle("done-error", !running && failed.length > 0);
  card.root.classList.toggle("done-ok", !running && failed.length === 0);

  card.lines.innerHTML = "";
  for (const text of activitySummaryLines(card)) {
    card.lines.appendChild(activityLineEl(text));
  }
  for (const entry of failed) {
    card.lines.appendChild(
      activityLineEl(
        `✗ fehlgeschlagen: ${entry.target || entry.toolName}`,
        "error",
      ),
    );
  }
}

/** Menschenlesbares Ziel aus der bereits server-seitig gebauten Tool-Card-
 * Zusammenfassung ("READ pfad", "BASH befehl …") — keine zweite
 * Argument-Interpretation im Renderer nötig. */
function activityTargetFromSummary(summary) {
  return String(summary ?? "")
    .replace(/^[A-Z_]+\s*/, "")
    .trim();
}

/** Werkzeugaufrufe verteilen sich jetzt auf mehrere Karten (eine je Phase)
 * statt auf eine einzige flache Liste — Suche über alle Karten des
 * aktuellen Turns hinweg (neueste zuerst, falls IDs kollidieren). */
function findActivityCardByToolCallId(toolCallId) {
  const cards = state.currentActivity?.cards ?? [];
  for (let i = cards.length - 1; i >= 0; i--) {
    if (cards[i].entries.some((entry) => entry.toolCallId === toolCallId)) {
      return cards[i];
    }
  }
  return null;
}

function findRawToolCard(toolCallId) {
  const card = findActivityCardByToolCallId(toolCallId);
  const root = card ? card.raw : chatEl;
  const rawCards = root.querySelectorAll("details.tool-card");
  for (const rawCard of Array.from(rawCards).reverse()) {
    if (rawCard.__toolCallId === toolCallId) return rawCard;
  }
  return null;
}

/* ------------------------- Ereignisverarbeitung ------------------------ */

function handleEvent(msg) {
  switch (msg.type) {
    case "agent_start":
      state.busy = true;
      refreshStatusBar();
      break;
    case "message_start": {
      closeActivityGroup();
      const role = msg.message?.role;
      if (role === "user") {
        const text = interactions.textFromContent(msg.message?.content);
        const localEchoIndex = state.pendingLocalEchoes.indexOf(text);
        if (localEchoIndex >= 0)
          state.pendingLocalEchoes.splice(localEchoIndex, 1);
        else appendUserBubble(text);
      } else if (role === "assistant") {
        state.currentAssistant = beginAssistantBlock();
      }
      break;
    }
    case "message_update": {
      const ev = msg.assistantMessageEvent || {};
      if (!state.currentAssistant) break;
      if (ev.type === "text_delta") {
        streamAssistantText(
          state.currentAssistant,
          state.currentAssistant.text + String(ev.delta ?? ""),
        );
      } else if (ev.type === "thinking_delta") {
        setAssistantThinking(
          state.currentAssistant,
          state.currentAssistant.thinking + String(ev.delta ?? ""),
        );
        scrollToBottom();
      }
      break;
    }
    case "message_end": {
      // Autoritative Nachricht ersetzt den Stream (inkl. Thinking-Inhalten).
      const message = msg.message || {};
      if (message.role !== "assistant") break;
      if (!state.currentAssistant)
        state.currentAssistant = beginAssistantBlock();
      applyAssistantContent(state.currentAssistant, message.content, {
        live: true,
      });
      state.currentAssistant = null;
      scrollToBottom();
      break;
    }
    case "tool_execution_start": {
      const kind = interactions.classifyActivityKind(msg.toolName, msg.args);
      const agentRole =
        kind === "agent" && msg.toolName === "subagent"
          ? String(msg.args?.agent ?? "").trim() || undefined
          : undefined;
      const card = ensureActivityCard(
        kind,
        agentRole,
        agentRole ? interactions.agentDisplayLabel(agentRole) : undefined,
      );
      card.entries.push({
        toolCallId: msg.toolCard.toolCallId,
        toolName: msg.toolCard.toolName,
        kind,
        target: activityTargetFromSummary(msg.toolCard.summary),
        running: true,
        isError: false,
      });
      card.raw.appendChild(toolCardElement(msg.toolCard));
      refreshActivityCard(card);
      if (kind === "verification") {
        state.runningVerificationCalls.set(msg.toolCard.toolCallId, true);
        void refreshContextOverview();
      }
      scrollToBottom();
      break;
    }
    case "tool_execution_update": {
      const rawCard = findRawToolCard(msg.toolCallId);
      if (rawCard) {
        setToolCardOutput(rawCard.querySelector("pre"), msg.partialResult);
      }
      break;
    }
    case "tool_execution_end": {
      if (state.runningVerificationCalls.has(msg.toolCallId)) {
        state.runningVerificationCalls.delete(msg.toolCallId);
        state.lastVerificationToolCallId = msg.toolCallId;
        void refreshContextOverview();
      }
      const card = findActivityCardByToolCallId(msg.toolCallId);
      if (card) {
        const entry = card.entries.find(
          (candidate) => candidate.toolCallId === msg.toolCallId,
        );
        if (entry) {
          entry.running = false;
          entry.isError = Boolean(msg.isError);
        }
        refreshActivityCard(card);
      }
      const rawCard = findRawToolCard(msg.toolCallId);
      if (rawCard) {
        rawCard.classList.remove("running");
        rawCard.classList.add(msg.isError ? "done-error" : "done-ok");
        setToolCardOutput(rawCard.querySelector("pre"), msg.result);
        if (!msg.isError && ["edit", "write"].includes(String(msg.toolName))) {
          state.editedFiles.add(toolTargetPath(msg.args));
        }
      }
      break;
    }
    case "agent_settled":
      state.busy = false;
      closeActivityGroup();
      refreshStatusBar();
      refreshContextOverview();
      break;
    case "entry_appended":
      applyCustomEntry(msg.entry);
      break;
    case "custom":
      applyCustomEntry(msg);
      break;
    case "extension_ui_request":
      handleUiRequest(msg);
      break;
    case "extension_error":
      showBanner(`Extension-Fehler: ${String(msg.error ?? "").slice(0, 300)}`);
      break;
    default:
      break;
  }
}

function toolTargetPath(args) {
  return args && typeof args === "object" ? String(args.path ?? "") : "";
}

/** Verteilt einen Custom-Entry an den passenden Übernahme-Pfad — je
 * customType gibt es genau eine zuständige Stelle, keine doppelte
 * Interpretation derselben Rohdaten (R6). */
function applyCustomEntry(entry) {
  if (!entry) return;
  if (entry.customType === "frontend-bridge/state") applyCoreEntry(entry);
  else if (entry.customType === "diff-view") applyDiffEntry(entry);
}

/** Live-Diff-Eintrag des diff-viewer-Extensions (Phase 6 Changes Review):
 * dieselben Rohdaten, die auch in der Sitzungsdatei landen, hier nur
 * unmittelbar statt erst beim nächsten Sitzungswechsel übernommen. */
function applyDiffEntry(entry) {
  const data = entry.data;
  if (!data || typeof data.path !== "string" || !data.stats) return;
  state.fileDiffs.set(data.path, data);
  if (state.expandedRows.has("changes")) void refreshContextOverview();
}

/** Custom-Entry der frontend-bridge in den lokalen Kernzustand übernehmen. */
function applyCoreEntry(entry) {
  if (!entry || entry.customType !== "frontend-bridge/state") return;
  const payload =
    entry.data && typeof entry.data === "object" ? entry.data : {};
  const core =
    payload.state && typeof payload.state === "object" ? payload.state : null;
  const sessionId =
    typeof payload.sessionId === "string" ? payload.sessionId : null;
  if (
    !core ||
    (sessionId && state.sessionId && sessionId !== state.sessionId)
  ) {
    return;
  }
  state.core = core;
  refreshCoreChips();
  refreshContextOverview();
}

function refreshCoreChips() {
  const permissionEl = el("permission-label");
  const core = state.core;
  if (permissionEl) {
    permissionEl.textContent = core?.permissions?.label ?? "";
    permissionEl.hidden = !core?.permissions?.label;
  }
  refreshTaskTitle();
  refreshComposerPills();
  renderTaskSidebar();
}

/** Aktueller Task ist der visuelle Mittelpunkt des Headers (§Phase 1). */
function refreshTaskTitle() {
  const titleEl = el("task-title");
  const sepEl = el("task-sep");
  if (!titleEl || !sepEl) return;
  const title = state.core?.task?.title;
  const hasTitle = Boolean(title) && title !== "Aktuelle Aufgabe";
  titleEl.hidden = !hasTitle;
  sepEl.hidden = !hasTitle;
  titleEl.textContent = hasTitle ? title : "";
  titleEl.title = hasTitle ? title : "";
}

/* -------------------- Extension-UI-Anfragen (Dialoge) ------------------ */

function handleUiRequest(msg) {
  if (msg.method === "notify") {
    pushNotification(`${msg.notifyType ?? "info"}: ${msg.message ?? ""}`);
    return;
  }
  if (msg.method === "setStatus") {
    if (msg.statusKey === "verification") {
      state.verificationStatus = msg.status ?? "";
      refreshContextOverview();
    }
    return;
  }
  if (msg.method === "select") {
    openSelectDialog(msg);
    return;
  }
  if (msg.method === "confirm") {
    openConfirmDialog(msg);
    return;
  }
  if (msg.method === "input") {
    openInputDialog(msg);
    return;
  }
  // Andere Dialogarten (editor) sind im RPC degradiert — sichtbar ablehnen.
  void api
    .respondUiRequest({ id: msg.id, method: msg.method, cancelled: true })
    .catch(() => {});
  showBanner(
    `Nicht unterstützter UI-Dialog (${String(msg.method)}) wurde abgelehnt.`,
    "info",
  );
}

function pushNotification(text) {
  state.notifications.unshift(String(text).slice(0, 160));
  state.notifications = state.notifications.slice(0, 8);
  refreshContextOverview();
}

function dialogShell(title, buildBody) {
  const overlay = document.createElement("dialog");
  overlay.className = "ui-dialog";
  const h = document.createElement("h2");
  h.textContent = title;
  overlay.appendChild(h);
  buildBody(overlay);
  document.body.appendChild(overlay);
  overlay.showModal();
  return overlay;
}

function openExtensionDialog(request, buildBody) {
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  let dialog;
  const respondOnce = interactions.once((payload) =>
    api.respondUiRequest({
      id: request.id,
      method: request.method,
      ...payload,
    }),
  );
  const finish = (payload) => {
    const response = respondOnce(payload);
    if (response && typeof response.catch === "function") {
      response.catch((error) =>
        showBanner(`Dialog-Antwort fehlgeschlagen: ${error.message ?? error}`),
      );
    }
    if (dialog?.open) dialog.close();
  };

  dialog = dialogShell(String(request.title ?? "Pi-Anfrage"), (root) => {
    if (typeof request.message === "string" && request.message) {
      const message = document.createElement("p");
      message.className = "dialog-message";
      message.textContent = request.message;
      root.appendChild(message);
    }
    buildBody(root, finish);
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish({ cancelled: true });
  });
  dialog.addEventListener("close", () => {
    finish({ cancelled: true });
    dialog.remove();
    previousFocus?.focus();
  });
  return dialog;
}

function openSelectDialog(request) {
  openExtensionDialog(request, (root, finish) => {
    const list = document.createElement("ul");
    list.className = "dialog-options";
    for (const option of request.options ?? []) {
      const li = document.createElement("li");
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "picker-option";
      choice.textContent = String(option);
      choice.addEventListener("click", () => finish({ value: String(option) }));
      li.appendChild(choice);
      list.appendChild(li);
    }
    root.appendChild(list);
  });
}

function openConfirmDialog(request) {
  openExtensionDialog(request, (root, finish) => {
    const row = document.createElement("div");
    row.className = "dialog-actions";
    const yes = document.createElement("button");
    yes.className = "primary";
    yes.type = "button";
    yes.textContent = "Ja";
    yes.addEventListener("click", () => finish({ confirmed: true }));
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "Nein";
    no.addEventListener("click", () => finish({ confirmed: false }));
    row.append(yes, no);
    root.appendChild(row);
  });
}

function openInputDialog(request) {
  openExtensionDialog(request, (root, finish) => {
    const field = document.createElement("input");
    field.className = "dialog-input";
    field.placeholder =
      typeof request.placeholder === "string" ? request.placeholder : "";
    field.autofocus = true;
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.type = "button";
    ok.textContent = "OK";
    const submit = () => finish({ value: field.value });
    ok.addEventListener("click", submit);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    root.append(field, ok);
    queueMicrotask(() => field.focus());
  });
}

/* ------------------------------- Picker -------------------------------- */

function openPicker(title, rows, onPick) {
  const dialog = el("picker-dialog");
  if (dialog.open) return;
  el("picker-title").textContent = title;
  const list = el("picker-list");
  const filter = el("picker-filter");
  let selectionPending = false;
  filter.value = "";

  const renderRows = () => {
    const needle = filter.value.toLowerCase();
    list.innerHTML = "";
    for (const row of rows) {
      const haystack = `${row.label} ${row.desc ?? ""}`.toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      const li = document.createElement("li");
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "picker-option";
      choice.textContent = row.label;
      if (row.desc) {
        const desc = document.createElement("div");
        desc.className = "desc";
        desc.textContent = row.desc;
        choice.appendChild(desc);
      }
      if (row.disabled) {
        choice.disabled = true;
        li.className = "disabled";
      } else {
        choice.addEventListener("click", async () => {
          if (selectionPending) return;
          selectionPending = true;
          dialog.close();
          try {
            await onPick(row.value);
          } catch (error) {
            showBanner(`Auswahl fehlgeschlagen: ${error.message ?? error}`);
          } finally {
            selectionPending = false;
          }
        });
      }
      li.appendChild(choice);
      list.appendChild(li);
    }
  };
  filter.oninput = renderRows;
  renderRows();
  dialog.showModal();
  filter.focus();
}

async function openWorkflowPicker() {
  const current = state.core?.workflow?.phase ?? "work";
  openPicker(
    "Workflow wechseln",
    WORKFLOW_MODES.map((m) => ({
      label: m.label,
      desc: m.mode === current ? "aktuell" : undefined,
      value: m.mode,
    })),
    async (mode) => {
      await sendMessage(`/workflow-set ${mode}`, { skipLocalEcho: true });
    },
  );
}

async function openModelPicker() {
  try {
    const data = await api.listModels();
    const models = (data && data.models) || [];
    openPicker(
      "Modell wählen",
      models.map((m) => ({
        label: m.name || m.id,
        desc: `${m.provider}/${m.id}`,
        value: { provider: m.provider, id: m.id },
      })),
      async (value) => {
        await api.setModel(value.provider, value.id);
        await refreshStateLabels();
        pushNotification(`Modell: ${value.id}`);
      },
    );
  } catch (err) {
    showBanner(String(err.message ?? err));
  }
}

async function openThinkingPicker() {
  try {
    const data = await api.listThinkingLevels();
    const levels = (data && data.levels) || [];
    openPicker(
      "Denktiefe wählen",
      levels.map((level) => ({ label: level, value: level })),
      async (level) => {
        await api.setThinkingLevel(level);
        await refreshStateLabels();
        pushNotification(`Denktiefe: ${level}`);
      },
    );
  } catch (err) {
    showBanner(String(err.message ?? err));
  }
}

async function openCommandPalette() {
  try {
    const data = await api.listCommands();
    const commands = (data && data.commands) || [];
    const invocable = new Set(["extension", "skill", "prompt"]);
    openPicker(
      "Befehle",
      commands.map((c) => ({
        label: `/${c.name}`,
        desc: c.description ?? c.source,
        disabled: !invocable.has(c.source),
        value: c.name,
      })),
      async (name) => {
        await sendMessage(`/${name}`, { skipLocalEcho: true });
      },
    );
  } catch (err) {
    showBanner(String(err.message ?? err));
  }
}

async function openSessionResume() {
  if (!window.__piGuiCwd) {
    showBanner("Bitte zuerst ein Projekt öffnen.", "info");
    await openProjectPicker();
    return;
  }
  try {
    const sessions = await api.listSessions();
    if (sessions.length === 0) {
      showBanner("Keine gespeicherten Sitzungen gefunden.", "info");
      return;
    }
    openPicker(
      "Sitzung fortsetzen",
      sessions.map((s) => ({
        label: s.title,
        desc: new Date(s.mtimeMs).toLocaleString(),
        value: s.path,
      })),
      async (sessionPath) => resumeSession(sessionPath),
    );
  } catch (err) {
    showBanner(String(err.message ?? err));
  }
}

/* --------------- Navigation und Kontextbereich (Phase 6) --------------- */

function setActiveNav(view) {
  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  state.activeView = view;
}

/** Nav-Rail/Shortcuts springen zur passenden Übersichtszeile und klappen
 * sie auf, statt in einen separaten Panel-Modus zu wechseln — es gibt nur
 * noch die eine, immer sichtbare Übersicht (§5). */
function setActiveView(view) {
  setActiveNav(view);
  if (view === "chat") {
    closeContextDrawer();
    return;
  }
  expandRow(view);
  openContextDrawer();
}

function syncInspectorToggleButton() {
  el("btn-toggle-inspector")?.classList.toggle(
    "active",
    document.body.classList.contains("context-open"),
  );
}

/** Fokus geht beim Öffnen in den Drawer und beim Schließen zurück zum
 * auslösenden Element (§Phase 4 — Fokusmanagement). */
function openContextDrawer() {
  if (!document.body.classList.contains("context-open")) {
    state.contextDrawerPreviousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  document.body.classList.add("context-open");
  syncInspectorToggleButton();
  queueMicrotask(() => {
    const area = el("context-area");
    const target = area?.querySelector(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    (target ?? area)?.focus();
  });
}

function closeContextDrawer() {
  const wasOpen = document.body.classList.contains("context-open");
  document.body.classList.remove("context-open");
  syncInspectorToggleButton();
  if (!wasOpen) return;
  const previous = state.contextDrawerPreviousFocus;
  state.contextDrawerPreviousFocus = null;
  previous?.focus();
}

function expandRow(key) {
  state.expandedRows.add(key);
  void refreshContextOverview().then(() => {
    document
      .querySelector(`[data-expand-key="${key}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function toggleRow(key) {
  if (state.expandedRows.has(key)) state.expandedRows.delete(key);
  else state.expandedRows.add(key);
  void refreshContextOverview();
}

/* ------------------------- Task Sidebar (Phase 2) ---------------------- */

const TASK_STATUS_GROUPS = [
  { key: "active", label: "Active", marker: "●" },
  { key: "needs_input", label: "Needs Input", marker: "!" },
  { key: "review", label: "Review", marker: "○" },
  { key: "completed", label: "Completed", marker: "✓" },
];

const TASK_STATUS_TEXT = {
  active: "Working",
  needs_input: "Braucht Eingabe",
  review: "Review",
  completed: "Fertig",
};

const TASK_SIDEBAR_COLLAPSED_KEY = "pi-gui-task-sidebar-collapsed";

/** Holt die Sitzungsliste (mit zuletzt bekanntem Core-Zustand je Sitzung,
 * siehe ipc-handlers.js:readLastFrontendState) und rendert sie neu. Wird
 * nach Sitzungswechsel/-erstellung aufgerufen; laufende Statusänderungen
 * der AKTUELLEN Sitzung kommen dagegen günstig aus state.core (siehe
 * refreshCoreChips) ohne erneuten IPC-Aufruf. */
async function refreshTaskList() {
  try {
    state.taskListCache = await api.listSessions();
  } catch {
    state.taskListCache = [];
  }
  renderTaskSidebar();
}

/** Baut die Task-Sidebar aus dem Sitzungs-Cache + dem Live-Core-State der
 * aktuell verbundenen Sitzung (§Phase 2 — ersetzt die frühere flache
 * "Sitzungen"-Liste im Inspector durch eine statusgruppierte Ansicht). */
function renderTaskSidebar() {
  const container = el("task-groups");
  if (!container) return;
  const entries = buildTaskEntries();
  container.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "task-groups-empty";
    empty.textContent = "Keine Aufgaben gefunden.";
    container.appendChild(empty);
    return;
  }
  for (const group of TASK_STATUS_GROUPS) {
    const rows = entries.filter((entry) => entry.status === group.key);
    if (rows.length === 0) continue;
    const wrap = document.createElement("div");
    wrap.className = "task-group";
    const label = document.createElement("span");
    label.className = "task-group-label";
    label.textContent = group.label;
    wrap.appendChild(label);
    for (const entry of rows) {
      wrap.appendChild(renderTaskRow(entry, group));
    }
    container.appendChild(wrap);
  }
}

/** Reine Ableitung, keine zweite Wahrheit (R6): Status kommt aus
 * interactions.deriveTaskStatus (Core-Signale), Titel/Meta nur formatiert. */
function buildTaskEntries() {
  const entries = state.taskListCache.map((entry) => {
    const isCurrent = Boolean(
      state.sessionId && entry.path.includes(state.sessionId),
    );
    return buildTaskEntry(entry, isCurrent);
  });
  // Eine ganz frische Sitzung hat evtl. noch keine Datei auf der Platte
  // (erster Custom-Entry kommt erst mit der ersten Antwort) — ohne diesen
  // Ausgleich verschwindet der gerade aktive Task komplett aus der Liste
  // (verletzt "aktueller Task ist eindeutig erkennbar", §Phase 1/2).
  const hasCurrent = entries.some((entry) => entry.isCurrent);
  if (!hasCurrent && state.sessionId) {
    entries.unshift(
      buildTaskEntry(
        {
          path: `__current__${state.sessionId}`,
          title: "Neue Aufgabe",
          mtimeMs: Date.now(),
        },
        true,
      ),
    );
  }
  return entries;
}

function buildTaskEntry(entry, isCurrent) {
  const coreState = isCurrent && state.core ? state.core : entry.lastState;
  const status = interactions.deriveTaskStatus(coreState, {
    isCurrent,
    busy: state.busy,
  });
  const title =
    coreState?.task?.title && coreState.task.title !== "Aktuelle Aufgabe"
      ? coreState.task.title
      : entry.title;
  const detail =
    status === "review"
      ? (() => {
          const count = coreState?.changes?.filesCount ?? 0;
          return `${count} ${count === 1 ? "Datei" : "Dateien"}`;
        })()
      : interactions.relativeTimeLabel(entry.mtimeMs);
  return { path: entry.path, title, status, detail, isCurrent };
}

function renderTaskRow(entry, group) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = entry.isCurrent ? "task-row current" : "task-row";
  button.setAttribute("role", "listitem");
  if (entry.isCurrent) button.setAttribute("aria-current", "true");

  const marker = document.createElement("span");
  marker.className = `task-row-marker status-${entry.status}`;
  marker.textContent = group.marker;
  marker.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "task-row-body";
  const title = document.createElement("span");
  title.className = "task-row-title";
  title.textContent = entry.title;
  title.title = entry.title;
  const meta = document.createElement("span");
  meta.className = "task-row-meta";
  meta.textContent = `${TASK_STATUS_TEXT[entry.status]} · ${entry.detail}`;
  body.append(title, meta);

  button.append(marker, body);
  button.addEventListener("click", () => {
    if (entry.isCurrent) return;
    void resumeSession(entry.path);
  });
  return button;
}

function toggleTaskSidebarCollapsed() {
  const collapsed = document.body.classList.toggle("task-sidebar-collapsed");
  el("btn-collapse-tasks")?.setAttribute(
    "aria-expanded",
    collapsed ? "false" : "true",
  );
  try {
    localStorage.setItem(TASK_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* Bedienkomfort, kein hartes Erfordernis */
  }
}

function restoreTaskSidebarCollapsed() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(TASK_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    /* Default bleibt ausgeklappt */
  }
  document.body.classList.toggle("task-sidebar-collapsed", collapsed);
  el("btn-collapse-tasks")?.setAttribute(
    "aria-expanded",
    collapsed ? "false" : "true",
  );
}

/** Super+I bzw. Header-Button: Inspector-Drawer ein-/ausblenden. Der
 * Inspector ist nie mehr permanent Teil des Hauptlayouts (§Phase 1) — er
 * öffnet als Overlay-Drawer unabhängig von der Fensterbreite. */
function toggleContextArea() {
  if (document.body.classList.contains("context-open")) {
    closeContextDrawer();
  } else {
    openContextDrawer();
  }
}

function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Kollaps-Zeile "Agenten" im Inspector (Phase 10, §12 "aktive/wartende
 * Agenten unterscheidbar" bereits ohne Aufklappen). */
function agentsSummaryLabel(subagents) {
  const list = Array.isArray(subagents) ? subagents : [];
  if (list.length === 0) return "keine";
  const attention = list.filter(
    (entry) => entry?.status === "needs_attention",
  ).length;
  const rest = list.length - attention;
  const parts = [];
  if (rest > 0) parts.push(`${rest} aktiv`);
  if (attention > 0) parts.push(`${attention} braucht Eingabe`);
  return parts.join(" · ");
}

function verificationPill() {
  const core = state.core;
  const status = core?.verification?.status || state.verificationStatus;
  if (!status) return "";
  if (status === "verified") return '<span class="pill ok">bereit</span>';
  if (status === "checks_failed")
    return '<span class="pill err">fehlgeschlagen</span>';
  return `<span class="pill warn">${esc(status)}</span>`;
}

/** Inline-Detailinhalt einer aufgeklappten Übersichtszeile — dieselbe
 * Kategorie-Logik wie zuvor das separate Detailpanel, jetzt direkt unter
 * der Zeile gerendert statt in einem eigenen Panel-Modus (§5). Gespeist
 * aus Core-State, nie aus Chattext. */
async function renderRowBody(body, key) {
  const core = state.core;
  body.innerHTML = "";
  const line = (html, extraClass = "") => {
    const div = document.createElement("div");
    div.className = extraClass ? `panel-line ${extraClass}` : "panel-line";
    div.innerHTML = html;
    body.appendChild(div);
  };

  if (key === "changes") {
    renderChangesBody(body, core);
    return;
  }

  if (key === "agents") {
    const subagents = core?.subagents ?? [];
    if (subagents.length === 0) {
      line("Keine aktiven Subagenten.");
      return;
    }
    for (const entry of subagents) {
      const { marker, label, cls } = interactions.subagentStatusPresentation(
        entry.status,
      );
      line(
        `${esc(interactions.agentDisplayLabel(entry.role || entry.agent))} ` +
          `<span class="pill ${cls}">${marker} ${esc(label)}</span>`,
      );
    }
    return;
  }

  if (key === "verify") {
    renderVerificationBody(body, core, line);
    return;
  }
}

/* -------------------- Verification (Phase 7, §09) ----------------------- */

/** Springt zur Rohausgabe des letzten Verification-Werkzeugaufrufs (Phase 7
 * "Details aufklappbar"/"Fehlerdetails erreichbar"): core.verification
 * liefert nur das reduzierte Ergebnis je Check (success/failed/unavailable),
 * keine Rohausgabe — die liegt bereits in der zugehörigen Tool-Card der
 * Activity-Stream (Decision 005: Rohdaten bleiben zugänglich). Keine neue
 * Datenquelle, nur ein Sprung zu einer bereits vorhandenen. */
function jumpToVerificationDetails() {
  const toolCallId = state.lastVerificationToolCallId;
  if (!toolCallId) return;
  const rawCard = findRawToolCard(toolCallId);
  if (!rawCard) return;
  rawCard.open = true;
  rawCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Verification als First-Class-State (§09): pass/fail/running/offen klar
 * unterschieden, abgebrochene/ergebnislose Checks (RequiredOutcome
 * "unavailable") NIE als bestanden gewertet — eigener Marker statt
 * Gleichsetzung mit "failed" oder "success". */
function renderVerificationBody(body, core, line) {
  const verification = core?.verification;
  const running = state.runningVerificationCalls.size > 0;
  const hasData =
    verification ||
    state.verificationStatus ||
    running ||
    state.lastVerificationToolCallId;
  if (!hasData) {
    line("Noch keine Verifikation erfasst.");
    return;
  }

  if (running) {
    line("⏳ Prüfung läuft …", "verify-running");
  }

  if (verification?.status) {
    line(
      `Status: <strong>${esc(verification.status)}</strong>${verificationPill()}`,
    );
  } else if (state.verificationStatus) {
    line(`Status: ${esc(state.verificationStatus)}`);
  }

  for (const id of verification?.declaredRequiredIds ?? []) {
    const outcome = verification.requiredOutcomes?.[id];
    const { marker, label, cls } =
      interactions.verificationOutcomeMarker(outcome);
    line(
      `<span class="pill ${cls}">${marker}</span> ${esc(id)} — ${esc(label)}`,
    );
  }

  for (const id of verification?.blockingRecommendedIds ?? []) {
    line(
      `<span class="pill err">✗</span> ${esc(id)} — empfohlene Prüfung blockiert`,
    );
  }

  if (state.lastVerificationToolCallId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button verify-details-btn";
    button.textContent = "Details der letzten Prüfung ansehen";
    button.addEventListener("click", jumpToVerificationDetails);
    body.appendChild(button);
  }
}

/* ------------------- Changes Review (Phase 6, §08) ---------------------- */

/** Obergrenze gerenderter Diff-Zeilen je Datei — große Diffs bleiben so
 * performant (Abschlusskriterium), ohne den Datenumfang zu verstecken:
 * die Kürzung wird als eigene Zeile ausgewiesen (§"Fehler dürfen niemals
 * wegaggregiert werden" gilt sinngemäß auch für Datenverlust). */
const MAX_DIFF_LINES = 600;

/** Datei-Liste + Diff direkt darunter statt in einer zweiten Spalte — der
 * Inspector ist ein schmaler, in der Breite verstellbarer Drawer, kein
 * Editor-Layout (Nicht-Ziel "kein vollständiger Editor", §Cursor-Referenz:
 * Vorbild, keine 1:1-Kopie). Jede Datei ist ein eigenes <details>-Element
 * (wie die Activity-Cards, §Phase 3): Dateiname + Statistik immer sichtbar,
 * der eigentliche Diff wird erst beim Aufklappen gerendert (Performance). */
function renderChangesBody(body, core) {
  const changes = core?.changes;
  const summary = document.createElement("div");
  summary.className = "panel-line";
  if (changes) {
    summary.innerHTML =
      `<strong>${changes.filesCount}</strong> Datei(en) · ` +
      `+${changes.linesAdded}/−${changes.linesRemoved}`;
  } else if (state.editedFiles.size > 0) {
    summary.textContent = `${state.editedFiles.size} Datei(en) in dieser Sitzung editiert`;
  } else {
    summary.textContent = "Keine Änderungen gemeldet.";
  }
  body.appendChild(summary);

  // Reihenfolge/Vollständigkeit kommt aus core.changes (Core-Wahrheit,
  // R6); state.fileDiffs liefert dazu die Diff-Rohdaten, wo vorhanden.
  // Dateien, die core.changes (noch) nicht kennt, aber lokal editiert oder
  // schon als Diff aufgezeichnet wurden, ergänzen die Liste statt zu fehlen.
  const paths = [];
  const seen = new Set();
  for (const path of changes?.files ?? []) {
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  for (const path of [...state.fileDiffs.keys(), ...state.editedFiles]) {
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  if (paths.length === 0) return;

  const MAX_FILES = 60;
  for (const path of paths.slice(0, MAX_FILES)) {
    body.appendChild(renderChangedFileRow(path));
  }
  if (paths.length > MAX_FILES) {
    const more = document.createElement("div");
    more.className = "panel-line";
    more.textContent = `… und ${paths.length - MAX_FILES} weitere Datei(en)`;
    body.appendChild(more);
  }
}

function renderChangedFileRow(path) {
  const diff = state.fileDiffs.get(path);
  const details = document.createElement("details");
  details.className = "diff-file";
  details.open = state.expandedDiffFiles.has(path);

  const summary = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "diff-file-path";
  name.textContent = path;
  name.title = path;
  summary.appendChild(name);
  if (diff?.stats) {
    const stat = document.createElement("span");
    stat.className = "diff-file-stat";
    stat.textContent = `+${diff.stats.linesAdded}/−${diff.stats.linesRemoved}`;
    summary.appendChild(stat);
  }
  details.appendChild(summary);

  const content = document.createElement("div");
  content.className = "diff-file-content";
  details.appendChild(content);

  // Lazy: der eigentliche Diff wird erst beim ersten Aufklappen gerendert
  // (Abschlusskriterium "große Diffs bleiben performant").
  let rendered = false;
  details.addEventListener("toggle", () => {
    if (details.open) state.expandedDiffFiles.add(path);
    else state.expandedDiffFiles.delete(path);
    if (details.open && !rendered) {
      rendered = true;
      renderFileDiffContent(content, diff);
    }
  });
  if (details.open) {
    rendered = true;
    renderFileDiffContent(content, diff);
  }
  return details;
}

function renderFileDiffContent(content, diff) {
  content.innerHTML = "";
  if (!diff?.hunks?.length) {
    const empty = document.createElement("div");
    empty.className = "diff-empty";
    empty.textContent =
      "Diff nicht verfügbar (keine aufgezeichnete edit/write-Operation).";
    content.appendChild(empty);
    return;
  }
  let rendered = 0;
  outer: for (const hunk of diff.hunks) {
    const header = document.createElement("div");
    header.className = "diff-line diff-hunk-header";
    header.textContent =
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@` +
      (hunk.heading ? ` ${hunk.heading}` : "");
    content.appendChild(header);
    for (const diffLine of hunk.lines ?? []) {
      if (rendered >= MAX_DIFF_LINES) break outer;
      content.appendChild(renderDiffLineEl(diffLine));
      rendered++;
    }
  }
  if (rendered >= MAX_DIFF_LINES) {
    const truncated = document.createElement("div");
    truncated.className = "diff-empty";
    truncated.textContent = `… Diff nach ${MAX_DIFF_LINES} Zeilen gekürzt`;
    content.appendChild(truncated);
  }
}

function renderDiffLineEl(diffLine) {
  const row = document.createElement("div");
  const kind =
    diffLine.kind === "added"
      ? "add"
      : diffLine.kind === "removed"
        ? "remove"
        : "context";
  row.className = `diff-line diff-${kind}`;
  const marker = kind === "add" ? "+" : kind === "remove" ? "-" : " ";
  row.textContent = `${marker} ${diffLine.text ?? ""}`;
  return row;
}

/** Eine einzige, immer sichtbare Zeilenliste: Aufgabe/Kontext/Modell sind
 * reine Statuszeilen, Workflow löst eine Aktion aus (Picker), Änderungen/
 * Agenten/Verifikation klappen ihren Inhalt inline auf statt in ein
 * separates Panel zu wechseln (§5 — ersetzt die frühere Übersicht/Detail-
 * Umschaltung). Sitzungswechsel läuft seit Phase 2 über die Task-Sidebar
 * (siehe renderTaskSidebar()), nicht mehr über eine zweite, flache Liste
 * hier (§R6 — keine redundante Zustandsdarstellung). */
async function refreshContextOverview() {
  const rows = el("context-rows");
  if (!rows) return;
  const core = state.core;
  let contextPart = "—";
  try {
    const stats = await api.getStats();
    if (stats?.contextUsage && stats.contextUsage.percent !== null) {
      contextPart = `${stats.contextUsage.percent}% · ${stats.contextUsage.tokens} Tokens`;
    }
  } catch {
    /* nicht verbunden */
  }

  const rowDefs = [
    {
      // Der Task-Titel steht bereits prominent im Header (§Phase 1) — hier
      // keine zweite Anzeige, nur der reine Lauf-Status (§Phase 4).
      label: "Status",
      value: !state.connected
        ? "Nicht verbunden"
        : state.busy
          ? "Working"
          : "Bereit",
      empty: !state.connected,
    },
    {
      label: "Workflow",
      value: core?.workflow?.label || "Work",
      empty: !core?.workflow,
      action: () => openWorkflowPicker(),
    },
    {
      key: "verify",
      label: "Verifikation",
      value:
        (state.runningVerificationCalls.size > 0 ? "⏳ läuft … · " : "") +
        esc(core?.verification?.status || state.verificationStatus || "—") +
        verificationPill(),
      raw: true,
      empty:
        !core?.verification?.status &&
        !state.verificationStatus &&
        state.runningVerificationCalls.size === 0,
    },
    {
      key: "changes",
      label: "Änderungen",
      value: core?.changes
        ? `${core.changes.filesCount} Dateien`
        : `${state.editedFiles.size} Dateien (Sitzung)`,
      empty: !core?.changes && state.editedFiles.size === 0,
    },
    {
      key: "agents",
      label: "Agenten",
      value: agentsSummaryLabel(core?.subagents),
      empty: !(core?.subagents?.length > 0),
    },
    { label: "Kontext", value: contextPart, empty: contextPart === "—" },
    {
      label: "Modell",
      value: `${state.modelLabel || "—"} · Denken ${state.thinkingLabel || "—"}`,
      empty: !state.modelLabel,
    },
  ];

  rows.className = "";
  rows.innerHTML = "";
  const pending = [];
  for (const def of rowDefs) {
    const wrap = document.createElement("div");
    wrap.className = "context-row-wrap";

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = def.label;
    const value = document.createElement("span");
    value.className = def.empty ? "row-value empty" : "row-value";
    if (def.raw) value.innerHTML = def.value;
    else value.textContent = def.value;

    if (def.action) {
      // Eine Aktion (Picker öffnen), keine Navigation zu einem Detail.
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-row";
      button.title = `${def.label} wechseln`;
      button.append(label, value);
      button.addEventListener("click", def.action);
      wrap.appendChild(button);
    } else if (def.key) {
      const expanded = state.expandedRows.has(def.key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-row";
      button.dataset.expandKey = def.key;
      button.setAttribute("aria-expanded", String(expanded));
      const caret = document.createElement("span");
      caret.className = "row-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = expanded ? "▾" : "▸";
      button.append(caret, label, value);
      button.addEventListener("click", () => toggleRow(def.key));
      wrap.appendChild(button);
      if (expanded) {
        const body = document.createElement("div");
        body.className = "context-row-body";
        wrap.appendChild(body);
        pending.push(renderRowBody(body, def.key));
      }
    } else {
      // Reine Statuszeile ohne weiteren Inhalt: kein deaktivierter Button
      // (von Screenreadern meist übersprungen), sondern ein Status-Element.
      const row = document.createElement("div");
      row.className = "context-row static";
      row.setAttribute("role", "status");
      row.append(label, value);
      wrap.appendChild(row);
    }
    rows.appendChild(wrap);
  }

  if (state.notifications.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "context-row-wrap";
    const row = document.createElement("div");
    row.className = "context-row static";
    row.setAttribute("role", "status");
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = "Letzte Meldungen";
    const value = document.createElement("span");
    value.className = "row-value";
    value.textContent = state.notifications.slice(0, 3).join(" · ");
    row.append(label, value);
    wrap.appendChild(row);
    rows.appendChild(wrap);
  }

  await Promise.all(pending);
}

/* --------------------------- Status & Verbindung ----------------------- */

function applyRuntimeState(runtimeState) {
  state.sessionId =
    typeof runtimeState?.sessionId === "string" ? runtimeState.sessionId : null;
  state.connected = Boolean(state.sessionId);
  if (typeof runtimeState?.isStreaming === "boolean") {
    state.busy = runtimeState.isStreaming;
  }
  state.modelLabel = runtimeState?.model ? `${runtimeState.model.name}` : "";
  state.thinkingLabel = runtimeState?.thinkingLevel ?? "";
  refreshStatusBar();
  refreshComposerPills();
  renderTaskSidebar();
}

/** Composer ist der Agent-Control-Point (§Phase 5): Work/Modell/Denken
 * erscheinen nur hier, nicht zusätzlich im Header (keine Doppelanzeige). */
function refreshComposerPills() {
  const workflowPill = el("pill-workflow");
  if (workflowPill) {
    workflowPill.textContent = state.core?.workflow?.label ?? "Work";
    workflowPill.title = `Workflow: ${state.core?.workflow?.label ?? "—"} (Shift+Tab)`;
  }
  const modelPill = el("pill-model");
  if (modelPill) {
    modelPill.textContent = state.modelLabel || "Modell";
  }
  const thinkingPill = el("pill-thinking");
  if (thinkingPill) {
    thinkingPill.textContent = state.thinkingLabel
      ? `Denken: ${state.thinkingLabel}`
      : "Denken";
  }
}

async function refreshStateLabels() {
  try {
    applyRuntimeState(await api.getState());
    void refreshContextOverview();
  } catch {
    state.connected = false;
    state.sessionId = null;
    refreshStatusBar();
    setDot("error");
  }
}

async function loadConversation() {
  const data = await api.getMessages();
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  renderMessageHistory(messages);
}

function resetSessionView() {
  state.editedFiles.clear();
  state.core = null;
  state.fileDiffs.clear();
  state.expandedDiffFiles.clear();
  state.runningVerificationCalls.clear();
  state.lastVerificationToolCallId = null;
  clearChat();
  clearBanners();
}

/** Historische Diffs der Sitzung nachladen (Phase 6): Live-Events erfassen
 * nur Änderungen ab dem Zeitpunkt, an dem diese Sitzung zur aktuellen
 * wurde — frühere, bereits in der Sitzungsdatei persistierte Diffs kommen
 * nur über diesen Weg (readSessionDiffs, R2/R6: reines Nachlesen). */
async function loadSessionDiffs(sessionPath) {
  try {
    const diffs = await api.getSessionDiffs(sessionPath);
    for (const diff of diffs) state.fileDiffs.set(diff.path, diff);
  } catch {
    /* Änderungsliste bleibt auf Basis von core.changes nutzbar */
  }
}

async function withSessionTransition(operation) {
  if (state.sessionTransitioning) {
    showBanner("Sitzungswechsel läuft bereits.", "info");
    return false;
  }
  state.sessionTransitioning = true;
  el("btn-new-session").disabled = true;
  try {
    await operation();
    return true;
  } finally {
    state.sessionTransitioning = false;
    el("btn-new-session").disabled = false;
  }
}

function refreshProjectLabel() {
  const cwd = window.__piGuiCwd;
  const projectEl = el("project-label");
  if (!projectEl) return;
  if (!cwd) {
    projectEl.textContent = "—";
    return;
  }
  const parts = String(cwd).split("/").filter(Boolean);
  projectEl.textContent = parts.at(-1) || String(cwd);
  projectEl.title = String(cwd);
}

async function resumeSession(sessionPath) {
  if (state.busy) {
    showBanner("Pi arbeitet bereits. Stopp oder Warten.", "info");
    return;
  }
  await withSessionTransition(async () => {
    const result = await api.switchSession(sessionPath);
    if (result?.cancelled) {
      showBanner("Sitzungswechsel wurde abgebrochen.", "info");
      return;
    }
    resetSessionView();
    await refreshStateLabels();
    await loadConversation();
    await loadSessionDiffs(sessionPath);
    await refreshContextOverview();
    await refreshTaskList();
    showBanner("Sitzung geladen.", "info");
  }).catch((error) =>
    showBanner(
      `Sitzung konnte nicht geladen werden: ${error.message ?? error}`,
    ),
  );
}

async function startFreshSession() {
  if (!state.connected && !window.__piGuiCwd) {
    // Kein Projekt gewählt: ein Start gegen ein unbestimmtes Verzeichnis
    // wäre genau der ursprüngliche Projektauswahl-Bug.
    await openProjectPicker();
    return;
  }
  if (state.busy) {
    showBanner("Pi arbeitet bereits. Stopp oder Warten.", "info");
    return;
  }
  await withSessionTransition(async () => {
    setDot("busy");
    const result = state.connected
      ? await api.newSession()
      : await api.startSession({ cwd: window.__piGuiCwd || undefined });
    if (result?.cancelled) {
      showBanner("Neue Sitzung wurde abgebrochen.", "info");
      return;
    }
    resetSessionView();
    refreshProjectLabel();
    await refreshStateLabels();
    await loadConversation();
    await refreshContextOverview();
    await refreshTaskList();
  }).catch((error) => {
    setDot("error");
    setStatusText("Verbindung fehlgeschlagen");
    showBanner(`Verbindungsfehler: ${error.message ?? error}`);
  });
}

/** Startbildschirm (Phase 8, §10): ersetzt den vormals leeren, schwarzen
 * Startzustand. Taskstart bleibt die Primäraktion — das Eingabefeld ist
 * sofort fokussiert und nutzbar, "Letzte Projekte" ist rein sekundär
 * darunter. */
function renderNoProjectState() {
  chatEl.hidden = true;
  el("chat-placeholder").hidden = true;
  el("no-project").hidden = false;
  inputEl.disabled = true;
  el("btn-send").disabled = true;
  refreshProjectLabel();
  el("startscreen-input").value = "";
  el("startscreen-input").focus();
  void renderStartscreenRecentProjects();
}

function clearNoProjectState() {
  chatEl.hidden = false;
  el("no-project").hidden = true;
  inputEl.disabled = false;
  el("btn-send").disabled = false;
}

/** "Letzte Projekte" (Phase 8): dieselbe Persistenz wie im Projekt-Picker
 * (api.listRecentProjects()), hier aber direkt auf dem Startbildschirm
 * sichtbar statt hinter einem Dialog verborgen — sekundär, aber ohne
 * Umweg erreichbar. */
async function renderStartscreenRecentProjects() {
  const section = el("startscreen-recent");
  const list = el("startscreen-recent-list");
  let recent = [];
  try {
    recent = await api.listRecentProjects();
  } catch {
    /* Persistenz ist ein Komfortfeature, kein hartes Erfordernis */
  }
  list.innerHTML = "";
  section.hidden = recent.length === 0;
  if (recent.length === 0) return;
  for (const entry of recent) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "startscreen-recent-row";
    button.setAttribute("role", "listitem");
    const name = document.createElement("span");
    name.className = "startscreen-recent-name";
    name.textContent = interactions.projectDisplayName(entry.path);
    name.title = entry.path;
    const time = document.createElement("span");
    time.className = "startscreen-recent-time";
    time.textContent = interactions.relativeTimeLabel(entry.lastOpened);
    button.append(name, time);
    button.addEventListener("click", () => {
      void startProjectAndTask(entry.path, el("startscreen-input").value);
    });
    list.appendChild(button);
  }
}

/** Primäraktion des Startbildschirms: Projekt öffnen (Ordnerwahl nur bei
 * Bedarf, s. startProjectAndTask) und, falls beschrieben, den Task sofort
 * senden — "neuer Task sofort startbar" ohne Zwischenschritt "erst Projekt
 * wählen, dann erneut tippen". */
async function startTaskFromStartscreen() {
  const text = el("startscreen-input").value;
  const picked = await api.pickProjectFolder();
  if (!picked || picked.cancelled || !picked.path) return;
  await startProjectAndTask(picked.path, text);
}

/** Startet eine Sitzung in `cwd` und sendet optional den mitgegebenen
 * Text als ersten Prompt — gemeinsamer Kern für "Start →" (neuer Ordner)
 * und einen Klick auf ein "Letzte Projekte"-Element (bestehender Ordner). */
async function startProjectAndTask(cwd, text) {
  if (state.busy) {
    showBanner("Pi arbeitet bereits. Stopp oder Warten.", "info");
    return;
  }
  await withSessionTransition(async () => {
    setDot("busy");
    window.__piGuiCwd = cwd;
    const result = await api.startSession({ cwd });
    if (result?.cancelled) {
      showBanner("Projektstart wurde abgebrochen.", "info");
      return;
    }
    resetSessionView();
    clearNoProjectState();
    refreshProjectLabel();
    await refreshStateLabels();
    await loadConversation();
    await refreshContextOverview();
    await refreshTaskList();
    const trimmed = text.trim();
    if (trimmed) await sendMessage(trimmed);
  }).catch((error) => {
    setDot("error");
    setStatusText("Verbindung fehlgeschlagen");
    showBanner(
      `Projekt konnte nicht geöffnet werden: ${error.message ?? error}`,
    );
  });
}

/** Zeigt einen ruhigen Platzhalter statt einer leeren Hauptfläche, solange
 * ein Projekt offen ist, aber noch keine Nachricht existiert (frischer
 * Task) — Abschlusskriterium "keine leere Hauptfläche" (§10). Kein zweites
 * Eingabefeld: der echte Composer steht bereits am unteren Rand. */
function updateChatEmptyHint() {
  const placeholder = el("chat-placeholder");
  if (!placeholder) return;
  placeholder.hidden = chatEl.hidden || chatEl.childElementCount > 0;
}

/** Öffnet ein anderes Projekt (oder zum ersten Mal eins): stoppt eine
 * laufende Sitzung sauber und startet `pi --mode rpc` neu mit dem
 * gewählten Arbeitsverzeichnis (PiRpcManager bindet cwd fest beim
 * Spawnen, ein Wechsel ohne Stop-dann-Start ist nicht möglich). */
async function switchProject(cwd) {
  if (state.busy) {
    showBanner("Pi arbeitet bereits. Stopp oder Warten.", "info");
    return;
  }
  if (state.connected && cwd === window.__piGuiCwd) {
    showBanner("Projekt ist bereits geöffnet.", "info");
    return;
  }
  await withSessionTransition(async () => {
    setDot("busy");
    if (state.connected) await api.stopSession();
    state.connected = false;
    window.__piGuiCwd = cwd;
    const result = await api.startSession({ cwd });
    if (result?.cancelled) {
      showBanner("Projektwechsel wurde abgebrochen.", "info");
      return;
    }
    resetSessionView();
    clearNoProjectState();
    refreshProjectLabel();
    await refreshStateLabels();
    await loadConversation();
    await refreshContextOverview();
    showBanner("Projekt geöffnet.", "info");
  }).catch((error) => {
    setDot("error");
    setStatusText("Verbindung fehlgeschlagen");
    showBanner(
      `Projekt konnte nicht geöffnet werden: ${error.message ?? error}`,
    );
  });
}

/** Ordner-Picker + zuletzt geöffnete Projekte (§1) — auf Basis der
 * bestehenden generischen Listenauswahl `openPicker`. */
async function openProjectPicker() {
  let recent = [];
  try {
    recent = await api.listRecentProjects();
  } catch {
    /* Persistenz ist ein Komfortfeature, kein hartes Erfordernis */
  }
  const rows = [
    { label: "Ordner wählen …", value: "__pick__" },
    ...recent
      .filter((entry) => entry.path !== window.__piGuiCwd)
      .map((entry) => ({
        label: interactions.projectDisplayName(entry.path),
        desc: entry.path,
        value: entry.path,
      })),
  ];
  openPicker("Projekt öffnen", rows, async (value) => {
    let cwd = value;
    if (value === "__pick__") {
      const picked = await api.pickProjectFolder();
      if (!picked || picked.cancelled || !picked.path) return;
      cwd = picked.path;
    }
    await switchProject(cwd);
  });
}

async function sendMessage(text, opts = {}) {
  if (state.busy) {
    showBanner("Pi arbeitet bereits. Stopp oder Warten.", "info");
    return false;
  }
  let accepted = false;
  try {
    state.busy = true;
    refreshStatusBar();
    el("btn-stop").disabled = false;
    if (!opts.skipLocalEcho) {
      state.pendingLocalEchoes.push(text);
      appendUserBubble(text);
    }
    await api.prompt(text);
    accepted = true;
    // Slash-Commands können vollständig lokal enden und erzeugen dann kein
    // agent_settled. Der Core-State entscheidet autoritativ über das Busy-UI.
    applyRuntimeState(await api.getState());
    return true;
  } catch (err) {
    if (!opts.skipLocalEcho && !accepted) {
      const echoIndex = state.pendingLocalEchoes.lastIndexOf(text);
      if (echoIndex >= 0) state.pendingLocalEchoes.splice(echoIndex, 1);
    }
    state.busy = false;
    el("btn-stop").disabled = true;
    refreshStatusBar();
    showBanner(`Senden fehlgeschlagen: ${err.message ?? err}`);
    return false;
  }
}

function refreshStatusBar() {
  setStatusText(
    !state.connected ? "Nicht verbunden" : state.busy ? "Arbeitet …" : "Bereit",
  );
  setDot(!state.connected ? "idle" : state.busy ? "busy" : "ready");
  el("btn-stop").disabled = !state.busy;
  // Composer als Agent-Control-Point (§Phase 5): Placeholder macht den
  // laufenden Task sichtbar, auch wenn der Nutzer gerade nicht tippt.
  if (inputEl) {
    inputEl.placeholder = state.busy
      ? "Anweisung an laufenden Task … (erst Stopp, dann senden)"
      : "Nachricht an Pi … (Enter sendet, Shift+Enter neue Zeile)";
  }
}

/* ---------------------- Shortcuts (Phase 4, R5) ------------------------ */

const actions = {
  "workflow.open": () => openWorkflowPicker(),
  "workflow.set": () => openWorkflowPicker(),
  "model.open": () => openModelPicker(),
  "model.cycle": async () => {
    try {
      await api.cycleModel();
    } finally {
      await refreshStateLabels();
    }
  },
  "thinking.open": () => openThinkingPicker(),
  "thinking.cycle": async () => {
    try {
      await api.cycleThinkingLevel();
    } finally {
      await refreshStateLabels();
    }
  },
  "permissions.open": () => sendMessage("/permission", { skipLocalEcho: true }),
  "yolo.toggle": () => sendMessage("/yolo", { skipLocalEcho: true }),
  "app.commandCenter": () => openCommandPalette(),
  "session.resume": () => openSessionResume(),
  "session.create": () => startFreshSession(),
  "inspector.open": () => toggleContextArea(),
  "changes.view": () => setActiveView("changes"),
  "subagents.rolesModel": () =>
    sendMessage("/subagents-set-model", { skipLocalEcho: true }),
  "editor.yank": () =>
    showBanner(
      "editor.yank ist TUI-editornativ und hat bewusst keine GUI-Entsprechung.",
      "info",
    ),
};

function setupShortcuts() {
  window.addEventListener("keydown", (event) => {
    // Escape schließt den Inspector-Drawer (§Phase 4) — tritt zurück, wenn
    // gerade ein natives <dialog> offen ist (das behandelt Escape selbst).
    if (
      event.key === "Escape" &&
      document.body.classList.contains("context-open") &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      closeContextDrawer();
      return;
    }
    if (event.repeat) return;
    const combo = interactions.comboFromKeyboardEvent(event);
    if (!combo) return;
    const binding = state.shortcutByKey[combo];
    if (!binding) return;
    event.preventDefault();
    const action = actions[binding.command];
    if (typeof action !== "function") {
      showBanner(`Command ${binding.command} ist nicht verdrahtet.`);
      return;
    }
    void Promise.resolve(action()).catch((error) =>
      showBanner(`Aktion fehlgeschlagen: ${error.message ?? error}`),
    );
  });
}

/**
 * §16-Fix: Der Header kann bei schmalen Fenstern umbrechen (mehrzeilig
 * werden). `--header-h` darf dann keine feste Pixelannahme mehr sein,
 * sonst überlappt der Inspector-Drawer den umgebrochenen Header. Statt
 * eines CSS-Breakpoint-Ratens wird die tatsächliche Headerhöhe live
 * gemessen und als CSS-Variable gespiegelt.
 */
function observeHeaderHeight() {
  const header = el("status-bar");
  if (!header || typeof ResizeObserver === "undefined") return;
  const sync = () => {
    document.documentElement.style.setProperty(
      "--header-h",
      `${Math.ceil(header.getBoundingClientRect().height)}px`,
    );
  };
  new ResizeObserver(sync).observe(header);
  sync();
}

/* --------------------- Inspector-Resize (§3) --------------------------- */

const INSPECTOR_MIN_W = 240;
const INSPECTOR_MAX_W = 480;
const INSPECTOR_W_STORAGE_KEY = "pi-gui-inspector-width";

function currentInspectorWidth() {
  return parseInt(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--inspector-w",
    ),
    10,
  );
}

function applyInspectorWidth(px) {
  const clamped = Math.min(INSPECTOR_MAX_W, Math.max(INSPECTOR_MIN_W, px));
  document.documentElement.style.setProperty("--inspector-w", `${clamped}px`);
  return clamped;
}

function persistInspectorWidth() {
  try {
    localStorage.setItem(
      INSPECTOR_W_STORAGE_KEY,
      String(currentInspectorWidth()),
    );
  } catch {
    /* Bedienkomfort, kein hartes Erfordernis */
  }
}

function restoreInspectorWidth() {
  try {
    const stored = Number(localStorage.getItem(INSPECTOR_W_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) applyInspectorWidth(stored);
  } catch {
    /* localStorage evtl. gesperrt (privater Modus) — Default bleibt gültig */
  }
}

/** Inspector ist immer ein Overlay-Drawer (§Phase 1) — die Breite bleibt
 * bei jeder Fensterbreite per Ziehgriff einstellbar. */
function setupInspectorResize() {
  const handle = el("inspector-resize-handle");
  if (!handle) return;
  let dragging = false;

  const onPointerMove = (event) => {
    if (!dragging) return;
    applyInspectorWidth(window.innerWidth - event.clientX);
  };
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing-inspector");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    persistInspectorWidth();
  };
  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    document.body.classList.add("resizing-inspector");
    event.preventDefault();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft")
      applyInspectorWidth(currentInspectorWidth() + 16);
    else if (event.key === "ArrowRight")
      applyInspectorWidth(currentInspectorWidth() - 16);
    else return;
    event.preventDefault();
    persistInspectorWidth();
  });
}

/* -------------------------------- Boot --------------------------------- */

async function boot() {
  api.onEvent(handleEvent);
  api.onPiExit((info) => {
    state.connected = false;
    state.sessionId = null;
    state.busy = false;
    state.core = null;
    refreshStatusBar();
    showBanner(interactions.piExitMessage(info));
  });

  state.shortcutByKey = {};
  try {
    for (const mapping of await api.getShortcuts()) {
      state.shortcutByKey[mapping.keys] = mapping;
    }
  } catch {
    /* Shortcuts bleiben ungebunden; Maus bleibt voll nutzbar */
  }
  setupShortcuts();

  for (const item of document.querySelectorAll(".nav-item")) {
    item.addEventListener("click", () => setActiveView(item.dataset.view));
  }
  el("btn-refresh-context").addEventListener("click", () =>
    refreshContextOverview(),
  );
  chatEl.addEventListener("scroll", () => {
    setFollowScroll(interactions.isNearBottom(chatEl));
  });
  el("btn-jump-latest").addEventListener("click", () => scrollToBottom(true));
  // Markdown-Links (chat/markdown.js) sind echte <a>-Elemente, aber das
  // Fenster blockt jede In-App-Navigation (main/index.js). Ohne diesen
  // Handler sähen Links klickbar aus und würden nichts tun.
  chatEl.addEventListener("click", (event) => {
    const link =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || !chatEl.contains(link)) return;
    event.preventDefault();
    api
      .openExternal(link.href)
      .catch((error) =>
        showBanner(
          `Link konnte nicht geöffnet werden: ${error.message ?? error}`,
        ),
      );
  });

  el("btn-send").addEventListener("click", () => {
    const text = inputEl.value;
    if (!text.trim()) return;
    inputEl.value = "";
    sendMessage(text);
  });
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const text = inputEl.value;
      if (!text.trim() || state.busy) return;
      inputEl.value = "";
      sendMessage(text);
    }
  });
  el("btn-stop").addEventListener("click", () => {
    api.abort().catch(() => undefined);
  });
  el("btn-new-session").addEventListener("click", () => startFreshSession());
  el("pill-workflow").addEventListener("click", () => openWorkflowPicker());
  el("pill-model").addEventListener("click", () => openModelPicker());
  el("pill-thinking").addEventListener("click", () => openThinkingPicker());
  el("btn-palette").addEventListener("click", () => openCommandPalette());
  el("btn-toggle-inspector").addEventListener("click", () =>
    toggleContextArea(),
  );
  el("project-label").addEventListener("click", () => openProjectPicker());
  el("btn-open-project").addEventListener("click", () =>
    startTaskFromStartscreen(),
  );
  el("startscreen-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void startTaskFromStartscreen();
  });
  el("startscreen-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void startTaskFromStartscreen();
    }
  });
  el("btn-new-task").addEventListener("click", () => startFreshSession());
  el("btn-collapse-tasks").addEventListener("click", () =>
    toggleTaskSidebarCollapsed(),
  );
  observeHeaderHeight();
  restoreInspectorWidth();
  setupInspectorResize();
  restoreTaskSidebarCollapsed();

  if (!isSmokeMode) {
    if (initialCwdParam) {
      window.__piGuiCwd = initialCwdParam;
      refreshProjectLabel();
      await startFreshSession();
      await refreshContextOverview();
    } else {
      renderNoProjectState();
    }
  }
}

boot();

/**
 * Headless-Smoke-Hook (wird vom Main-Prozess über executeJavaScript auf-
 * gerufen): echte Preload-Bridge, echter Pi, echte Session.
 */
window.__piGuiSmoke = async function __piGuiSmoke(mode, cwd) {
  try {
    window.__piGuiCwd = cwd;
    let sawToolStart = false;
    let sawActivitySummary = false;
    let settled = false;
    let assistantText = "";
    api.onEvent((msg) => {
      if (msg.type === "tool_execution_start") sawToolStart = true;
      if (msg.type === "agent_settled") settled = true;
      if (
        msg.type === "message_update" &&
        msg.assistantMessageEvent &&
        msg.assistantMessageEvent.type === "text_delta"
      ) {
        assistantText += String(msg.assistantMessageEvent.delta ?? "");
      }
      if (msg.type === "tool_execution_end") {
        sawActivitySummary = Boolean(
          document.querySelector(".activity-card .activity-title"),
        );
      }
    });
    applyRuntimeState(await api.startSession({ cwd, noSession: true }));
    if (mode === "dialogs") {
      // Die nur im Dialog-Smoke geladene Fixture öffnet einen echten
      // providerfreien RPC-Select-Dialog.
      const promptResult = api.prompt("/gui-smoke-dialog").then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      const dialogDeadline = Date.now() + 10_000;
      let dialog = null;
      while (!dialog && Date.now() < dialogDeadline) {
        dialog = document.querySelector("dialog.ui-dialog");
        if (!dialog) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!dialog) throw new Error("Extension-Dialog wurde nicht angezeigt");
      // Das cancel-Ereignis ist der Browser-Pfad für Escape. Der Renderer muss
      // die Anfrage genau einmal beantworten und den Dialog entfernen.
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      const closeDeadline = Date.now() + 5_000;
      while (
        document.querySelector("dialog.ui-dialog") &&
        Date.now() < closeDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (document.querySelector("dialog.ui-dialog")) {
        throw new Error("Extension-Dialog wurde nach Escape nicht geschlossen");
      }
      const prompt = await promptResult;
      if (!prompt.ok) throw prompt.error;
      if (!(await sendMessage("/gui-smoke-noop", { skipLocalEcho: true }))) {
        throw new Error("lokaler Slash-Command wurde nicht angenommen");
      }
      if (state.busy) {
        throw new Error("lokaler Slash-Command ließ die GUI im Busy-Zustand");
      }
      // Der Renderer unterstützt keinen Mehrzeilen-Editor. Seine explizite
      // Cancellation muss den Core dennoch wieder freigeben.
      await api.prompt("/gui-smoke-editor");
      const recovered = await api.getState();
      if (!recovered?.sessionId) {
        throw new Error("Pi ist nach Dialog-Abbruch nicht mehr bedienbar");
      }
      await api.stopSession();
      return { ok: true, mode, sawToolStart, text: "" };
    }
    await api.prompt(
      mode === "tools"
        ? "Lies docs/gui-baseline/baseline-tests.md und antworte ausschließlich mit: BASELINE-OK"
        : "Antworte ausschließlich mit: SMOKE-OK",
    );
    const deadline = Date.now() + 170_000;
    while (!settled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!settled) throw new Error("agent_settled blieb aus");
    if (mode === "tools") {
      if (!sawToolStart) throw new Error("kein Tool-Ereignis gesehen");
      if (!sawActivitySummary)
        throw new Error("keine Aktivitätskarte im Chat gerendert");
    }
    const token = mode === "tools" ? "BASELINE-OK" : "SMOKE-OK";
    if (!assistantText.includes(token)) {
      throw new Error(`Antwort enthielt '${token}' nicht`);
    }
    await api.stopSession();
    return { ok: true, mode, sawToolStart, text: assistantText };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
};
