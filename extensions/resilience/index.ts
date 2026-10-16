/**
 * Resilience: compact failure telemetry plus safe session recovery markers.
 *
 * Pi's JSONL session is the only source of truth. This extension appends small
 * custom entries to that session; it does not create a second log, retry loop,
 * workflow state, or task database.
 */
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageUpdateEvent,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";
import {
  collectWorkspaceSnapshot,
  gitEnv,
  probeGitRepository,
  type WorkspaceSnapshot,
} from "../../shared/workspace-snapshot.mjs";
import { loadSetupConfig } from "../setup-core/config.ts";
import {
  canonicalWorkspaceRoot,
  requestWorkspaceScope,
} from "../shared/workspace-scope.ts";
import { trackedExec } from "../shared/tracked-exec.ts";
import {
  RECOVERY_CAPABILITY_EVENTS,
  recoveryEffect,
  type RecoveryMutationApproval,
  type RecoveryStatusRequest,
  type RecoveryStatusSnapshot,
} from "../shared/recovery-capabilities.ts";
import { UI_STATUS_KEYS, setTuiStatus } from "../shared/workflow-status.ts";
import { limitTextOutput } from "../shared/output-limits.ts";
import {
  customData,
  isRecoveryRequiredMarker,
  gateRequiresInspection,
  latestRecoveryGate,
  type RecoveryGateState,
} from "./recovery-state.ts";
import type {
  CompactionBoundaryMarker,
  ErrorClass,
  FailureDiagnostic,
  OpenTurn,
  RecoveryCheckedMarker,
  RecoveryRequiredMarker,
  TurnPhase,
  TurnSettledMarker,
  TurnStartMarker,
} from "./types.ts";
import { ERROR_MESSAGE_MAX } from "./types.ts";

const SCHEMA_VERSION = 2 as const;

function contextPercent(ctx: ExtensionContext): number | null {
  return ctx.getContextUsage()?.percent ?? null;
}

async function workspaceFingerprint(cwd: string): Promise<string> {
  const result = await collectWorkspaceSnapshot(cwd);
  // A recovery decision must fail closed when Git/snapshot collection is not
  // available: callers treat the unavailable value as changed/unsafe.
  return result.ok ? result.snapshot.fingerprint : "unavailable";
}

async function workspaceChanged(
  startFingerprint: string,
  cwd: string,
): Promise<boolean> {
  return (
    startFingerprint === "unavailable" ||
    (await workspaceFingerprint(cwd)) !== startFingerprint
  );
}

function primaryWorkspaceRoot(cwd: string): string {
  return canonicalWorkspaceRoot(cwd) ?? resolve(cwd);
}

function classifyFailure(
  errorMessage: string | undefined,
  phase: TurnPhase,
): {
  errorClass: ErrorClass;
  errorCode?: string;
} {
  const message = errorMessage ?? "";
  if (!message.trim() && phase.startsWith("streaming")) {
    // Ein Streaming-Abbruch ohne Fehlertext darf nicht als unbekannter Fehler
    // ohne Kontext erscheinen — die Phase selbst ist der Beleg.
    return { errorClass: "stream", errorCode: "STREAM_PHASE" };
  }
  const code = message.match(
    /\b(ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT)\b/,
  )?.[1];
  if (code) {
    return {
      errorClass:
        code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT"
          ? "timeout"
          : "network",
      errorCode: code,
    };
  }
  if (
    /\b(AccessDenied|Unpurchased|eligible for using the model|access to model denied)\b/i.test(
      message,
    )
  ) {
    return { errorClass: "auth", errorCode: "MODEL_ACCESS_DENIED" };
  }
  const status = message.match(/\b([45]\d\d)\b/)?.[1];
  if (status) return { errorClass: "http", errorCode: `HTTP_${status}` };
  if (/\b(auth|unauthori[sz]ed|forbidden|api key)\b/i.test(message)) {
    return { errorClass: "auth", errorCode: "AUTH" };
  }
  if (/\b(timeout|timed out)\b/i.test(message)) {
    return { errorClass: "timeout", errorCode: "TIMEOUT" };
  }
  if (/\b(stream|sse|websocket)\b/i.test(message)) {
    return { errorClass: "stream", errorCode: "STREAM" };
  }
  return { errorClass: "unknown" };
}

function truncateErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return message.length > ERROR_MESSAGE_MAX
    ? `${message.slice(0, ERROR_MESSAGE_MAX)}…`
    : message;
}

const GIT_TEXT_TIMEOUT_MS = 15_000;

/**
 * `git status --short`/`git diff --stat` output for recovery_check's report.
 * Same ENOBUFS risk class as F-01/F-02's root cause — execFileSync's default
 * 1 MiB pipe limit — reachable here via file *count* (many thousands of
 * changed paths) rather than diff size. trackedExec's spawn-based accumulator
 * drains both streams while retaining only bounded display text.
 */
async function gitText(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const result = await trackedExec("git", args, {
    cwd,
    timeout: GIT_TEXT_TIMEOUT_MS,
    env: gitEnv(),
    signal,
    maxOutputBytes: 256 * 1024,
  });
  if (result.code !== 0 || result.killed) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} schlug fehl (exit=${result.code === null ? "unbekannt" : result.code}${result.killed ? ", killed" : ""}).`,
    );
  }
  return (
    limitTextOutput(result.stdout).text +
    (result.stdoutTruncated ? "\n[Git-Ausgabe nach 256 KiB gekürzt.]" : "")
  );
}

function phaseFromMessage(event: MessageUpdateEvent): TurnPhase | undefined {
  if (event.assistantMessageEvent.type.startsWith("text_")) {
    return "streaming_text";
  }
  if (event.assistantMessageEvent.type.startsWith("toolcall_")) {
    return "streaming_tool_call";
  }
  return undefined;
}

function lastAssistantError(event: AgentEndEvent): string | undefined {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message.role !== "assistant") continue;
    return message.stopReason === "error" ? message.errorMessage : undefined;
  }
  return undefined;
}

function agentEndWasAborted(event: AgentEndEvent): boolean {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message.role !== "assistant") continue;
    return message.stopReason === "aborted";
  }
  return false;
}

function isMutatingTool(
  toolName: string,
  args: ToolCallEvent["input"],
  cwd: string,
): boolean {
  return (
    recoveryEffect({ toolName, input: args }, cwd) === "potentially_mutating"
  );
}

function latestRecoveryState(entries: readonly unknown[]): {
  openTurn?: TurnStartMarker;
  finalFailure?: TurnSettledMarker;
  requiredByTurn: Map<string, RecoveryRequiredMarker>;
  hasUnknownRequiredMarker: boolean;
} {
  let openTurn: TurnStartMarker | undefined;
  let finalFailure: TurnSettledMarker | undefined;
  let hasUnknownRequiredMarker = false;
  const requiredByTurn = new Map<string, RecoveryRequiredMarker>();
  for (const entry of entries) {
    const start = customData<TurnStartMarker>(entry, "resilience.turn-start");
    if (start) {
      openTurn = start;
      finalFailure = undefined;
      continue;
    }
    const settled = customData<TurnSettledMarker>(
      entry,
      "resilience.turn-settled",
    );
    if (settled && openTurn?.timestamp === settled.turnStartedAt) {
      openTurn = undefined;
      if (settled.outcome === "failed") finalFailure = settled;
      continue;
    }
    if (
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).type === "custom" &&
      (entry as Record<string, unknown>).customType ===
        "resilience.recovery-required"
    ) {
      const value = (entry as Record<string, unknown>).data;
      if (isRecoveryRequiredMarker(value)) {
        requiredByTurn.set(value.turnStartedAt, value);
      } else {
        hasUnknownRequiredMarker = true;
      }
    }
  }
  return {
    openTurn,
    finalFailure,
    requiredByTurn,
    hasUnknownRequiredMarker,
  };
}

/**
 * Gemeinsame Berichtszeilen für den Recovery-Check (Tool und automatische
 * Prüfung beim Turn-Start), damit beide denselben Wortlaut liefern.
 */
function inspectionLines(
  root: string,
  snapshot: WorkspaceSnapshot,
  gitStatus: string,
  diffStat: string,
  released: boolean,
): string[] {
  return [
    `Projektwurzel: ${root}`,
    released
      ? "Recovery-Check abgeschlossen: Die Schreibsperre für diese Wurzel ist aufgehoben."
      : "Kein offenes Recovery-Gate für diese Wurzel; der Workspace wurde geprüft.",
    `Workspace-Fingerprint: ${snapshot.fingerprint}`,
    `VCS: ${snapshot.vcs ?? "git"}`,
    ...(snapshot.vcs === "none"
      ? [`Filesystem-Einträge geprüft: ${snapshot.filesystemEntries}`]
      : ["git status --short:", gitStatus.trim() || "(keine Änderungen)"]),
    ...(diffStat.trim() ? ["git diff --stat:", diffStat.trim()] : []),
    "",
  ];
}

/** Anweisung, wenn der Workspace beim Turn-Start bereits automatisch geprüft wurde. */
function autoCheckedInstruction(report: string, failedRoots: string[]): string {
  const remaining = failedRoots.length
    ? ` Für ${failedRoots.join(", ")} war die automatische Prüfung nicht möglich: rufe dort recovery_check auf, bevor du schreibst.`
    : "";
  return `Die vorherige Ausführung wurde unterbrochen oder endete mit einem Fehler. Der Workspace wurde beim Start dieses Laufs bereits geprüft, die Schreibsperre ist aufgehoben.${remaining} Bericht:\n${report}\nPrüfe diesen Bericht sowie die letzten validen Tool-Ergebnisse. Behandle vorhandene Änderungen als möglicherweise bereits ausgeführt. Wiederhole keine mutierende Aktion, bevor geklärt ist, ob sie bereits lief. Setze den Nutzerauftrag fort.`;
}

function recoveryInstruction(
  workspaceWasChanged: boolean,
  toolMayHaveMutatedWorkspace: boolean,
  workspaceRoots: string[] = [],
): string {
  const inspectionRequired = workspaceWasChanged || toolMayHaveMutatedWorkspace;
  return inspectionRequired
    ? `Die vorherige Ausführung wurde unterbrochen oder endete mit einem Fehler. Rufe zuerst recovery_check auf${workspaceRoots.length ? ` und prüfe die betroffenen Wurzeln: ${workspaceRoots.join(", ")}` : ""}. Prüfe dessen Workspace-Bericht sowie die letzten validen Tool-Ergebnisse. Behandle vorhandene Änderungen als möglicherweise bereits ausgeführt. Wiederhole keine mutierende Aktion, bevor geklärt ist, ob sie bereits lief. Setze danach den Nutzerauftrag fort.`
    : "Die vorherige Ausführung wurde unterbrochen oder endete mit einem Fehler, ohne erkennbare Workspace-Mutation. Setze den Nutzerauftrag vom letzten validen Sessionpunkt aus fort; replaye keinen partiellen Tool-Call blind.";
}

export interface ResilienceOptions {
  /**
   * Offene Recovery-Gates beim Turn-Start automatisch prüfen (Standard). Mit
   * `false` bleibt das Gate bis zum manuellen `recovery_check` geschlossen; das
   * ist der Rückfall und der Weg, die Gate-Sperre selbst zu testen.
   */
  autoInspect?: boolean;
}

export default function resilienceExtension(
  pi: ExtensionAPI,
  options: ResilienceOptions = {},
): void {
  const autoInspect = options.autoInspect !== false;
  let openTurn: OpenTurn | undefined;
  let sessionCwd = "";
  let activeContext: ExtensionContext | undefined;
  let gate: RecoveryGateState | undefined;
  // Keep markers written during the current runtime visible even when a
  // SessionManager implementation publishes the updated branch on a later
  // turn. Pi's native manager updates synchronously; this also makes the
  // provider robust to adapters with delayed branch snapshots.
  const workspaceGates = new Map<string, RecoveryGateState>();
  let pendingRecovery:
    | {
        workspaceWasChanged: boolean;
        toolMayHaveMutatedWorkspace: boolean;
        workspaceRoots?: string[];
      }
    | undefined;
  const recoverySnapshotFailures = new Map<string, number>();
  const recoveryDisabledRoots = new Set<string>();
  const recoveryDisablePromptedRoots = new Set<string>();
  const recoverySkippedRoots = new Set<string>();
  let skipRecoveryWithoutGit = false;
  // Bumped by session_start/session_shutdown. agent_settled now awaits a
  // real snapshot collection before writing gate/openTurn — captured once
  // per call so a session restart landing mid-await is detectable and the
  // stale write is dropped instead of clobbering the new session's state.
  let sessionGeneration = 0;
  let turnGeneration = 0;

  function workspaceRootsForContext(ctx: ExtensionContext): string[] {
    const sessionId = ctx.sessionManager.getSessionId() ?? undefined;
    const additional = requestWorkspaceScope(
      pi.events,
      ctx.cwd,
      sessionId,
    ).additionalRoots;
    return [...new Set([primaryWorkspaceRoot(ctx.cwd), ...additional])];
  }

  function recoveryRootsForContext(ctx: ExtensionContext): string[] {
    return workspaceRootsForContext(ctx).filter(
      (root) =>
        !recoverySkippedRoots.has(root) && !recoveryDisabledRoots.has(root),
    );
  }

  function gateForRoot(root: string): RecoveryGateState | undefined {
    const entries = activeContext?.sessionManager.getBranch();
    const historyGate = entries ? latestRecoveryGate(entries, root) : undefined;
    const localGate =
      workspaceGates.get(root) ??
      (root === primaryWorkspaceRoot(sessionCwd) ? gate : undefined);
    if (!historyGate) return localGate;
    if (!localGate) return historyGate;
    const historyTimestamp =
      historyGate.checked?.timestamp ?? historyGate.required.timestamp;
    const localTimestamp =
      localGate.checked?.timestamp ?? localGate.required.timestamp;
    return Date.parse(localTimestamp) > Date.parse(historyTimestamp)
      ? localGate
      : historyGate;
  }

  function rememberRequiredMarker(
    required: RecoveryRequiredMarker,
    entries: readonly unknown[],
  ): void {
    const markerEntry = {
      type: "custom",
      customType: "resilience.recovery-required",
      data: required,
    };
    const roots = required.affectedRoots?.map((root) => root.workspaceRoot) ?? [
      required.workspaceRoot ?? primaryWorkspaceRoot(sessionCwd),
    ];
    for (const root of roots) {
      const next = latestRecoveryGate([...entries, markerEntry], root);
      if (next) workspaceGates.set(root, next);
    }
    gate = workspaceGates.get(primaryWorkspaceRoot(sessionCwd)) ?? gate;
  }

  function rememberCheckedMarker(
    root: string,
    required: RecoveryRequiredMarker,
    checked: RecoveryCheckedMarker,
    entries: readonly unknown[],
  ): void {
    const next = latestRecoveryGate(
      [
        ...entries,
        {
          type: "custom",
          customType: "resilience.recovery-required",
          data: required,
        },
        {
          type: "custom",
          customType: "resilience.recovery-checked",
          data: checked,
        },
      ],
      root,
    );
    if (next) workspaceGates.set(root, next);
    if (root === primaryWorkspaceRoot(sessionCwd)) gate = next;
  }

  function sameGate(
    left: RecoveryGateState | undefined,
    right: RecoveryGateState | undefined,
  ): boolean {
    return (
      left?.required.turnStartedAt === right?.required.turnStartedAt &&
      left?.required.workspaceRoot === right?.required.workspaceRoot &&
      left?.checked?.timestamp === right?.checked?.timestamp
    );
  }

  async function currentWorkspaceFingerprint(cwd: string): Promise<string> {
    return recoverySkippedRoots.has(primaryWorkspaceRoot(cwd))
      ? "recovery-skipped-without-git"
      : workspaceFingerprint(cwd);
  }

  async function currentWorkspaceChanged(
    startFingerprint: string,
    cwd: string,
  ): Promise<boolean> {
    return recoverySkippedRoots.has(primaryWorkspaceRoot(cwd))
      ? true
      : workspaceChanged(startFingerprint, cwd);
  }

  /** Ein persistierter Check schließt das zugehörige Gate dauerhaft. */
  async function recoverySnapshot(
    requestedRoot?: string,
  ): Promise<RecoveryStatusSnapshot> {
    // Captured once, up front: gate is shared module state, and this
    // function now awaits a real snapshot collection. It is called from the
    // permission guard's tool_call hot path with no try/catch around it —
    // reading `gate` again after the await (instead of this captured
    // reference) would throw if a concurrent agent_settled/session_shutdown
    // reassigns or clears it mid-await, taking the guard down with it.
    const ctx = activeContext;
    if (
      (requestedRoot !== undefined &&
        (recoverySkippedRoots.has(requestedRoot) ||
          recoveryDisabledRoots.has(requestedRoot))) ||
      (requestedRoot === undefined &&
        ctx !== undefined &&
        recoveryRootsForContext(ctx).length === 0)
    )
      return { armed: false, workspaceRoot: requestedRoot };
    const roots = requestedRoot
      ? [requestedRoot]
      : ctx
        ? recoveryRootsForContext(ctx)
        : [primaryWorkspaceRoot(sessionCwd)].filter(
            (root) =>
              !recoverySkippedRoots.has(root) &&
              !recoveryDisabledRoots.has(root),
          );
    const open = roots
      .map((root) => ({ root, currentGate: gateForRoot(root) }))
      .find(
        ({ currentGate }) =>
          currentGate &&
          gateRequiresInspection(currentGate.required) &&
          !currentGate.checked,
      );
    if (!open?.currentGate) {
      return { armed: false, workspaceRoot: requestedRoot };
    }
    const { root, currentGate } = open;
    if (!currentGate.checked) {
      return {
        armed: true,
        turnStartedAt: currentGate.required.turnStartedAt,
        reason: currentGate.required.reason,
        workspaceRoot: root,
      };
    }
    // The marker is durable and scoped to one required turn. Workspace edits
    // after this explicit inspection are expected work; only a new failure or
    // interrupted turn may create a new required marker.
    return { armed: false, workspaceRoot: root };
  }

  async function offerSessionRecoveryDisable(
    ctx: ExtensionContext,
    generation: number,
    checkedGate: RecoveryGateState | undefined,
    workspaceRoot: string,
  ): Promise<boolean> {
    if (
      generation !== sessionGeneration ||
      !sameGate(gateForRoot(workspaceRoot), checkedGate)
    ) {
      throw new Error(
        "Recovery-Check abgebrochen: Sitzung oder Recovery-Gate hat sich während der Prüfung geändert. Erneut prüfen.",
      );
    }
    const failureCount = (recoverySnapshotFailures.get(workspaceRoot) ?? 0) + 1;
    recoverySnapshotFailures.set(workspaceRoot, failureCount);
    if (
      failureCount < 3 ||
      recoveryDisablePromptedRoots.has(workspaceRoot) ||
      !ctx.hasUI
    ) {
      return false;
    }
    recoveryDisablePromptedRoots.add(workspaceRoot);
    const confirmed = await ctx.ui.confirm(
      "Recovery-Snapshot deaktivieren?",
      `Der Workspace-Snapshot für ${workspaceRoot} ist in dieser Sitzung dreimal fehlgeschlagen. Soll die Recovery-Schreibsperre nur für diese Projektwurzel bis zum Ende der Sitzung deaktiviert werden? Andere freigegebene Projektwurzeln behalten ihre eigene Recovery-Prüfung.`,
    );
    if (
      generation !== sessionGeneration ||
      !sameGate(gateForRoot(workspaceRoot), checkedGate)
    ) {
      throw new Error(
        "Recovery-Check abgebrochen: Sitzung oder Recovery-Gate hat sich während der Bestätigung geändert. Erneut prüfen.",
      );
    }
    if (!confirmed) return false;
    recoveryDisabledRoots.add(workspaceRoot);
    await updateRecoveryStatus();
    return true;
  }

  async function updateRecoveryStatus(): Promise<void> {
    const ctx = activeContext;
    const generation = sessionGeneration;
    if (!ctx) return;
    const snapshot = await recoverySnapshot();
    if (generation !== sessionGeneration || ctx !== activeContext) return;
    const roots = workspaceRootsForContext(ctx);
    const allSkippedWithoutGit =
      roots.length > 0 && roots.every((root) => recoverySkippedRoots.has(root));
    const disabledRoots = roots.filter((root) =>
      recoveryDisabledRoots.has(root),
    );
    setTuiStatus(
      ctx,
      UI_STATUS_KEYS.recovery,
      allSkippedWithoutGit
        ? "Recovery-Check ohne Git übersprungen"
        : snapshot.armed
          ? disabledRoots.length > 0
            ? `⚠ Recovery-Check offen · ${disabledRoots.length} ${disabledRoots.length === 1 ? "Projektwurzel" : "Projektwurzeln"} deaktiviert`
            : "⚠ Recovery-Check offen"
          : disabledRoots.length > 0
            ? `⚠ Recovery für ${disabledRoots.length} ${disabledRoots.length === 1 ? "Projektwurzel" : "Projektwurzeln"} deaktiviert`
            : undefined,
    );
  }

  async function appendFailure(
    ctx: ExtensionContext,
    errorMessage: string | undefined,
  ): Promise<void> {
    // Captured once, up front: openTurn is shared module state, and this
    // function now awaits a real snapshot collection. Re-reading openTurn
    // after that await instead of using this captured reference would risk
    // a concurrent agent_settled/before_agent_start clearing or replacing it
    // mid-await, throwing on the writes below or corrupting an unrelated turn.
    const turn = openTurn;
    if (!turn) return;
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    const cwd = ctx.cwd;
    // Record the failure before yielding, so a concurrently settling turn
    // cannot be mistaken for a success while diagnostics collect their hash.
    turn.observedFailureCount += 1;
    turn.currentAttemptFailed = true;
    const classification = classifyFailure(errorMessage, turn.phase);
    const diagnostic: FailureDiagnostic = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      provider: turn.marker.provider,
      model: turn.marker.model,
      contextPercent: contextPercent(ctx),
      errorClass: classification.errorClass,
      ...(classification.errorCode
        ? { errorCode: classification.errorCode }
        : {}),
      ...(truncateErrorMessage(errorMessage)
        ? { errorMessage: truncateErrorMessage(errorMessage) }
        : {}),
      phase: turn.phase,
      workspaceChangedSinceTurnStart: await currentWorkspaceChanged(
        turn.marker.workspaceFingerprint,
        cwd,
      ),
      toolMayHaveMutatedWorkspace: turn.toolMayHaveMutatedWorkspace,
      activeSubagents: turn.activeSubagents,
      settled: false,
    };
    if (
      generation !== sessionGeneration ||
      turnId !== turnGeneration ||
      openTurn !== turn
    )
      return;
    pi.appendEntry("resilience.failure", diagnostic);
  }

  async function collectRecoveryRequired(
    reason: RecoveryRequiredMarker["reason"],
    marker: TurnStartMarker,
    mutatedRoots: readonly string[],
    cwd: string,
  ): Promise<RecoveryRequiredMarker> {
    const primaryRoot = primaryWorkspaceRoot(cwd);
    const roots = [
      ...new Set([
        ...Object.keys(marker.workspaceFingerprintsByRoot ?? {}),
        marker.workspaceRoot ?? primaryRoot,
        ...mutatedRoots,
      ]),
    ].filter(
      (workspaceRoot) =>
        !recoverySkippedRoots.has(workspaceRoot) &&
        !recoveryDisabledRoots.has(workspaceRoot),
    );
    const affectedRoots = (
      await Promise.all(
        roots.map(async (workspaceRoot) => {
          const startFingerprint =
            marker.workspaceFingerprintsByRoot?.[workspaceRoot] ??
            (workspaceRoot === (marker.workspaceRoot ?? primaryRoot)
              ? marker.workspaceFingerprint
              : undefined);
          const currentFingerprint =
            await currentWorkspaceFingerprint(workspaceRoot);
          const workspaceChangedSinceTurnStart =
            startFingerprint === undefined ||
            startFingerprint === "unavailable" ||
            currentFingerprint !== startFingerprint;
          const toolMayHaveMutatedWorkspace =
            mutatedRoots.includes(workspaceRoot);
          return {
            workspaceRoot,
            workspaceChangedSinceTurnStart,
            toolMayHaveMutatedWorkspace,
          };
        }),
      )
    ).filter(
      (root) =>
        root.workspaceChangedSinceTurnStart || root.toolMayHaveMutatedWorkspace,
    );
    const workspaceChangedSinceTurnStart = affectedRoots.some(
      (root) => root.workspaceChangedSinceTurnStart,
    );
    const toolMayHaveMutatedWorkspace = affectedRoots.some(
      (root) => root.toolMayHaveMutatedWorkspace,
    );
    return {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: marker.timestamp,
      reason,
      workspaceChangedSinceTurnStart,
      toolMayHaveMutatedWorkspace,
      affectedRoots,
    };
  }

  /**
   * Prüft offene Recovery-Gates beim Turn-Start, statt das Modell erst gegen
   * die Schreibsperre laufen zu lassen. Es ist derselbe lesende Check wie das
   * Tool `recovery_check` (Snapshot, git status, git diff --stat) und schreibt
   * dieselben Marker. Schlägt eine Wurzel fehl, bleibt ihr Gate offen und die
   * Anweisung verweist auf das Tool.
   */
  async function inspectOpenGates(
    ctx: ExtensionContext,
    generation: number,
    turnId: number,
  ): Promise<{ report: string; failedRoots: string[] } | undefined> {
    const openRoots = recoveryRootsForContext(ctx).filter((root) => {
      const rootGate = gateForRoot(root);
      return Boolean(
        rootGate &&
        gateRequiresInspection(rootGate.required) &&
        !rootGate.checked,
      );
    });
    if (openRoots.length === 0) return undefined;
    const lines: string[] = [];
    const failedRoots: string[] = [];
    for (const root of openRoots) {
      const checkedGate = gateForRoot(root);
      const result = await collectWorkspaceSnapshot(root, {
        signal: ctx.signal,
      });
      let gitStatus = "";
      let diffStat = "";
      let ok = result.ok;
      if (result.ok && result.snapshot.vcs !== "none") {
        try {
          gitStatus = await gitText(root, ["status", "--short"], ctx.signal);
          diffStat = await gitText(root, ["diff", "--stat"], ctx.signal).catch(
            () => "(Diff-Zusammenfassung nicht verfügbar)",
          );
        } catch {
          ok = false;
        }
      }
      if (generation !== sessionGeneration || turnId !== turnGeneration)
        return undefined;
      const openRequired = checkedGate?.required;
      if (
        !ok ||
        !result.ok ||
        !openRequired ||
        !sameGate(gateForRoot(root), checkedGate)
      ) {
        failedRoots.push(root);
        continue;
      }
      const record: RecoveryCheckedMarker = {
        schemaVersion: SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        turnStartedAt: openRequired.turnStartedAt,
        workspaceFingerprint: result.snapshot.fingerprint,
        workspaceRoot: root,
      };
      pi.appendEntry("resilience.recovery-checked", record);
      rememberCheckedMarker(
        root,
        openRequired,
        record,
        ctx.sessionManager.getBranch(),
      );
      lines.push(
        ...inspectionLines(root, result.snapshot, gitStatus, diffStat, true),
      );
    }
    gate = gateForRoot(primaryWorkspaceRoot(ctx.cwd));
    await updateRecoveryStatus();
    if (lines.length === 0) return { report: "", failedRoots };
    return { report: limitTextOutput(lines.join("\n")).text, failedRoots };
  }

  function rememberRecovery(record: RecoveryRequiredMarker): void {
    pendingRecovery = {
      workspaceWasChanged: record.workspaceChangedSinceTurnStart,
      toolMayHaveMutatedWorkspace: record.toolMayHaveMutatedWorkspace,
      workspaceRoots: record.affectedRoots?.map((root) => root.workspaceRoot),
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionGeneration += 1;
    turnGeneration += 1;
    const generation = sessionGeneration;
    sessionCwd = ctx.cwd;
    activeContext = ctx;
    recoverySnapshotFailures.clear();
    recoveryDisabledRoots.clear();
    recoveryDisablePromptedRoots.clear();
    recoverySkippedRoots.clear();
    const setup = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted()).config;
    skipRecoveryWithoutGit = setup.recovery.skipWithoutGit;
    if (skipRecoveryWithoutGit) {
      for (const root of workspaceRootsForContext(ctx)) {
        const repository = probeGitRepository(root, {
          timeoutMs: 3_000,
          maxAttempts: 1,
        });
        if (repository.ok && !repository.hasRepository)
          recoverySkippedRoots.add(root);
      }
    }
    openTurn = undefined;
    pendingRecovery = undefined;
    const entries = ctx.sessionManager.getBranch();
    workspaceGates.clear();
    for (const root of workspaceRootsForContext(ctx)) {
      const rootGate = latestRecoveryGate(entries, root);
      if (rootGate) workspaceGates.set(root, rootGate);
    }
    // Neustart-Wahrheit zuerst aus den Einträgen: Ein bereits geprüftes Gate
    // behält seinen checked-Zustand über die Sitzung hinaus.
    const currentRoot = primaryWorkspaceRoot(ctx.cwd);
    gate = workspaceGates.get(currentRoot);
    const prior = latestRecoveryState(entries);
    const start =
      prior.openTurn ??
      (prior.finalFailure
        ? entries
            .map((entry) =>
              customData<TurnStartMarker>(entry, "resilience.turn-start"),
            )
            .find(
              (marker) =>
                marker?.timestamp === prior.finalFailure?.turnStartedAt,
            )
        : undefined);
    if (start) {
      const existing = prior.requiredByTurn.get(start.timestamp);
      if (existing) {
        const roots = existing.affectedRoots?.map(
          (root) => root.workspaceRoot,
        ) ?? [existing.workspaceRoot ?? currentRoot];
        const stillOpen = roots.some((root) => {
          const rootGate = latestRecoveryGate(entries, root);
          return Boolean(
            rootGate &&
            gateRequiresInspection(rootGate.required) &&
            !rootGate.checked,
          );
        });
        if (
          stillOpen &&
          roots.some(
            (root) =>
              !recoverySkippedRoots.has(root) &&
              !recoveryDisabledRoots.has(root),
          )
        ) {
          rememberRecovery(existing);
        }
      } else {
        const required = await collectRecoveryRequired(
          prior.openTurn ? "interrupted" : "final_failure",
          start,
          prior.hasUnknownRequiredMarker ? [currentRoot] : [],
          ctx.cwd,
        );
        if (generation !== sessionGeneration) return;
        pi.appendEntry("resilience.recovery-required", required);
        rememberRequiredMarker(required, entries);
        rememberRecovery(required);
      }
    }
    await updateRecoveryStatus();
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const generation = sessionGeneration;
    const turnId = ++turnGeneration;
    const cwd = ctx.cwd;
    const recovery = pendingRecovery;
    pendingRecovery = undefined;
    const roots = workspaceRootsForContext(ctx);
    const workspaceFingerprintsByRoot = Object.fromEntries(
      await Promise.all(
        roots.map(
          async (root) =>
            [root, await currentWorkspaceFingerprint(root)] as const,
        ),
      ),
    );
    const root = primaryWorkspaceRoot(cwd);
    const marker: TurnStartMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      workspaceFingerprint:
        workspaceFingerprintsByRoot[root] ??
        (await currentWorkspaceFingerprint(cwd)),
      workspaceRoot: root,
      workspaceFingerprintsByRoot,
      provider: ctx.model?.provider ?? "unknown",
      model: ctx.model?.id ?? "unknown",
      contextPercent: contextPercent(ctx),
    };
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    sessionCwd = cwd;
    openTurn = {
      marker,
      phase: "before_first_token",
      activeSubagents: 0,
      toolMayHaveMutatedWorkspace: false,
      mutatingWorkspaceRoots: new Set(),
      observedFailureCount: 0,
      currentAttemptFailed: false,
      currentAttemptAborted: false,
      currentAttemptAbortNeedsRecovery: false,
      activeMutatingToolCalls: new Set(),
    };
    pi.appendEntry("resilience.turn-start", marker);
    const inspected = autoInspect
      ? await inspectOpenGates(ctx, generation, turnId)
      : undefined;
    if (!recovery && !inspected?.report) return;
    const instruction = inspected?.report
      ? autoCheckedInstruction(inspected.report, inspected.failedRoots)
      : recovery
        ? recoveryInstruction(
            recovery.workspaceWasChanged,
            recovery.toolMayHaveMutatedWorkspace,
            recovery.workspaceRoots,
          )
        : undefined;
    if (!instruction) return;
    return {
      message: {
        customType: "pi-resilience-recovery",
        content: instruction,
        display: false,
      },
    };
  });

  pi.on("agent_start", () => {
    if (!openTurn) return;
    // A second agent_start before settled is Pi's native retry. This extension
    // observes it but never performs or configures retries itself.
    openTurn.currentAttemptFailed = false;
    openTurn.currentAttemptAborted = false;
    openTurn.currentAttemptAbortNeedsRecovery = false;
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (event.status >= 400) await appendFailure(ctx, String(event.status));
  });

  pi.on("message_update", async (event, ctx) => {
    if (!openTurn) return;
    const phase = phaseFromMessage(event);
    if (phase) openTurn.phase = phase;
    if (event.assistantMessageEvent.type === "error") {
      await appendFailure(ctx, event.assistantMessageEvent.error.errorMessage);
    }
  });

  pi.on("tool_execution_start", () => {
    if (!openTurn) return;
    openTurn.phase = "tool_running";
  });

  pi.events.on(RECOVERY_CAPABILITY_EVENTS.mutationApproved, (value) => {
    if (!openTurn || !value || typeof value !== "object") return;
    const approval = value as Partial<RecoveryMutationApproval>;
    if (
      typeof approval.toolName === "string" &&
      approval.input !== undefined &&
      isMutatingTool(approval.toolName, approval.input, sessionCwd)
    ) {
      openTurn.toolMayHaveMutatedWorkspace = true;
      const workspaceRoot =
        typeof approval.workspaceRoot === "string"
          ? approval.workspaceRoot
          : primaryWorkspaceRoot(sessionCwd);
      openTurn.mutatingWorkspaceRoots.add(workspaceRoot);
      const callKey = approval.toolCallId ?? approval.toolName;
      openTurn.activeMutatingToolCalls.add(callKey);
    }
  });

  pi.on("tool_execution_end", (event) => {
    if (!openTurn) return;
    openTurn.phase = "post_tool";
    const callKey =
      typeof event.toolCallId === "string" ? event.toolCallId : event.toolName;
    if (typeof callKey === "string")
      openTurn.activeMutatingToolCalls.delete(callKey);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    if (openTurn) openTurn.phase = "compaction";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "started",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: await currentWorkspaceFingerprint(ctx.cwd),
      contextPercent: contextPercent(ctx),
    };
    if (generation === sessionGeneration && turnId === turnGeneration)
      pi.appendEntry("resilience.compaction-boundary", marker);
  });

  // The installed Pi runtime emits this event natively from its core compaction
  // paths (`_emitSessionCompactFailed`). It is not part of the shipped
  // ExtensionAPI .d.ts, so only this registration is cast; every other hook
  // stays fully typed.
  type SessionCompactFailedEvent = {
    type: "session_compact_failed";
    reason: "manual" | "threshold" | "overflow";
    errorMessage: string;
    willRetry: boolean;
  };
  (
    pi.on as unknown as (
      event: "session_compact_failed",
      handler: (
        event: SessionCompactFailedEvent,
        ctx: ExtensionContext,
      ) => void | Promise<void>,
    ) => void
  )("session_compact_failed", async (event, ctx) => {
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    if (openTurn) openTurn.phase = "compaction";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "failed",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: await currentWorkspaceFingerprint(ctx.cwd),
      contextPercent: contextPercent(ctx),
      errorMessage: event.errorMessage,
    };
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    pi.appendEntry("resilience.compaction-boundary", marker);
    await appendFailure(ctx, event.errorMessage);
  });

  pi.on("session_compact", async (event, ctx) => {
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    if (openTurn) openTurn.phase = "post_tool";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "completed",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: await currentWorkspaceFingerprint(ctx.cwd),
      contextPercent: contextPercent(ctx),
    };
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    pi.appendEntry("resilience.compaction-boundary", marker);
  });

  pi.on("agent_end", async (event, ctx) => {
    if (agentEndWasAborted(event) && openTurn) {
      openTurn.currentAttemptAborted = true;
      if (openTurn.activeMutatingToolCalls.size > 0) {
        openTurn.currentAttemptAbortNeedsRecovery = true;
      }
      return;
    }
    const error = lastAssistantError(event);
    if (error && !openTurn?.currentAttemptFailed)
      await appendFailure(ctx, error);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    // Captured once, up front — same reasoning as appendFailure/
    // recoverySnapshot above: this handler now awaits real snapshot
    // collection, and both openTurn and sessionGeneration are shared module
    // state a concurrent session_start could replace mid-await. Re-reading
    // openTurn afterward could clear a brand-new turn instead of this one;
    // the generation check below stops this handler from writing gate/
    // appending entries for a session that has since restarted.
    const turn = openTurn;
    if (!turn) return;
    const generation = sessionGeneration;
    const failed = turn.currentAttemptFailed;
    const turnId = turnGeneration;
    const outcome: TurnSettledMarker["outcome"] = failed
      ? "failed"
      : turn.currentAttemptAborted
        ? "aborted"
        : turn.observedFailureCount > 0
          ? "completed_after_failure"
          : "completed";
    const settled: TurnSettledMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: turn.marker.timestamp,
      workspaceFingerprint: await currentWorkspaceFingerprint(ctx.cwd),
      outcome,
      observedFailureCount: turn.observedFailureCount,
      ...(failed || turn.currentAttemptAbortNeedsRecovery
        ? { recoveryPending: true }
        : {}),
    };
    const required =
      failed || turn.currentAttemptAbortNeedsRecovery
        ? await collectRecoveryRequired(
            failed ? "final_failure" : "interrupted",
            turn.marker,
            [...turn.mutatingWorkspaceRoots],
            ctx.cwd,
          )
        : undefined;
    if (
      generation !== sessionGeneration ||
      turnId !== turnGeneration ||
      openTurn !== turn
    )
      return;
    pi.appendEntry("resilience.turn-settled", settled);
    if (required) {
      rememberRecovery(required);
      pi.appendEntry("resilience.recovery-required", required);
      rememberRequiredMarker(required, ctx.sessionManager.getBranch());
      // Das Gate sperrt nur bei möglicher Mutation; ein Fehlturn ohne jede
      // Workspace-Spur verlangt eine Fortsetzungs-Anweisung, keinen Check.
    }
    openTurn = undefined;
    if (required) await updateRecoveryStatus();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionGeneration += 1;
    turnGeneration += 1;
    openTurn = undefined;
    activeContext = undefined;
    gate = undefined;
    workspaceGates.clear();
    pendingRecovery = undefined;
    recoverySnapshotFailures.clear();
    recoveryDisabledRoots.clear();
    recoveryDisablePromptedRoots.clear();
    recoverySkippedRoots.clear();
    skipRecoveryWithoutGit = false;
    setTuiStatus(ctx, UI_STATUS_KEYS.recovery, undefined);
  });

  pi.events.on(RECOVERY_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<RecoveryStatusRequest>;
    request.respond?.(recoverySnapshot(request.workspaceRoot));
  });

  pi.registerTool({
    name: "recovery_check",
    label: "Recovery prüfen",
    description:
      "Read-only-Recovery-Check nach einem unterbrochenen oder fehlgeschlagenen Turn. Ohne workspaceRoot prüft er alle betroffenen freigegebenen Projektwurzeln; mit workspaceRoot nur diese Wurzel. Ein erfolgreicher Check schließt das Gate nur für die geprüfte Wurzel. Ein neuer Fehlturn oder eine neue Unterbrechung öffnet ein neues Gate. Wenn recovery.skipWithoutGit global aktiviert ist, wird der Check für jede Wurzel ohne Git-Repository übersprungen. Nach drei Snapshot-Fehlern derselben Wurzel kann der Nutzer die Recovery-Prüfung für diese Wurzel bis zum Sitzungsende deaktivieren. Führt selbst keine Schreiboperationen aus und wiederholt nichts.",
    promptSnippet:
      "Inspect the workspace after an interrupted or failed turn and release the recovery write gate.",
    parameters: Type.Object({
      workspaceRoot: Type.Optional(Type.String({ minLength: 1 })),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const generation = sessionGeneration;
      const input = params as { workspaceRoot?: string };
      const roots = workspaceRootsForContext(ctx);
      let selectedRoots: string[];
      if (input.workspaceRoot !== undefined) {
        const requestedRoot = canonicalWorkspaceRoot(
          resolve(ctx.cwd, input.workspaceRoot),
        );
        if (!requestedRoot || !roots.includes(requestedRoot)) {
          throw new Error(
            "Recovery-Check abgelehnt: Die Projektwurzel ist in dieser Sitzung nicht freigegeben.",
          );
        }
        if (recoverySkippedRoots.has(requestedRoot)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Recovery-Check für ${requestedRoot} wird übersprungen: recovery.skipWithoutGit ist aktiviert und diese Wurzel enthält kein Git-Repository.`,
              },
            ],
          };
        }
        if (recoveryDisabledRoots.has(requestedRoot)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Recovery-Snapshot ist für diese Sitzung deaktiviert (Projektwurzel: ${requestedRoot}). Beim nächsten Sitzungsstart ist die Prüfung wieder aktiv.`,
              },
            ],
          };
        }
        selectedRoots = [requestedRoot];
      } else {
        const availableRoots = roots.filter(
          (root) =>
            !recoverySkippedRoots.has(root) && !recoveryDisabledRoots.has(root),
        );
        if (availableRoots.length === 0) {
          const allSkipped =
            roots.length > 0 &&
            roots.every((root) => recoverySkippedRoots.has(root));
          return {
            content: [
              {
                type: "text" as const,
                text: allSkipped
                  ? "Recovery-Check wird übersprungen: recovery.skipWithoutGit ist aktiviert und keine freigegebene Wurzel enthält ein Git-Repository."
                  : "Recovery-Snapshot ist für diese Sitzung deaktiviert (alle freigegebenen Wurzeln). Beim nächsten Sitzungsstart ist die Prüfung wieder aktiv.",
              },
            ],
          };
        }
        selectedRoots = availableRoots.filter((root) => {
          const rootGate = gateForRoot(root);
          return Boolean(
            rootGate &&
            gateRequiresInspection(rootGate.required) &&
            !rootGate.checked,
          );
        });
        if (selectedRoots.length === 0) {
          const primaryRoot = primaryWorkspaceRoot(ctx.cwd);
          selectedRoots = [
            availableRoots.includes(primaryRoot)
              ? primaryRoot
              : availableRoots[0],
          ];
        }
      }

      const inspections: Array<{
        root: string;
        gate?: RecoveryGateState;
        snapshot: WorkspaceSnapshot;
        gitStatus: string;
        diffStat: string;
      }> = [];
      for (const root of selectedRoots) {
        const checkedGate = gateForRoot(root);
        const result = await collectWorkspaceSnapshot(root, { signal });
        if (!result.ok) {
          if (
            await offerSessionRecoveryDisable(
              ctx,
              generation,
              checkedGate,
              root,
            )
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Recovery-Snapshot und Recovery-Schreibsperre sind für diese Sitzung deaktiviert. Beim nächsten Sitzungsstart ist die Prüfung wieder aktiv.",
                },
              ],
            };
          }
          throw new Error(
            `Recovery-Check fehlgeschlagen: Workspace-Snapshot nicht erfassbar in ${root} (${result.error.code}: ${result.error.message}). Die Schreibsperre für diese Wurzel bleibt bestehen. Behebe die Ursache und rufe recovery_check erneut auf. Führe keine pauschale Bereinigung (\`git reset --hard\`, \`git clean -fd\`) aus.`,
          );
        }
        let gitStatus = "";
        let diffStat = "";
        if (result.snapshot.vcs !== "none") {
          try {
            gitStatus = await gitText(root, ["status", "--short"], signal);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            if (
              await offerSessionRecoveryDisable(
                ctx,
                generation,
                checkedGate,
                root,
              )
            ) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Recovery-Snapshot und Recovery-Schreibsperre sind für diese Sitzung deaktiviert. Beim nächsten Sitzungsstart ist die Prüfung wieder aktiv.",
                  },
                ],
              };
            }
            throw new Error(
              `Recovery-Check fehlgeschlagen: git status nicht lesbar in ${root} (${message}). Die Schreibsperre für diese Wurzel bleibt bestehen. Behebe die Ursache, statt den Workspace pauschal zurückzusetzen.`,
            );
          }
          try {
            diffStat = await gitText(root, ["diff", "--stat"], signal);
          } catch {
            diffStat = "(Diff-Zusammenfassung nicht verfügbar)";
          }
        }
        inspections.push({
          root,
          gate: checkedGate,
          snapshot: result.snapshot,
          gitStatus,
          diffStat,
        });
      }

      if (signal?.aborted || generation !== sessionGeneration) {
        throw new Error(
          "Recovery-Check abgebrochen: Die Sitzung hat sich während der Prüfung geändert. Erneut prüfen.",
        );
      }
      for (const inspection of inspections) {
        if (!sameGate(gateForRoot(inspection.root), inspection.gate)) {
          throw new Error(
            `Recovery-Check abgebrochen: Das Gate für ${inspection.root} hat sich während der Prüfung geändert. Erneut prüfen.`,
          );
        }
      }
      for (const inspection of inspections) {
        const openRequired = inspection.gate?.required;
        if (openRequired && gateRequiresInspection(openRequired)) {
          const record: RecoveryCheckedMarker = {
            schemaVersion: SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
            turnStartedAt: openRequired.turnStartedAt,
            workspaceFingerprint: inspection.snapshot.fingerprint,
            workspaceRoot: inspection.root,
          };
          pi.appendEntry("resilience.recovery-checked", record);
          rememberCheckedMarker(
            inspection.root,
            openRequired,
            record,
            ctx.sessionManager.getBranch(),
          );
        }
      }
      gate = gateForRoot(primaryWorkspaceRoot(ctx.cwd));
      await updateRecoveryStatus();

      const lines = inspections.flatMap((inspection) => {
        const openRequired = inspection.gate?.required;
        return inspectionLines(
          inspection.root,
          inspection.snapshot,
          inspection.gitStatus,
          inspection.diffStat,
          Boolean(openRequired && gateRequiresInspection(openRequired)),
        );
      });
      const limited = limitTextOutput(lines.join("\n"));
      for (const root of inspections.map((inspection) => inspection.root)) {
        recoverySnapshotFailures.delete(root);
        recoveryDisablePromptedRoots.delete(root);
      }
      return {
        content: [{ type: "text" as const, text: limited.text }],
        details: {
          checkedRoots: inspections.map((inspection) => ({
            workspaceRoot: inspection.root,
            turnStartedAt: inspection.gate?.required.turnStartedAt,
            changedFiles: inspection.snapshot.changedFiles,
          })),
          ...(limited.truncation ? { truncation: limited.truncation } : {}),
        },
      };
    },
  });

  pi.events.on("subagent:async-started", () => {
    if (openTurn) openTurn.activeSubagents += 1;
  });

  pi.events.on("subagent:async-complete", () => {
    if (openTurn)
      openTurn.activeSubagents = Math.max(0, openTurn.activeSubagents - 1);
  });
}
