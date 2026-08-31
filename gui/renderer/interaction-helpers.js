/**
 * Kleine, DOM-freie Interaktionshilfen für den Renderer. Sie halten keine
 * Pi-Wahrheit, sondern machen UI-Entscheidungen testbar.
 */
"use strict";

function contentParts(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.filter((part) => part && typeof part === "object")
    : [];
}

function textFromContent(content) {
  return contentParts(content)
    .filter((part) => part.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function thinkingFromContent(content) {
  return contentParts(content)
    .filter((part) => part.type === "thinking")
    .map((part) => {
      if (typeof part.thinking === "string") return part.thinking;
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function comboFromKeyboardEvent(event) {
  if (
    event.key === "Tab" &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    return "shift+tab";
  }
  const modifier = event.metaKey || (event.ctrlKey && event.altKey);
  if (!modifier || event.key.length !== 1) return null;
  const key = event.key.toLowerCase();
  return `super+${event.shiftKey ? "shift+" : ""}${key}`;
}

function isNearBottom(scrollable, threshold = 48) {
  const distance = Math.max(
    0,
    Number(scrollable.scrollHeight) -
      Number(scrollable.scrollTop) -
      Number(scrollable.clientHeight),
  );
  return distance <= threshold;
}

function once(callback) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return callback(...args);
  };
}

/**
 * Activity Stream (Phase 3): ordnet einen Werkzeugaufruf einem semantischen
 * Ereignistyp zu (05_Phase_3_Activity_Stream.md, Renderer-Typen). Portiert
 * dieselbe Bash-Command-Heuristik wie extensions/aurora-ui/tool-renderers.ts
 * (classifyTool/isVerificationCommand/isTestCommand), damit TUI und GUI
 * dieselbe Aufgaben-Semantik zeigen — kein zweites, abweichendes Schema.
 */
function normalizedBashCommand(args) {
  const command = args && typeof args === "object" ? args.command : undefined;
  return typeof command === "string" ? command.replace(/\s+/g, " ") : "";
}

function bashCommandStarts(command, expression) {
  return new RegExp(`(?:^|(?:&&|\\|\\||;|\\n)\\s*)${expression}`, "i").test(
    command,
  );
}

function isVerificationCommand(command) {
  const packageManager = "(?:npm|pnpm|yarn|bun)";
  return (
    bashCommandStarts(
      command,
      `${packageManager}(?:\\s+--[^\\s]+(?:\\s+[^\\s]+)?)?\\s+run\\s+verify(?:\\s|$)`,
    ) || bashCommandStarts(command, `${packageManager}\\s+verify(?:\\s|$)`)
  );
}

/** Bewusste Abweichung von der Aurora-Vorlage: dort fehlt bei npx/pnpx
 * das trennende \s+, wodurch "npx vitest" nicht erkannt wird. Hier korrigiert. */
function isTestCommand(command) {
  const packageManager = "(?:npm|pnpm|yarn|bun)";
  return (
    bashCommandStarts(
      command,
      `${packageManager}(?:\\s+--[^\\s]+(?:\\s+[^\\s]+)?)?\\s+(?:run\\s+)?test(?:\\s|$)`,
    ) ||
    bashCommandStarts(
      command,
      "(?:(?:npx|pnpx)\\s+|yarn\\s+dlx\\s+|bunx\\s+)?(?:vitest|jest|pytest)(?:\\s|$)",
    ) ||
    bashCommandStarts(command, "cargo\\s+test(?:\\s|$)") ||
    bashCommandStarts(command, "go\\s+test(?:\\s|$)")
  );
}

const LSP_TOOL_NAMES = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);

/** Renderer-Typ eines Werkzeugaufrufs — eine der Sorten aus
 * 05_Phase_3_Activity_Stream.md ("Renderer-Typen (minimal)"), reduziert auf
 * die tatsächlich aus toolName/args ableitbaren: search, file_read,
 * file_change, command, agent, verification, analysis, other. */
function classifyActivityKind(toolName, args) {
  const name = String(toolName ?? "").toLowerCase();
  switch (name) {
    case "read":
      return "file_read";
    case "grep":
    case "find":
    case "ls":
    case "web_search":
    case "fetch_content":
    case "source_check":
    case "web":
    case "web__run":
      return "search";
    case "edit":
    case "write":
      return "file_change";
    case "verify":
    case "project_check":
      return "verification";
    case "subagent":
    case "wait":
      return "agent";
    case "bash": {
      const command = normalizedBashCommand(args);
      if (command && isVerificationCommand(command)) return "verification";
      if (command && isTestCommand(command)) return "verification";
      return "command";
    }
    default:
      return LSP_TOOL_NAMES.has(name) ? "analysis" : "other";
  }
}

/** Gröbere Gruppierungs-Phase: mehrere gleichartige Werkzeugaufrufe in
 * Folge werden zu EINER Aktivitätskarte zusammengefasst (§Phase 3 —
 * "ähnliche Toolcalls werden gruppiert"), statt pro Aufruf eine eigene
 * Karte zu erzeugen ("Toolspam"). */
function activityPhaseFor(kind) {
  if (kind === "file_read" || kind === "search" || kind === "analysis") {
    return "explore";
  }
  if (kind === "file_change") return "edit";
  if (kind === "verification") return "verify";
  if (kind === "agent") return "agent";
  if (kind === "command") return "command";
  return "other";
}

const ACTIVITY_PHASE_LABELS = {
  explore: "Repository analysiert",
  edit: "Änderungen vorgenommen",
  verify: "Verifikation",
  agent: "Subagent",
  command: "Befehl ausgeführt",
  other: "Aktivität",
};

/** Rollenname eines Subagenten-Werkzeugaufrufs (`subagent`-Tool, Argument
 * `agent`, z. B. "scout"/"worker"/"reviewer" — siehe die im Core
 * registrierten Agenten) als Anzeigename für Activity-Karte/AGENTS-Zeile
 * (Phase 10, §12 "klare Zuordnung von Activity zu Agent"). Reine
 * Großschreibung, keine Umbenennung/Erfindung neuer Namen (R6). */
function agentDisplayLabel(role) {
  const name = String(role ?? "").trim();
  if (!name) return "Subagent";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Subagenten-Status (Phase 10, §12 "aktive/wartende/fertige Agenten
 * unterscheidbar"): `core.subagents[].status` kommt aus
 * `FrontendSubagentBranch.status` (extensions/frontend-protocol/
 * state-contract.ts: "running"|"paused"|"needs_attention"|"queued").
 * `extensions/frontend-bridge/index.ts` (`subagentStartEvent`) setzt
 * "queued" bereits im Start-Moment ("subagent:async-started") und ändert es
 * nie zu "running" — für Async-Subagenten bedeutet "queued" hier also
 * bereits "läuft im Hintergrund", nicht "wartet auf einen Startplatz". Die
 * Anzeige folgt deshalb der TATSÄCHLICHEN Bedeutung statt des rohen
 * Enum-Namens; "running" wird defensiv genauso behandelt, falls eine
 * andere/künftige Quelle es doch sendet. "needs_attention" bekommt bewusst
 * dieselbe Warnfarbe wie der Task-Status "needs_input" (konsistente
 * Farbsprache, §Phase 9 Farbsemantik: Running = neutral/Blau). */
function subagentStatusPresentation(status) {
  switch (status) {
    case "running":
    case "queued":
      return { marker: "●", label: "Aktiv", cls: "running" };
    case "needs_attention":
      return { marker: "⚠", label: "Braucht Eingabe", cls: "warn" };
    case "paused":
      return { marker: "○", label: "Pausiert", cls: "muted" };
    default:
      return {
        marker: "○",
        label: String(status ?? "unbekannt"),
        cls: "muted",
      };
  }
}

/**
 * Verification (Phase 7, §09): ordnet den Rohwert eines Required-Checks
 * (extensions/setup-core/verification-status.ts: RequiredOutcome = success |
 * failed | unavailable, oder undefined = für diesen Snapshot noch nie
 * gelaufen) einer eindeutigen Marker/Label-Kombination zu. "unavailable"
 * (Timeout/Abbruch/fehlendes Binary) ist bewusst NIE dasselbe Symbol wie
 * "failed" — ein abgebrochener Check darf weder als bestanden noch
 * ununterscheidbar von einer echten Prüfungs-Ablehnung erscheinen
 * (Abschlusskriterium "abgebrochene Checks werden nicht als bestanden
 * gewertet" + "pass/fail/running/skipped sauber unterschieden"). */
function verificationOutcomeMarker(outcome) {
  switch (outcome) {
    case "success":
      return { marker: "✓", label: "bestanden", cls: "ok" };
    case "failed":
      return { marker: "✗", label: "fehlgeschlagen", cls: "err" };
    case "unavailable":
      return {
        marker: "⚠",
        label: "kein Ergebnis (Timeout/Abbruch)",
        cls: "warn",
      };
    default:
      return { marker: "○", label: "noch nicht geprüft", cls: "muted" };
  }
}

/**
 * Task-Sidebar (Phase 2): ordnet den Core-Zustand einer Sitzung einer der
 * vier UI-Gruppen aus 02_Zielarchitektur_und_Statusmodell.md zu — reine
 * Ableitung aus bereits vorhandenen Core-Signalen (R2/R6, kein neuer
 * Core-Zustand). Für ruhende Sitzungen ist `coreState` der letzte
 * persistierte frontend-bridge/state-Eintrag statt eines Live-Werts.
 */
function deriveTaskStatus(coreState, { isCurrent = false, busy = false } = {}) {
  const subagents = Array.isArray(coreState?.subagents)
    ? coreState.subagents
    : [];
  const verificationStatus = coreState?.verification?.status;
  const changesCount = coreState?.changes?.filesCount ?? 0;
  if (isCurrent && busy) return "active";
  if (subagents.some((agent) => agent?.status === "needs_attention")) {
    return "needs_input";
  }
  if (verificationStatus === "checks_failed") return "needs_input";
  if (changesCount > 0) return "review";
  if (isCurrent) return "active";
  return "completed";
}

/** Letztes Pfadsegment als Anzeigename (Projekt-Picker, Startscreen §10) —
 * ein Pfad ohne Segmente (z. B. "/") fällt auf den vollen Pfad zurück. */
function projectDisplayName(projectPath) {
  return (
    String(projectPath ?? "")
      .split("/")
      .filter(Boolean)
      .at(-1) || String(projectPath ?? "")
  );
}

/** Grobe relative Zeitangabe für Task-Zeilen ("2m", "3h", "5d"). */
function relativeTimeLabel(mtimeMs, now = Date.now()) {
  const diffMs = Math.max(0, now - Number(mtimeMs));
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "jetzt";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function piExitMessage(info = {}) {
  if (info.kind === "spawn-error") {
    const detail = String(info.message ?? "").slice(0, 240);
    return detail
      ? `Pi konnte nicht gestartet werden: ${detail}`
      : "Pi konnte nicht gestartet werden. Prüfe die Pi-Installation.";
  }
  const reason = info.signal
    ? `Signal ${info.signal}`
    : `Code ${info.code ?? "?"}`;
  return `Pi-Prozess wurde beendet (${reason}). „Neue Sitzung“ startet ihn erneut.`;
}

const helpers = {
  ACTIVITY_PHASE_LABELS,
  activityPhaseFor,
  agentDisplayLabel,
  classifyActivityKind,
  comboFromKeyboardEvent,
  deriveTaskStatus,
  isNearBottom,
  once,
  piExitMessage,
  projectDisplayName,
  relativeTimeLabel,
  subagentStatusPresentation,
  textFromContent,
  thinkingFromContent,
  verificationOutcomeMarker,
};

if (typeof window !== "undefined") window.piGuiInteractions = helpers;
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ACTIVITY_PHASE_LABELS,
    activityPhaseFor,
    agentDisplayLabel,
    classifyActivityKind,
    comboFromKeyboardEvent,
    deriveTaskStatus,
    isNearBottom,
    once,
    piExitMessage,
    projectDisplayName,
    relativeTimeLabel,
    subagentStatusPresentation,
    textFromContent,
    thinkingFromContent,
    verificationOutcomeMarker,
  };
}
