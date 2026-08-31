/**
 * Renderer-Logik der Pi-GUI: Coding-Agenten Desktop-Frontend mit
 * vollwertigem Subagenten-Run-System, Workspace-Tabs und sicherem Markdown.
 *
 * Spricht ausschließlich über die preload-freigegebene window.piGui-API.
 * Alle fachlichen Entscheidungen bleiben im Pi-Prozess (R1/R2/R11).
 */
"use strict";

const api = window.piGui;
const interactions = window.piGuiInteractions;
const runsModule = window.piGuiAgentRuns;
const isSmokeMode = new URLSearchParams(window.location.search).has("smoke");
const initialCwdParam =
  new URLSearchParams(window.location.search).get("cwd") || "";

/* ----------------------------- Zustand -------------------------------- */

const runStore = new runsModule.AgentRunStore();

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
  followRunScroll: true,
  sessionId: null,
  sessionTransitioning: false,
  core: null,
  expandedRows: new Set(["subagents"]),
  taskListCache: [],
  contextDrawerPreviousFocus: null,
  fileDiffs: new Map(),
  expandedDiffFiles: new Set(),
  runningVerificationCalls: new Map(),
  lastVerificationToolCallId: null,
  activeRunSubpane: "output",
  runToolFilter: "all",
  promptHistory: [],
  historyIndex: -1,
  tempDraft: "",
  diffSplitModes: new Map(),
  durationTimer: null,
};

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

/* ----------------------------- Banner --------------------------------- */

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

function streamAssistantText(block, text) {
  block.text = text;
  scheduleStreamRender(block);
}

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

/* ------------------------ Activity Stream ------------------------------ */

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

function activityTargetFromSummary(summary) {
  return String(summary ?? "")
    .replace(/^[A-Z_]+\s*/, "")
    .trim();
}

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

/* ------------------- Subagent Chat Cards (Ebene 1) --------------------- */

function createSubagentChatCard(run) {
  const card = document.createElement("div");
  card.className = "subagent-chat-card running";
  card.dataset.runId = run.id;

  const header = document.createElement("div");
  header.className = "subagent-card-header";

  const identity = document.createElement("div");
  identity.className = "subagent-card-identity";
  const glyph = document.createElement("span");
  glyph.className = "subagent-card-glyph";
  glyph.textContent = "●";
  glyph.style.color = "var(--running)";

  const name = document.createElement("strong");
  name.className = "subagent-card-name";
  name.textContent = run.agentName;

  const statusSpan = document.createElement("span");
  statusSpan.className = "subagent-card-status";
  statusSpan.textContent = "arbeitet …";

  identity.append(glyph, name, statusSpan);

  const duration = document.createElement("span");
  duration.className = "subagent-card-time";
  duration.textContent = "jetzt";

  header.append(identity, duration);

  const taskDiv = document.createElement("div");
  taskDiv.className = "subagent-card-task";
  taskDiv.textContent = run.task || "Teilaufgabe wird ausgeführt";

  const actions = document.createElement("div");
  actions.className = "subagent-card-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "ghost-button btn-open-run";
  openBtn.innerHTML = `<svg viewBox="0 0 24 24" class="btn-icon"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg> Lauf öffnen`;
  openBtn.addEventListener("click", () => {
    runStore.openTab(run.id);
  });

  actions.appendChild(openBtn);
  card.append(header, taskDiv, actions);
  chatEl.appendChild(card);
  scrollToBottom();
  return card;
}

function updateSubagentChatCard(run) {
  const card = chatEl.querySelector(
    `.subagent-chat-card[data-run-id="${run.id}"]`,
  );
  if (!card) return;

  const timeEl = card.querySelector(".subagent-card-time");
  if (timeEl) {
    timeEl.textContent = runsModule.formatDuration(run.durationMs);
  }

  if (run.isFinished) {
    card.classList.remove("running");
    const isErr = run.state === runsModule.RUN_STATES.FAILED;
    card.classList.add(isErr ? "done-error" : "done-ok");

    const glyph = card.querySelector(".subagent-card-glyph");
    if (glyph) {
      glyph.textContent = isErr ? "✕" : "✓";
      glyph.style.color = isErr ? "var(--err)" : "var(--ok)";
    }

    const statusSpan = card.querySelector(".subagent-card-status");
    if (statusSpan) {
      statusSpan.textContent = `· ${runsModule.formatDuration(run.durationMs)}`;
    }

    // Zusammenfassung einbauen
    let summaryDiv = card.querySelector(".subagent-card-summary");
    if (!summaryDiv) {
      summaryDiv = document.createElement("div");
      summaryDiv.className = "subagent-card-summary";
      card.insertBefore(
        summaryDiv,
        card.querySelector(".subagent-card-actions"),
      );
    }

    let summaryText = "";
    if (typeof run.result === "string") summaryText = run.result;
    else if (run.result?.summary) summaryText = run.result.summary;
    else if (run.error) summaryText = `Fehler: ${run.error}`;
    else summaryText = `${run.agentName} abgeschlossen`;

    summaryDiv.textContent =
      summaryText.length > 180 ? `${summaryText.slice(0, 177)}…` : summaryText;
  }
}

/* ---------------------- Workspace Tabs (Ebene 3) ----------------------- */

function renderWorkspaceTabs() {
  const tabsContainer = el("tabs-list");
  if (!tabsContainer) return;
  tabsContainer.innerHTML = "";

  for (const tabId of runStore.openTabs) {
    const isChat = tabId === "chat";
    const run = isChat ? null : runStore.getRun(tabId);
    const isActive = isChat
      ? runStore.activeRunId === null
      : runStore.activeRunId === tabId;

    const tabBtn = document.createElement("button");
    tabBtn.className = isActive ? "workspace-tab active" : "workspace-tab";
    tabBtn.dataset.tabId = tabId;
    tabBtn.setAttribute("role", "tab");
    tabBtn.setAttribute("aria-selected", String(isActive));

    if (isChat) {
      tabBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="tab-icon" aria-hidden="true">
          <path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.5 4V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />
        </svg>
        <span class="tab-title">Chat</span>
      `;
    } else if (run) {
      const statusCls = run.isRunning
        ? "running"
        : run.state === runsModule.RUN_STATES.FAILED
          ? "failed"
          : "completed";
      tabBtn.innerHTML = `
        <span class="tab-status-dot ${statusCls}"></span>
        <span class="tab-title">${interactions.agentDisplayLabel(run.agentName)}</span>
      `;

      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "×";
      closeBtn.title = "Tab schließen";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        runStore.closeTab(tabId);
      });
      tabBtn.appendChild(closeBtn);
    }

    tabBtn.addEventListener("click", () => {
      runStore.setActiveTab(tabId);
    });

    tabsContainer.appendChild(tabBtn);
  }

  // Sichtbarkeit zwischen Chat und Run-View umschalten
  const isChatActive = runStore.activeRunId === null;
  const chatView = el("chat-view");
  const runView = el("run-view");

  if (chatView) chatView.hidden = !isChatActive;
  if (runView) {
    runView.hidden = isChatActive;
    if (!isChatActive) {
      const currentRun = runStore.getRun(runStore.activeRunId);
      if (currentRun) renderRunView(currentRun);
    }
  }
}

/* ---------------------- Subagent Run View (Ebene 3) --------------------- */

function renderRunView(run) {
  const nameEl = el("run-agent-name");
  const badgeEl = el("run-status-badge");
  const dotElRun = el("run-status-dot");
  const durationEl = el("run-duration-label");
  const taskEl = el("run-task-display");
  const modelEl = el("run-meta-model");
  const thinkingEl = el("run-meta-thinking");
  const parentEl = el("run-meta-parent");
  const stopBtn = el("btn-run-stop");

  if (nameEl) nameEl.textContent = run.agentName;
  if (badgeEl) {
    const statusInfo = run.getStatusBadge();
    badgeEl.className = `pill ${statusInfo.cls}`;
    badgeEl.textContent = `${statusInfo.marker} ${statusInfo.label}`;
  }
  if (dotElRun) {
    dotElRun.className = `dot ${run.isRunning ? "busy" : run.state === runsModule.RUN_STATES.FAILED ? "error" : "ready"}`;
  }
  if (durationEl) {
    durationEl.textContent = runsModule.formatDuration(run.durationMs);
  }
  if (taskEl) {
    taskEl.textContent = run.task || "Keine Aufgabenbeschreibung angegeben.";
  }
  if (modelEl) {
    modelEl.textContent = run.model
      ? `Modell: ${run.model}`
      : "Modell: Standard";
  }
  if (thinkingEl) {
    thinkingEl.textContent = run.thinking ? `Denken: ${run.thinking}` : "";
  }
  if (parentEl) {
    const parentRun = run.parentRunId ? runStore.getRun(run.parentRunId) : null;
    parentEl.innerHTML = parentRun
      ? `Parent: <button type="button" class="ghost-button" style="padding:0 4px;font-size:12px;color:var(--accent);">${parentRun.agentName}</button>`
      : "Parent: Hauptchat";
    const parentBtn = parentEl.querySelector("button");
    if (parentBtn && parentRun) {
      parentBtn.addEventListener("click", () => runStore.openTab(parentRun.id));
    }
  }
  if (stopBtn) {
    stopBtn.disabled = !run.isRunning;
  }

  // Zähler in Unteransichts-Tabs
  const filesCountEl = el("run-files-count");
  if (filesCountEl) filesCountEl.textContent = String(run.fileChanges.size);
  const toolsCountEl = el("run-tools-count");
  if (toolsCountEl) toolsCountEl.textContent = String(run.toolCalls.size);

  // Footer Stats
  const footerStatsEl = el("run-footer-stats");
  if (footerStatsEl) {
    footerStatsEl.textContent = `${runsModule.formatDuration(run.durationMs)} · ${run.toolCalls.size} Tools · ${run.fileChanges.size} Dateien`;
  }

  // Unteransichten rendern
  renderRunPanes(run);
}

function renderRunPanes(run) {
  for (const paneBtn of document.querySelectorAll(".run-nav-btn")) {
    paneBtn.classList.toggle(
      "active",
      paneBtn.dataset.subpane === state.activeRunSubpane,
    );
  }

  for (const pane of document.querySelectorAll(".run-pane")) {
    const isTarget = pane.id === `run-pane-${state.activeRunSubpane}`;
    pane.hidden = !isTarget;
  }

  if (state.activeRunSubpane === "output") renderRunOutputPane(run);
  else if (state.activeRunSubpane === "files") renderRunFilesPane(run);
  else if (state.activeRunSubpane === "tools") renderRunToolsPane(run);
  else if (state.activeRunSubpane === "info") renderRunInfoPane(run);
}

function matchesToolFilter(event, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "error") {
    return (
      event.type === "tool.failed" ||
      event.type === "run.failed" ||
      Boolean(event.isError)
    );
  }
  if (filter === "edit") {
    return (
      event.type === "file.changed" ||
      ["edit", "write"].includes(String(event.toolName))
    );
  }
  if (filter === "command") {
    return ["bash", "sh", "terminal"].includes(String(event.toolName));
  }
  if (filter === "explore") {
    return ["read", "grep", "find", "search", "list_dir", "view_file"].includes(
      String(event.toolName),
    );
  }
  return true;
}

function renderRunOutputPane(run) {
  const timelineEl = el("run-timeline");
  if (!timelineEl) return;
  timelineEl.innerHTML = "";

  const filter = state.runToolFilter || "all";
  for (const btn of document.querySelectorAll(".run-filter-bar .filter-btn")) {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  }

  for (const event of run.events) {
    if (!matchesToolFilter(event, filter)) continue;

    const eventCard = document.createElement("div");
    eventCard.className = "timeline-event";

    const header = document.createElement("div");
    header.className = "timeline-event-header";
    const timeSpan = document.createElement("span");
    timeSpan.textContent = runsModule.formatTime(event.timestamp);

    const typeSpan = document.createElement("span");
    typeSpan.className = "pill muted";

    const content = document.createElement("div");
    content.className = "timeline-event-content";

    switch (event.type) {
      case "run.started":
        eventCard.classList.add("start");
        typeSpan.textContent = "Start";
        typeSpan.className = "pill running";
        content.textContent = `Agent gestartet: ${event.data?.task || run.task}`;
        break;
      case "assistant.progress":
      case "assistant.thinking":
        typeSpan.textContent =
          event.type === "assistant.thinking" ? "Denken" : "Fortschritt";
        content.textContent = event.text;
        break;
      case "tool.started":
        typeSpan.textContent = `Tool: ${event.toolName}`;
        content.textContent = event.summary || `Aufruf: ${event.toolName}`;
        break;
      case "tool.completed":
      case "tool.failed": {
        const isErr = event.type === "tool.failed";
        typeSpan.textContent = `${event.toolName} (${event.durationMs ? runsModule.formatDuration(event.durationMs) : "fertig"})`;
        typeSpan.className = `pill ${isErr ? "err" : "ok"}`;
        content.textContent = event.summary || event.toolName;

        if (event.result) {
          const details = document.createElement("details");
          details.className = "tool-card";
          const summary = document.createElement("summary");
          summary.textContent = isErr ? "Fehlerdetails" : "Ausgabe anzeigen";
          const pre = document.createElement("pre");
          pre.className = "mono";
          setToolCardOutput(pre, event.result);
          details.append(summary, pre);
          content.appendChild(details);
        }
        break;
      }
      case "file.changed":
        typeSpan.textContent = "Datei geändert";
        typeSpan.className = "pill ok";
        content.textContent = `Modifiziert: ${event.path}`;
        break;
      case "agent.child.started":
        typeSpan.textContent = "Child Agent";
        typeSpan.className = "pill running";
        content.textContent = `Subagent gestartet: ${event.agentName} — ${event.task}`;
        break;
      case "run.completed":
        eventCard.classList.add("complete");
        typeSpan.textContent = "Abgeschlossen";
        typeSpan.className = "pill ok";
        content.textContent =
          typeof event.result === "string"
            ? event.result
            : event.result?.summary || "Lauf erfolgreich abgeschlossen.";
        break;
      case "run.failed":
        eventCard.classList.add("failed");
        typeSpan.textContent = "Fehlgeschlagen";
        typeSpan.className = "pill err";
        content.textContent = event.error || "Lauf mit Fehler beendet.";
        break;
      case "run.cancelled":
        typeSpan.textContent = "Abgebrochen";
        typeSpan.className = "pill muted";
        content.textContent = event.error || "Lauf wurde abgebrochen.";
        break;
      default:
        typeSpan.textContent = event.type;
        content.textContent = JSON.stringify(event);
    }

    header.append(typeSpan, timeSpan);
    eventCard.append(header, content);
    timelineEl.appendChild(eventCard);
  }
}

function renderRunFilesPane(run) {
  const container = el("run-files-list");
  if (!container) return;
  container.innerHTML = "";

  if (run.fileChanges.size === 0) {
    const empty = document.createElement("p");
    empty.className = "task-groups-empty";
    empty.textContent = "In diesem Lauf wurden noch keine Dateien geändert.";
    container.appendChild(empty);
    return;
  }

  for (const [path, change] of run.fileChanges.entries()) {
    const fileRow = renderChangedFileRow(path);
    container.appendChild(fileRow);
  }
}

function renderRunToolsPane(run) {
  const summaryEl = el("run-tools-summary");
  const listEl = el("run-tools-list");
  if (!summaryEl || !listEl) return;

  summaryEl.innerHTML = "";
  listEl.innerHTML = "";

  const breakdown = run.getToolBreakdown();
  if (Object.keys(breakdown).length === 0) {
    summaryEl.textContent = "Noch keine Tool-Aufrufe.";
  } else {
    for (const [name, count] of Object.entries(breakdown)) {
      const chip = document.createElement("span");
      chip.className = "tool-stat-chip";
      chip.textContent = `${name}: ${count}`;
      summaryEl.appendChild(chip);
    }
  }

  const filter = state.runToolFilter || "all";
  for (const tool of run.toolCalls.values()) {
    if (!matchesToolFilter(tool, filter)) continue;

    const item = document.createElement("div");
    item.className = "timeline-event";
    const header = document.createElement("div");
    header.className = "timeline-event-header";
    const title = document.createElement("strong");
    title.textContent = tool.toolName;
    const dur = document.createElement("span");
    dur.textContent = tool.durationMs
      ? runsModule.formatDuration(tool.durationMs)
      : tool.running
        ? "läuft …"
        : "";
    header.append(title, dur);

    const summary = document.createElement("div");
    summary.className = "timeline-event-content";
    summary.textContent = tool.summary;

    if (tool.result) {
      const details = document.createElement("details");
      details.className = "tool-card";
      const sum = document.createElement("summary");
      sum.textContent = "Details";
      const pre = document.createElement("pre");
      setToolCardOutput(pre, tool.result);
      details.append(sum, pre);
      summary.appendChild(details);
    }

    item.append(header, summary);
    listEl.appendChild(item);
  }
}

function renderHierarchyTree(currentRunId) {
  const container = document.createElement("div");
  container.className = "hierarchy-tree-view";
  const title = document.createElement("h3");
  title.textContent = "Agenten-Hierarchie";
  container.appendChild(title);

  const mainRun =
    runStore.getRun("main") || runStore.getRun(runStore.rootRunId);
  const rootId = mainRun ? mainRun.id : "main";

  function renderNode(runId, level = 0) {
    const isRoot = runId === "main" || runId === runStore.rootRunId;
    const run = isRoot ? mainRun : runStore.getRun(runId);
    if (!run && !isRoot) return;

    const row = document.createElement("div");
    row.className = runId === currentRunId ? "tree-node current" : "tree-node";

    const indent = document.createElement("span");
    indent.className = "tree-node-indent";
    indent.style.width = `${level * 16}px`;

    const glyph = document.createElement("span");
    glyph.className = "tree-node-glyph";
    const statusInfo = run
      ? run.getStatusBadge()
      : { marker: "●", label: "Root", cls: "ready" };
    glyph.innerHTML = `<span class="pill ${statusInfo.cls}">${statusInfo.marker}</span>`;

    const name = document.createElement("strong");
    name.textContent = isRoot
      ? "Hauptchat (Main)"
      : interactions.agentDisplayLabel(run.agentName);

    const meta = document.createElement("span");
    meta.className = "subagent-inspector-meta";
    meta.textContent = run ? runsModule.formatDuration(run.durationMs) : "";

    row.append(indent, glyph, name, meta);
    row.addEventListener("click", () => {
      runStore.openTab(runId);
    });
    container.appendChild(row);

    const children = isRoot
      ? runStore
          .getSubagentRuns()
          .filter(
            (r) =>
              !r.parentRunId ||
              r.parentRunId === "main" ||
              r.parentRunId === runStore.rootRunId,
          )
      : runStore.getChildrenOf(runId);
    for (const child of children) {
      renderNode(child.id, level + 1);
    }
  }

  renderNode(rootId, 0);
  return container;
}

function copyRunSummary(run) {
  if (!run) return;
  const statusInfo = run.getStatusBadge();
  const md = [
    `# Agent-Lauf: ${run.agentName}`,
    `- **Status:** ${statusInfo.label}`,
    `- **Aufgabe:** ${run.task || "Keine Beschreibung"}`,
    `- **Dauer:** ${runsModule.formatDuration(run.durationMs)}`,
    `- **Werkzeuge:** ${run.toolCalls.size} Aufrufe`,
    `- **Geänderte Dateien:** ${run.fileChanges.size}`,
    "",
    "## Ergebnis",
    typeof run.result === "string"
      ? run.result
      : run.result?.summary ||
        (run.error ? `Fehler: ${run.error}` : "Keine Zusammenfassung"),
  ].join("\n");

  api.copyToClipboard(md).then(() => {
    const copyBtn = el("btn-run-copy");
    if (copyBtn) {
      const orig = copyBtn.innerHTML;
      copyBtn.innerHTML = `<span>✓ Kopiert!</span>`;
      setTimeout(() => {
        copyBtn.innerHTML = orig;
      }, 1600);
    }
  });
}

function renderRunInfoPane(run) {
  const tableEl = el("run-info-table");
  if (!tableEl) return;
  tableEl.innerHTML = "";

  // Hierarchie-Baum vor die Tabelle setzen
  const treeEl = renderHierarchyTree(run.id);
  tableEl.appendChild(treeEl);

  const rows = [
    ["Run-ID", run.id],
    ["Agent", run.agentName],
    ["Rolle", run.role],
    ["Aufgabe", run.task],
    ["Status", run.state],
    ["Modell", run.model || "Standard"],
    ["Denken", run.thinking || "Standard"],
    ["Parent-Run", run.parentRunId || "Hauptchat"],
    ["Gestartet", runsModule.formatTime(run.startedAt)],
    ["Beendet", run.finishedAt ? runsModule.formatTime(run.finishedAt) : "—"],
    ["Laufzeit", runsModule.formatDuration(run.durationMs)],
    ["Werkzeuge", `${run.toolCalls.size} Aufrufe`],
    ["Geänderte Dateien", `${run.fileChanges.size} Dateien`],
  ];

  for (const [key, val] of rows) {
    const kEl = document.createElement("div");
    kEl.className = "run-info-key";
    kEl.textContent = key;
    const vEl = document.createElement("div");
    vEl.className = "run-info-val";
    vEl.textContent = val;
    tableEl.append(kEl, vEl);
  }
}

/* ------------------------- Ereignisverarbeitung ------------------------ */

function handleEvent(msg) {
  switch (msg.type) {
    case "agent_start":
      state.busy = true;
      runStore.ensureMainRun(state.sessionId, {
        model: state.modelLabel,
        thinking: state.thinkingLabel,
      });
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
      const isSubagent = msg.toolName === "subagent";
      const agentRole =
        kind === "agent" && msg.toolName === "subagent"
          ? String(msg.args?.agent ?? "").trim() || undefined
          : undefined;

      // Subagent Run im RunStore erfassen
      if (isSubagent) {
        const subagentRun = runStore.startSubagentRun({
          toolCallId: msg.toolCard.toolCallId,
          agentName: agentRole
            ? interactions.agentDisplayLabel(agentRole)
            : "Subagent",
          role: agentRole || "subagent",
          task: String(msg.args?.task ?? ""),
          model: state.modelLabel,
          thinking: state.thinkingLabel,
          sessionId: state.sessionId,
        });
        createSubagentChatCard(subagentRun);
        void refreshContextOverview();
      } else {
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
      }

      // Tool Call im passenden Run aufzeichnen
      const activeRun = runStore.activeRunId
        ? runStore.getRun(runStore.activeRunId)
        : runStore.getRun("main");
      if (activeRun) {
        activeRun.recordToolStart({
          toolCallId: msg.toolCard.toolCallId,
          toolName: msg.toolCard.toolName,
          summary: msg.toolCard.summary,
          args: msg.args,
        });
      }

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

      const subagentRun = runStore.getRunByToolCallId(msg.toolCallId);
      if (subagentRun) {
        subagentRun.recordProgress(
          interactions.textFromContent(msg.partialResult),
        );
        updateSubagentChatCard(subagentRun);
        if (runStore.activeRunId === subagentRun.id) {
          renderRunView(subagentRun);
        }
      }
      break;
    }
    case "tool_execution_end": {
      if (state.runningVerificationCalls.has(msg.toolCallId)) {
        state.runningVerificationCalls.delete(msg.toolCallId);
        state.lastVerificationToolCallId = msg.toolCallId;
        void refreshContextOverview();
      }

      const isSubagent = msg.toolName === "subagent";
      if (isSubagent) {
        const subagentRun = runStore.getRunByToolCallId(msg.toolCallId);
        if (subagentRun) {
          let summary = "";
          if (msg.result?.details?.results?.[0]?.finalOutput) {
            summary = String(msg.result.details.results[0].finalOutput);
          } else {
            summary = interactions.textFromContent(msg.result?.content);
          }
          subagentRun.complete(
            { summary, raw: msg.result },
            { isError: Boolean(msg.isError) },
          );
          updateSubagentChatCard(subagentRun);
          void refreshContextOverview();
          if (runStore.activeRunId === subagentRun.id) {
            renderRunView(subagentRun);
          }
        }
      } else {
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

function applyCustomEntry(entry) {
  if (!entry) return;
  if (entry.customType === "frontend-bridge/state") applyCoreEntry(entry);
  else if (entry.customType === "diff-view") applyDiffEntry(entry);
}

function applyDiffEntry(entry) {
  const data = entry.data;
  if (!data || typeof data.path !== "string" || !data.stats) return;
  state.fileDiffs.set(data.path, data);
  if (state.expandedRows.has("changes")) void refreshContextOverview();
}

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

/* ---------------- Navigation und Kontextbereich ------------------------ */

function setActiveNav(view) {
  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  state.activeView = view;
}

function setActiveView(view) {
  setActiveNav(view);
  if (view === "chat") {
    runStore.setActiveTab("chat");
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

/* ------------------------- Task Sidebar -------------------------------- */

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

async function refreshTaskList() {
  try {
    state.taskListCache = await api.listSessions();
  } catch {
    state.taskListCache = [];
  }
  renderTaskSidebar();
}

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

function buildTaskEntries() {
  const entries = state.taskListCache.map((entry) => {
    const isCurrent = Boolean(
      state.sessionId && entry.path.includes(state.sessionId),
    );
    return buildTaskEntry(entry, isCurrent);
  });
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
    /* ignore */
  }
}

function restoreTaskSidebarCollapsed() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(TASK_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    /* default false */
  }
  document.body.classList.toggle("task-sidebar-collapsed", collapsed);
  el("btn-collapse-tasks")?.setAttribute(
    "aria-expanded",
    collapsed ? "false" : "true",
  );
}

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

function verificationPill() {
  const core = state.core;
  const status = core?.verification?.status || state.verificationStatus;
  if (!status) return "";
  if (status === "verified") return '<span class="pill ok">bereit</span>';
  if (status === "checks_failed")
    return '<span class="pill err">fehlgeschlagen</span>';
  return `<span class="pill warn">${esc(status)}</span>`;
}

/* ------------------- Inspector-Bereinigung & Zielzustand --------------- */

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

  if (key === "subagents" || key === "agents") {
    const subagents = runStore.getSubagentRuns();
    if (subagents.length === 0) {
      line("Keine Subagenten in dieser Sitzung.");
      return;
    }
    for (const run of subagents) {
      const item = document.createElement("div");
      item.className = "subagent-inspector-item";
      const statusInfo = run.getStatusBadge();

      item.innerHTML = `
        <div>
          <span class="subagent-inspector-name">${esc(run.agentName)}</span>
          <div class="subagent-inspector-meta">${esc(run.task ? (run.task.length > 40 ? run.task.slice(0, 37) + "…" : run.task) : "")}</div>
        </div>
        <div style="text-align:right">
          <span class="pill ${statusInfo.cls}">${statusInfo.marker} ${statusInfo.label}</span>
          <div class="subagent-inspector-meta">${runsModule.formatDuration(run.durationMs)}</div>
        </div>
      `;
      item.addEventListener("click", () => {
        runStore.openTab(run.id);
      });
      body.appendChild(item);
    }
    return;
  }

  if (key === "verify") {
    renderVerificationBody(body, core, line);
    return;
  }
}

function jumpToVerificationDetails() {
  const toolCallId = state.lastVerificationToolCallId;
  if (!toolCallId) return;
  const rawCard = findRawToolCard(toolCallId);
  if (!rawCard) return;
  rawCard.open = true;
  rawCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

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

const MAX_DIFF_LINES = 600;

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

  const actions = document.createElement("div");
  actions.className = "diff-file-actions";

  if (diff?.stats) {
    const stat = document.createElement("span");
    stat.className = "diff-file-stat";
    stat.textContent = `+${diff.stats.linesAdded}/−${diff.stats.linesRemoved}`;
    actions.appendChild(stat);
  }

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "icon-button";
  copyBtn.title = "Pfad kopieren";
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    api.copyToClipboard(path).then(() => {
      copyBtn.style.color = "var(--ok)";
      setTimeout(() => {
        copyBtn.style.color = "";
      }, 1200);
    });
  });
  actions.appendChild(copyBtn);

  const isSplitInitial = Boolean(state.diffSplitModes?.get(path));
  const splitToggle = document.createElement("button");
  splitToggle.type = "button";
  splitToggle.className = "ghost-button diff-toggle-btn";
  splitToggle.textContent = isSplitInitial ? "Unified" : "Split";
  splitToggle.title = "Ansicht wechseln (Split / Unified)";
  splitToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const cur = Boolean(state.diffSplitModes?.get(path));
    if (!state.diffSplitModes) state.diffSplitModes = new Map();
    state.diffSplitModes.set(path, !cur);
    splitToggle.textContent = !cur ? "Unified" : "Split";
    renderFileDiffContent(content, diff, ext, !cur);
  });
  actions.appendChild(splitToggle);

  summary.appendChild(actions);
  details.appendChild(summary);

  const content = document.createElement("div");
  content.className = "diff-file-content";
  details.appendChild(content);

  const ext = path.split(".").pop() || "";
  let rendered = false;
  details.addEventListener("toggle", () => {
    if (details.open) state.expandedDiffFiles.add(path);
    else state.expandedDiffFiles.delete(path);
    if (details.open && !rendered) {
      rendered = true;
      renderFileDiffContent(
        content,
        diff,
        ext,
        Boolean(state.diffSplitModes?.get(path)),
      );
    }
  });
  if (details.open) {
    rendered = true;
    renderFileDiffContent(
      content,
      diff,
      ext,
      Boolean(state.diffSplitModes?.get(path)),
    );
  }
  return details;
}

function renderFileDiffContent(content, diff, lang = "", isSplit = false) {
  content.innerHTML = "";
  if (!diff?.hunks?.length) {
    const empty = document.createElement("div");
    empty.className = "diff-empty";
    empty.textContent =
      "Diff nicht verfügbar (keine aufgezeichnete edit/write-Operation).";
    content.appendChild(empty);
    return;
  }

  if (isSplit) {
    const splitContainer = document.createElement("div");
    splitContainer.className = "diff-split-container";
    let rendered = 0;
    outerSplit: for (const hunk of diff.hunks) {
      const header = document.createElement("div");
      header.className = "diff-line diff-hunk-header";
      header.textContent =
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@` +
        (hunk.heading ? ` ${hunk.heading}` : "");
      splitContainer.appendChild(header);

      const lines = hunk.lines ?? [];
      let i = 0;
      while (i < lines.length) {
        if (rendered >= MAX_DIFF_LINES) break outerSplit;
        const line = lines[i];
        const row = document.createElement("div");
        row.className = "diff-split-row";

        const leftCol = document.createElement("div");
        leftCol.className = "diff-split-col diff-split-left";
        const rightCol = document.createElement("div");
        rightCol.className = "diff-split-col diff-split-right";

        if (line.kind === "context") {
          leftCol.appendChild(createDiffLineFragment(line, lang, "context"));
          rightCol.appendChild(createDiffLineFragment(line, lang, "context"));
          i++;
        } else if (line.kind === "removed") {
          leftCol.classList.add("diff-remove");
          leftCol.appendChild(createDiffLineFragment(line, lang, "remove"));
          const next = lines[i + 1];
          if (next && next.kind === "added") {
            rightCol.classList.add("diff-add");
            rightCol.appendChild(createDiffLineFragment(next, lang, "add"));
            i += 2;
          } else {
            i++;
          }
        } else if (line.kind === "added") {
          rightCol.classList.add("diff-add");
          rightCol.appendChild(createDiffLineFragment(line, lang, "add"));
          i++;
        } else {
          i++;
        }

        row.append(leftCol, rightCol);
        splitContainer.appendChild(row);
        rendered++;
      }
    }
    if (rendered >= MAX_DIFF_LINES) {
      const truncated = document.createElement("div");
      truncated.className = "diff-empty";
      truncated.textContent = `… Diff nach ${MAX_DIFF_LINES} Zeilen gekürzt`;
      splitContainer.appendChild(truncated);
    }
    content.appendChild(splitContainer);
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
      content.appendChild(renderDiffLineEl(diffLine, lang));
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

function createDiffLineFragment(diffLine, lang = "", kind = "context") {
  const frag = document.createDocumentFragment();
  const marker = document.createElement("span");
  marker.className = "diff-marker";
  marker.textContent = kind === "add" ? "+" : kind === "remove" ? "-" : " ";
  frag.appendChild(marker);

  const textSpan = document.createElement("span");
  textSpan.className = "diff-text";

  if (lang && window.piGuiCodeBlock?.highlightTokens && diffLine.text) {
    const tokens = window.piGuiCodeBlock.highlightTokens(diffLine.text, lang);
    for (const token of tokens) {
      if (token.cls) {
        const span = document.createElement("span");
        span.className = `tok-${token.cls}`;
        span.textContent = token.text;
        textSpan.appendChild(span);
      } else {
        textSpan.appendChild(document.createTextNode(token.text));
      }
    }
  } else {
    textSpan.textContent = diffLine.text ?? "";
  }

  frag.appendChild(textSpan);
  return frag;
}

function renderDiffLineEl(diffLine, lang = "") {
  const row = document.createElement("div");
  const kind =
    diffLine.kind === "added"
      ? "add"
      : diffLine.kind === "removed"
        ? "remove"
        : "context";
  row.className = `diff-line diff-${kind}`;

  const marker = document.createElement("span");
  marker.className = "diff-marker";
  marker.textContent = kind === "add" ? "+" : kind === "remove" ? "-" : " ";
  row.appendChild(marker);

  const textSpan = document.createElement("span");
  textSpan.className = "diff-text";

  if (lang && window.piGuiCodeBlock?.highlightTokens && diffLine.text) {
    const tokens = window.piGuiCodeBlock.highlightTokens(diffLine.text, lang);
    for (const token of tokens) {
      if (token.cls) {
        const span = document.createElement("span");
        span.className = `tok-${token.cls}`;
        span.textContent = token.text;
        textSpan.appendChild(span);
      } else {
        textSpan.appendChild(document.createTextNode(token.text));
      }
    }
  } else {
    textSpan.textContent = diffLine.text ?? "";
  }

  row.appendChild(textSpan);
  return row;
}

async function refreshContextOverview() {
  const rows = el("context-rows");
  if (!rows) return;
  const core = state.core;
  let contextTokens = "—";
  let contextPercent = 0;

  try {
    const stats = await api.getStats();
    if (stats?.contextUsage && stats.contextUsage.percent !== null) {
      contextPercent = Math.min(100, Math.max(0, stats.contextUsage.percent));
      contextTokens = `${stats.contextUsage.tokens || 0} Tokens (${contextPercent}%)`;
    }
  } catch {
    /* ignore */
  }

  const subagentsCount = runStore.getSubagentRuns().length;

  const rowDefs = [
    {
      label: "Session",
      value: !state.connected
        ? "Nicht verbunden"
        : state.busy
          ? "● Working"
          : "● Bereit",
      empty: !state.connected,
    },
    {
      label: "Model",
      value: `${state.modelLabel || "Standard"} · ${state.thinkingLabel ? "Denken " + state.thinkingLabel : "Standard"}`,
      empty: !state.modelLabel,
      action: () => openModelPicker(),
    },
    {
      key: "changes",
      label: "Changes",
      value: core?.changes
        ? `${core.changes.filesCount} Dateien`
        : `${state.editedFiles.size} Dateien`,
      empty: !core?.changes && state.editedFiles.size === 0,
    },
    {
      key: "verify",
      label: "Verification",
      value:
        (state.runningVerificationCalls.size > 0 ? "⏳ läuft … " : "") +
        esc(core?.verification?.status || state.verificationStatus || "—") +
        verificationPill(),
      raw: true,
      empty:
        !core?.verification?.status &&
        !state.verificationStatus &&
        state.runningVerificationCalls.size === 0,
    },
    {
      key: "subagents",
      label: `Subagents (${subagentsCount})`,
      value:
        subagentsCount > 0
          ? `${runStore.getActiveSubagents().length} aktiv`
          : "keine",
      empty: subagentsCount === 0,
    },
  ];

  rows.className = "";
  rows.innerHTML = "";

  // Kontext-Balken Rendering
  const contextBox = document.createElement("div");
  contextBox.className = "context-usage-box";
  contextBox.innerHTML = `
    <div class="context-usage-header">
      <span>Kontext</span>
      <span>${esc(contextTokens)}</span>
    </div>
    <div class="context-bar">
      <div class="context-bar-fill" style="width: ${contextPercent}%"></div>
    </div>
  `;
  rows.appendChild(contextBox);

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
      const left = document.createElement("div");
      left.className = "context-row-left";
      const caret = document.createElement("span");
      caret.className = "row-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = expanded ? "▾" : "▸";
      left.append(caret, label);
      button.append(left, value);
      button.addEventListener("click", () => toggleRow(def.key));
      wrap.appendChild(button);
      if (expanded) {
        const body = document.createElement("div");
        body.className = "context-row-body";
        wrap.appendChild(body);
        pending.push(renderRowBody(body, def.key));
      }
    } else {
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
  runStore.clear();
  clearChat();
  clearBanners();
}

async function loadSessionDiffs(sessionPath) {
  try {
    const diffs = await api.getSessionDiffs(sessionPath);
    for (const diff of diffs) state.fileDiffs.set(diff.path, diff);
  } catch {
    /* ignore */
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

async function renderStartscreenRecentProjects() {
  const section = el("startscreen-recent");
  const list = el("startscreen-recent-list");
  let recent = [];
  try {
    recent = await api.listRecentProjects();
  } catch {
    /* ignore */
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

async function startTaskFromStartscreen() {
  const text = el("startscreen-input").value;
  const picked = await api.pickProjectFolder();
  if (!picked || picked.cancelled || !picked.path) return;
  await startProjectAndTask(picked.path, text);
}

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

function updateChatEmptyHint() {
  const placeholder = el("chat-placeholder");
  if (!placeholder) return;
  placeholder.hidden = chatEl.hidden || chatEl.childElementCount > 0;
}

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

async function openProjectPicker() {
  let recent = [];
  try {
    recent = await api.listRecentProjects();
  } catch {
    /* ignore */
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

    const trimmed = text.trim();
    if (trimmed && !opts.skipLocalEcho) {
      if (state.promptHistory.at(-1) !== trimmed) {
        state.promptHistory.push(trimmed);
      }
      state.historyIndex = -1;
      state.tempDraft = "";
    }

    await api.prompt(text);
    accepted = true;
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
  if (inputEl) {
    inputEl.placeholder = state.busy
      ? "Anweisung an laufenden Task … (erst Stopp, dann senden)"
      : "Was soll Pi tun? (Enter sendet, Shift+Enter neue Zeile)";
  }
}

/* ---------------------- Shortcuts -------------------------------------- */

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
    if (
      event.key === "Escape" &&
      document.body.classList.contains("context-open") &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      closeContextDrawer();
      return;
    }

    // Tab-Navigation: Alt+1..9 schaltet direkt zu Tab N
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key >= "1" &&
      event.key <= "9"
    ) {
      const index = parseInt(event.key, 10) - 1;
      if (index >= 0 && index < runStore.openTabs.length) {
        event.preventDefault();
        runStore.setActiveTab(runStore.openTabs[index]);
        return;
      }
    }

    // Tab-Wechsel: Ctrl+Alt+Left / Ctrl+Alt+Right oder Alt+[ / Alt+]
    if (
      (event.ctrlKey &&
        event.altKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")) ||
      (event.altKey && (event.key === "[" || event.key === "]"))
    ) {
      const direction =
        event.key === "ArrowRight" || event.key === "]" ? 1 : -1;
      const currentIdx =
        runStore.activeRunId === null
          ? 0
          : runStore.openTabs.indexOf(runStore.activeRunId);
      if (currentIdx >= 0 && runStore.openTabs.length > 1) {
        event.preventDefault();
        const nextIdx =
          (currentIdx + direction + runStore.openTabs.length) %
          runStore.openTabs.length;
        runStore.setActiveTab(runStore.openTabs[nextIdx]);
        return;
      }
    }

    // Aktiven Subagent-Tab schließen: Ctrl+w oder Ctrl+Alt+w (nur bei Run-View)
    if (
      ((event.ctrlKey && event.key === "w") ||
        (event.ctrlKey && event.altKey && event.key === "w")) &&
      runStore.activeRunId !== null
    ) {
      event.preventDefault();
      runStore.closeTab(runStore.activeRunId);
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

/* --------------------- Inspector-Resize -------------------------------- */

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
    /* ignore */
  }
}

function restoreInspectorWidth() {
  try {
    const stored = Number(localStorage.getItem(INSPECTOR_W_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) applyInspectorWidth(stored);
  } catch {
    /* ignore */
  }
}

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

  runStore.onChange(() => {
    renderWorkspaceTabs();
    void refreshContextOverview();
  });

  state.shortcutByKey = {};
  try {
    for (const mapping of await api.getShortcuts()) {
      state.shortcutByKey[mapping.keys] = mapping;
    }
  } catch {
    /* ignore */
  }
  setupShortcuts();

  for (const item of document.querySelectorAll(".nav-item")) {
    item.addEventListener("click", () => setActiveView(item.dataset.view));
  }

  el("btn-refresh-context")?.addEventListener("click", () =>
    refreshContextOverview(),
  );
  el("btn-close-inspector")?.addEventListener("click", () =>
    closeContextDrawer(),
  );

  chatEl.addEventListener("scroll", () => {
    setFollowScroll(interactions.isNearBottom(chatEl));
  });
  el("btn-jump-latest")?.addEventListener("click", () => scrollToBottom(true));

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

  el("btn-send")?.addEventListener("click", () => {
    const text = inputEl.value;
    if (!text.trim()) return;
    inputEl.value = "";
    sendMessage(text);
  });
  inputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const text = inputEl.value;
      if (!text.trim() || state.busy) return;
      inputEl.value = "";
      sendMessage(text);
    } else if (
      event.key === "ArrowUp" &&
      inputEl.selectionStart === 0 &&
      inputEl.selectionEnd === 0
    ) {
      if (state.promptHistory.length > 0) {
        if (state.historyIndex === -1) {
          state.tempDraft = inputEl.value;
          state.historyIndex = state.promptHistory.length - 1;
        } else if (state.historyIndex > 0) {
          state.historyIndex--;
        }
        inputEl.value = state.promptHistory[state.historyIndex] || "";
        event.preventDefault();
      }
    } else if (event.key === "ArrowDown") {
      if (state.historyIndex !== -1) {
        if (state.historyIndex < state.promptHistory.length - 1) {
          state.historyIndex++;
          inputEl.value = state.promptHistory[state.historyIndex] || "";
        } else {
          state.historyIndex = -1;
          inputEl.value = state.tempDraft || "";
        }
        event.preventDefault();
      }
    }
  });

  // Drag & Drop für Dateien in den Composer
  inputEl?.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  inputEl?.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const paths = [];
    const cwd = window.__piGuiCwd || "";
    for (let i = 0; i < files.length; i++) {
      let p = files[i].path;
      if (p) {
        if (cwd && p.startsWith(cwd)) {
          p = p.slice(cwd.length).replace(/^[/\\]+/, "");
        }
        paths.push(p);
      }
    }
    if (paths.length > 0) {
      const text = paths.join(" ");
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      inputEl.value =
        inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
      inputEl.selectionStart = inputEl.selectionEnd = start + text.length;
      inputEl.focus();
    }
  });

  el("btn-stop")?.addEventListener("click", () => {
    api.abort().catch(() => undefined);
  });
  el("btn-new-session")?.addEventListener("click", () => startFreshSession());
  el("pill-workflow")?.addEventListener("click", () => openWorkflowPicker());
  el("pill-model")?.addEventListener("click", () => openModelPicker());
  el("pill-thinking")?.addEventListener("click", () => openThinkingPicker());
  el("btn-palette")?.addEventListener("click", () => openCommandPalette());
  el("btn-toggle-inspector")?.addEventListener("click", () =>
    toggleContextArea(),
  );
  el("project-label")?.addEventListener("click", () => openProjectPicker());
  el("btn-open-project")?.addEventListener("click", () =>
    startTaskFromStartscreen(),
  );
  el("startscreen-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void startTaskFromStartscreen();
  });
  el("startscreen-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void startTaskFromStartscreen();
    }
  });
  el("btn-new-task")?.addEventListener("click", () => startFreshSession());
  el("btn-empty-new-task")?.addEventListener("click", () =>
    startFreshSession(),
  );
  el("btn-empty-open-project")?.addEventListener("click", () =>
    openProjectPicker(),
  );
  el("btn-collapse-tasks")?.addEventListener("click", () =>
    toggleTaskSidebarCollapsed(),
  );

  // Run View Controls
  el("btn-run-close")?.addEventListener("click", () => {
    if (runStore.activeRunId) {
      runStore.closeTab(runStore.activeRunId);
    }
  });

  el("btn-run-copy")?.addEventListener("click", () => {
    if (runStore.activeRunId) {
      copyRunSummary(runStore.getRun(runStore.activeRunId));
    }
  });

  for (const btn of document.querySelectorAll(".run-filter-bar .filter-btn")) {
    btn.addEventListener("click", () => {
      state.runToolFilter = btn.dataset.filter || "all";
      const currentRun = runStore.getRun(runStore.activeRunId);
      if (currentRun) renderRunPanes(currentRun);
    });
  }

  for (const btn of document.querySelectorAll(".run-nav-btn")) {
    btn.addEventListener("click", () => {
      state.activeRunSubpane = btn.dataset.subpane;
      const currentRun = runStore.getRun(runStore.activeRunId);
      if (currentRun) renderRunPanes(currentRun);
    });
  }

  // Dauer-Ticker für laufende Subagenten
  state.durationTimer = setInterval(() => {
    const activeSubagents = runStore.getActiveSubagents();
    if (activeSubagents.length > 0) {
      for (const run of activeSubagents) {
        updateSubagentChatCard(run);
      }
      if (runStore.activeRunId) {
        const currentRun = runStore.getRun(runStore.activeRunId);
        if (currentRun && currentRun.isRunning) {
          const durationEl = el("run-duration-label");
          if (durationEl)
            durationEl.textContent = runsModule.formatDuration(
              currentRun.durationMs,
            );
          const footerStatsEl = el("run-footer-stats");
          if (footerStatsEl) {
            footerStatsEl.textContent = `${runsModule.formatDuration(currentRun.durationMs)} · ${currentRun.toolCalls.size} Tools · ${currentRun.fileChanges.size} Dateien`;
          }
        }
      }
    }
  }, 1000);

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
 * Headless-Smoke-Hook
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
          document.querySelector(".activity-card .activity-title") ||
          document.querySelector(".subagent-chat-card"),
        );
      }
    });
    applyRuntimeState(await api.startSession({ cwd, noSession: true }));
    if (mode === "dialogs") {
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
