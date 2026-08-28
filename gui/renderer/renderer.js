/**
 * Renderer-Logik der GUI (Phase 6: Chat als Hauptfläche, kompakte
 * Tool-Aktivität, Zustände auf Abruf). Spricht ausschließlich über die
 * preload-freigegebene window.piGui-API. Keine Geschäftslogik: Alle
 * fachlichen Entscheidungen bleiben im Pi-Prozess (R1/R2/R11).
 */
"use strict";

const api = window.piGui;
const activity = window.piGuiActivity;
const interactions = window.piGuiInteractions;
const isSmokeMode = new URLSearchParams(window.location.search).has("smoke");

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

let bannerTimer = null;
function showBanner(message, kind = "error") {
  bannerEl.textContent = message;
  bannerEl.className = kind === "info" ? "info" : "";
  bannerEl.hidden = false;
  clearTimeout(bannerTimer);
  if (kind === "info") {
    bannerTimer = setTimeout(() => {
      bannerEl.hidden = true;
    }, 6000);
  }
}

/* ------------------------------ Chat ---------------------------------- */

function setFollowScroll(follow) {
  state.followScroll = follow;
  const jumpButton = el("btn-jump-latest");
  if (jumpButton) jumpButton.hidden = follow;
}

function scrollToBottom(force = false) {
  if (!force && !state.followScroll) {
    const jumpButton = el("btn-jump-latest");
    if (jumpButton) jumpButton.hidden = false;
    return;
  }
  chatEl.scrollTop = chatEl.scrollHeight;
  setFollowScroll(true);
}

function clearChat() {
  chatEl.innerHTML = "";
  state.currentAssistant = null;
  state.pendingLocalEchoes = [];
  closeActivityGroup();
  setFollowScroll(true);
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
  return { wrap, bubble, text: "", thinking: "", thinkingView: null };
}

function setAssistantThinking(block, text) {
  block.thinking = text;
  if (!text) {
    block.thinkingView?.details.remove();
    block.thinkingView = null;
    return;
  }
  if (!block.thinkingView) {
    const details = document.createElement("details");
    details.className = "thinking-block";
    const summary = document.createElement("summary");
    summary.textContent = "Denken";
    const pre = document.createElement("pre");
    details.append(summary, pre);
    block.wrap.appendChild(details);
    block.thinkingView = { details, pre };
  }
  block.thinkingView.pre.textContent = text;
}

function setAssistantText(block, text) {
  block.text = text;
  block.bubble.textContent = text;
}

function applyAssistantContent(block, content) {
  setAssistantText(block, interactions.textFromContent(content).trim());
  setAssistantThinking(block, interactions.thinkingFromContent(content));
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

/* ------------------ Aktivitätsgruppen (Phase 6, R8) -------------------- */

/**
 * Eine Aktivitätsgruppe fasst die Werkzeugaufrufe zwischen zwei
 * Nachrichten zu einer kompakten Zeile zusammen; die Einzelkarten gibt
 * es erst auf Abruf (Details-Element).
 */
function ensureActivityGroup() {
  if (state.currentActivity) return state.currentActivity;
  const group = document.createElement("details");
  group.className = "activity-group";
  const summary = document.createElement("summary");
  summary.textContent = "Aktivität …";
  const tools = document.createElement("div");
  tools.className = "activity-tools";
  group.append(summary, tools);
  chatEl.appendChild(group);
  state.currentActivity = { group, summary, tools, entries: [] };
  return state.currentActivity;
}

function closeActivityGroup() {
  state.currentActivity = null;
}

function refreshActivitySummary() {
  const act = state.currentActivity;
  if (!act) return;
  const line = activity.formatActivityLine(act.entries);
  act.summary.textContent = line || "Aktivität";
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
        setAssistantText(
          state.currentAssistant,
          state.currentAssistant.text + String(ev.delta ?? ""),
        );
        scrollToBottom();
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
      applyAssistantContent(state.currentAssistant, message.content);
      state.currentAssistant = null;
      scrollToBottom();
      break;
    }
    case "tool_execution_start": {
      const act = ensureActivityGroup();
      act.entries.push({
        toolCallId: msg.toolCard.toolCallId,
        toolName: msg.toolCard.toolName,
        running: true,
        isError: false,
      });
      act.tools.appendChild(toolCardElement(msg.toolCard));
      refreshActivitySummary();
      scrollToBottom();
      break;
    }
    case "tool_execution_update": {
      const act = state.currentActivity;
      const root = act ? act.tools : chatEl;
      const cards = root.querySelectorAll("details.tool-card");
      for (const card of Array.from(cards).reverse()) {
        if (card.__toolCallId !== msg.toolCallId) continue;
        setToolCardOutput(card.querySelector("pre"), msg.partialResult);
        break;
      }
      break;
    }
    case "tool_execution_end": {
      const act = state.currentActivity;
      if (act) {
        const entry = act.entries.find(
          (candidate) => candidate.toolCallId === msg.toolCallId,
        );
        if (entry) {
          entry.running = false;
          entry.isError = Boolean(msg.isError);
        }
        refreshActivitySummary();
      }
      const root = act ? act.tools : chatEl;
      const cards = root.querySelectorAll("details.tool-card");
      for (const card of Array.from(cards).reverse()) {
        if (card.__toolCallId !== msg.toolCallId) continue;
        card.classList.remove("running");
        card.classList.add(msg.isError ? "done-error" : "done-ok");
        setToolCardOutput(card.querySelector("pre"), msg.result);
        if (!msg.isError && ["edit", "write"].includes(String(msg.toolName))) {
          state.editedFiles.add(toolTargetPath(msg.args));
        }
        break;
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
      applyCoreEntry(msg.entry);
      break;
    case "custom":
      applyCoreEntry(msg);
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
  if (el("context-panel").hidden === false) renderActivePanel();
}

function refreshCoreChips() {
  const workflowEl = el("workflow-label");
  const permissionEl = el("permission-label");
  const core = state.core;
  if (workflowEl) {
    workflowEl.textContent = core?.workflow?.label ?? "Work";
    workflowEl.title = `Workflow: ${core?.workflow?.label ?? "—"} (Shift+Tab)`;
  }
  if (permissionEl) {
    permissionEl.textContent = core?.permissions?.label ?? "";
    permissionEl.hidden = !core?.permissions?.label;
  }
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

const PANEL_TITLES = {
  changes: "Änderungen",
  agents: "Subagenten",
  verify: "Verifikation",
  sessions: "Sitzungen",
};

function setActiveNav(view) {
  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  state.activeView = view;
}

function setActiveView(view) {
  setActiveNav(view);
  if (view === "chat") {
    showContextOverview();
    return;
  }
  openContextPanel(view);
}

function openContextPanel(view) {
  setActiveNav(view);
  el("context-overview").hidden = true;
  el("context-panel").hidden = false;
  el("context-panel-title").textContent = PANEL_TITLES[view] ?? view;
  state.panelView = view;
  renderActivePanel();
  if (isNarrowLayout()) document.body.classList.add("context-open");
}

function showContextOverview() {
  el("context-panel").hidden = true;
  el("context-overview").hidden = false;
  state.panelView = undefined;
  refreshContextOverview();
}

function isNarrowLayout() {
  return window.matchMedia("(max-width: 1080px)").matches;
}

/** Super+I: Kontextbereich ein-/ausblenden (breit) bzw. Drawer (schmal). */
function toggleContextArea() {
  if (isNarrowLayout()) {
    document.body.classList.toggle("context-open");
  } else {
    document.body.classList.toggle("context-hidden");
  }
}

function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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

/** Kompakte Übersicht: ein klickbarer Zustand pro Zeile, Details im Panel. */
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
      label: "Aufgabe",
      value: core?.task?.title || "—",
      empty: !core?.task?.title || core.task.title === "Aktuelle Aufgabe",
    },
    {
      label: "Workflow",
      value: core?.workflow?.label || "Work",
      empty: !core?.workflow,
    },
    {
      label: "Verifikation",
      value:
        esc(core?.verification?.status || state.verificationStatus || "—") +
        verificationPill(),
      raw: true,
      empty: !core?.verification?.status && !state.verificationStatus,
      view: "verify",
    },
    {
      label: "Änderungen",
      value: core?.changes
        ? `${core.changes.filesCount} Dateien`
        : `${state.editedFiles.size} Dateien (Sitzung)`,
      empty: !core?.changes && state.editedFiles.size === 0,
      view: "changes",
    },
    {
      label: "Agenten",
      value:
        core?.subagents?.length > 0
          ? `${core.subagents.length} aktiv`
          : "keine",
      empty: !(core?.subagents?.length > 0),
      view: "agents",
    },
    { label: "Kontext", value: contextPart, empty: contextPart === "—" },
    {
      label: "Modell",
      value: `${state.modelLabel || "—"} · Denken ${state.thinkingLabel || "—"}`,
      empty: !state.modelLabel,
    },
  ];

  rows.innerHTML = "";
  for (const def of rowDefs) {
    const button = document.createElement("button");
    button.className = "context-row";
    button.type = "button";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = def.label;
    const value = document.createElement("span");
    value.className = def.empty ? "row-value empty" : "row-value";
    if (def.raw) {
      value.innerHTML = def.value;
    } else {
      value.textContent = def.value;
    }
    button.append(label, value);
    if (def.view) {
      button.title = `${def.label} öffnen`;
      button.addEventListener("click", () => openContextPanel(def.view));
    } else if (def.label === "Workflow") {
      button.title = "Workflow wechseln";
      button.addEventListener("click", () => openWorkflowPicker());
    } else {
      button.disabled = true;
    }
    rows.appendChild(button);
  }

  if (state.notifications.length > 0) {
    const note = document.createElement("button");
    note.className = "context-row";
    note.type = "button";
    note.disabled = true;
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = "Letzte Meldungen";
    const value = document.createElement("span");
    value.className = "row-value";
    value.textContent = state.notifications.slice(0, 3).join(" · ");
    note.append(label, value);
    rows.appendChild(note);
  }

  if (state.panelView) renderActivePanel();
}

/** Detailpanel je Ansicht — gespeist aus Core-State, nie aus Chattext. */
async function renderActivePanel() {
  const body = el("context-panel-body");
  if (!body || !state.panelView) return;
  const core = state.core;
  body.innerHTML = "";
  const line = (html) => {
    const div = document.createElement("div");
    div.className = "panel-line";
    div.innerHTML = html;
    body.appendChild(div);
  };

  if (state.panelView === "changes") {
    const changes = core?.changes;
    if (changes) {
      line(
        `<strong>${changes.filesCount}</strong> Datei(en) · ` +
          `+${changes.linesAdded}/−${changes.linesRemoved}`,
      );
      for (const file of changes.files.slice(0, 40)) line(esc(file));
    } else {
      line("Keine Core-Änderungen gemeldet.");
    }
    if (state.editedFiles.size > 0) {
      line("<strong>In dieser Sitzung editiert</strong>");
      for (const file of state.editedFiles) line(esc(file));
    }
    return;
  }

  if (state.panelView === "agents") {
    const subagents = core?.subagents ?? [];
    if (subagents.length === 0) {
      line("Keine aktiven Subagenten.");
      return;
    }
    for (const entry of subagents) {
      line(`${esc(entry.role || entry.agent)} — ${esc(entry.status)}`);
    }
    return;
  }

  if (state.panelView === "verify") {
    const verification = core?.verification;
    if (!verification && !state.verificationStatus) {
      line("Noch keine Verifikation erfasst.");
      return;
    }
    if (verification?.status) {
      line(`Status: <strong>${esc(verification.status)}</strong>`);
    }
    for (const id of verification?.declaredRequiredIds ?? []) {
      const outcome = verification.requiredOutcomes?.[id] ?? "pending";
      const marker =
        outcome === "success" ? "✓" : outcome === "pending" ? "○" : "✗";
      line(`${marker} ${esc(id)}: ${esc(outcome)}`);
    }
    for (const id of verification?.blockingRecommendedIds ?? []) {
      line(`✗ ${esc(id)}: empfohlene Prüfung blockiert`);
    }
    if (state.verificationStatus) {
      line(`Footer: ${esc(state.verificationStatus)}`);
    }
    return;
  }

  if (state.panelView === "sessions") {
    line("Lade Sitzungen …");
    try {
      const sessions = await api.listSessions();
      body.innerHTML = "";
      if (sessions.length === 0) {
        line("Keine gespeicherten Sitzungen gefunden.");
        return;
      }
      for (const session of sessions) {
        const button = document.createElement("button");
        button.className = "context-row";
        button.type = "button";
        const label = document.createElement("span");
        label.className = "row-label";
        label.textContent = new Date(session.mtimeMs).toLocaleString();
        const value = document.createElement("span");
        value.className = "row-value";
        value.textContent = session.title;
        button.append(label, value);
        button.addEventListener("click", () => {
          void resumeSession(session.path);
        });
        body.appendChild(button);
      }
    } catch (err) {
      body.innerHTML = "";
      line(esc(String(err.message ?? err)));
    }
  }
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
  el("model-label").textContent = state.modelLabel;
  el("thinking-label").textContent = state.thinkingLabel
    ? `Denken ${state.thinkingLabel}`
    : "";
  refreshStatusBar();
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
  clearChat();
  bannerEl.hidden = true;
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
    await refreshContextOverview();
    showBanner("Sitzung geladen.", "info");
  }).catch((error) =>
    showBanner(
      `Sitzung konnte nicht geladen werden: ${error.message ?? error}`,
    ),
  );
}

async function startFreshSession() {
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
  }).catch((error) => {
    setDot("error");
    setStatusText("Verbindung fehlgeschlagen");
    showBanner(`Verbindungsfehler: ${error.message ?? error}`);
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
  el("btn-panel-back").addEventListener("click", () => {
    setActiveView("chat");
    if (isNarrowLayout()) document.body.classList.remove("context-open");
  });
  el("btn-refresh-context").addEventListener("click", () =>
    refreshContextOverview(),
  );
  chatEl.addEventListener("scroll", () => {
    setFollowScroll(interactions.isNearBottom(chatEl));
  });
  el("btn-jump-latest").addEventListener("click", () => scrollToBottom(true));

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
  el("btn-model").addEventListener("click", () => openModelPicker());
  el("btn-thinking").addEventListener("click", () => openThinkingPicker());
  el("btn-palette").addEventListener("click", () => openCommandPalette());

  if (!isSmokeMode) {
    refreshProjectLabel();
    await startFreshSession();
    await refreshContextOverview();
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
          document.querySelector("details.activity-group > summary"),
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
        throw new Error("keine Aktivitätszeile im Chat gerendert");
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
