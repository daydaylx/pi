/**
 * Edit-fallback advisory blocking for issue #104.
 *
 * The fallback hierarchy itself (precise edit → re-read → refine search
 * pattern once → larger structured patch → full write only for new/small
 * files) is agent behaviour, not automated code (see edit-metrics.ts). This
 * module closes the two gaps the issue calls out as missing:
 *
 *   - repeated identical edit failures must be prevented, not just counted;
 *   - full-file rewrites of existing files must be bounded/justified.
 *
 * Like doom-loop.ts, this module never registers its own blocking tool_call
 * hook — mode-permissions.ts is intentionally the only extension that does
 * that. Instead it tracks session-scoped state and exposes it via a
 * capability bus (edit-fallback-capabilities.ts) that mode-permissions.ts
 * consults and turns into an "ask" decision (never a silent hard block).
 *
 * Two different detection shapes:
 *   - Edit retry: recorded from a *past* tool_result failure, matched by
 *     signature against a *future* tool_call. Order-independent, exactly
 *     like doom-loop's identical-failure pattern.
 *   - Full rewrite: a *one-shot* check of the *current* write tool_call
 *     against paths seen so far this session. This relies on setup-core
 *     being registered before mode-permissions.ts (see settings.json
 *     "extensions", setup-core/index.ts precedes mode-permissions.ts) so
 *     the candidate is set before mode-permissions' tool_call handler runs
 *     for the same event.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  EDIT_FALLBACK_CAPABILITY_EVENTS,
  type EditFallbackCapabilityRequest,
  type EditFallbackSnapshot,
} from "../shared/edit-fallback-capabilities.ts";

/** Normalise a path-like input value for stable per-file keys. */
function normalisePathKey(value: unknown): string {
  const s = String(value ?? "")
    .trim()
    .replace(/\\/g, "/");
  return s.replace(/^\.\//, "") || "(unknown)";
}

function firstOldText(input: Record<string, unknown>): unknown {
  return Array.isArray(input.edits)
    ? (input.edits as Array<{ oldText?: unknown }>)[0]?.oldText
    : input.oldText;
}

/** Deterministic signature for a single edit attempt: path + oldText. */
function editSignature(path: unknown, oldText: unknown): string {
  return `${normalisePathKey(path)}|${String(oldText ?? "").trim()}`;
}

export interface EditFallbackState {
  /** Edit signatures (path+oldText) that have failed at least once. */
  failedEditSignatures: Set<string>;
  /** Paths that have been read or successfully edited/written this session. */
  seenPaths: Set<string>;
  /** The current advisory candidate for the in-flight tool_call, if any. */
  candidate?: EditFallbackSnapshot;
}

export function createEditFallbackState(): EditFallbackState {
  return { failedEditSignatures: new Set(), seenPaths: new Set() };
}

/**
 * Register the edit-fallback detector. Session-scoped; cleared at
 * `session_shutdown`.
 */
export function registerEditFallbackDetector(
  pi: ExtensionAPI,
  state: EditFallbackState = createEditFallbackState(),
  options: { existCheck?: (path: string) => boolean } = {},
): EditFallbackState {
  pi.on("tool_call", (event) => {
    const input = (event as { input?: Record<string, unknown> }).input ?? {};

    if (event.toolName === "read") {
      state.seenPaths.add(normalisePathKey(input.path ?? input.filePath));
      return;
    }

    if (event.toolName === "edit") {
      const path = normalisePathKey(input.path ?? input.filePath);
      const signature = editSignature(path, firstOldText(input));
      if (state.failedEditSignatures.has(signature)) {
        state.candidate = {
          kind: "edit-retry",
          blockedPath: path,
          blockedSignature: signature,
          reason:
            "Dieses Suchmuster ist bereits einmal fehlgeschlagen — lies den Ausschnitt erneut, statt es unverändert zu wiederholen.",
        };
      }
      return;
    }

    if (event.toolName === "write") {
      const path = normalisePathKey(input.path ?? input.filePath);
      const existing = options.existCheck?.(path) === true;
      if (existing && !state.seenPaths.has(path)) {
        state.candidate = {
          kind: "full-rewrite",
          blockedPath: path,
          reason:
            "Vollständiges Rewrite einer bestehenden Datei ohne vorherigen read- oder edit-Versuch — nutze zuerst edit.",
        };
      }
      // Mark as seen regardless: a confirmed override must not re-trigger
      // on a second identical write to the same path.
      state.seenPaths.add(path);
    }
  });

  pi.on("tool_result", (event) => {
    const input = (event as { input?: Record<string, unknown> }).input ?? {};
    if (event.toolName !== "edit") return;
    const path = normalisePathKey(input.path ?? input.filePath);
    if (!event.isError) {
      state.seenPaths.add(path);
      // A successful edit clears any pending candidate for this path.
      if (state.candidate?.blockedPath === path) state.candidate = undefined;
      return;
    }
    state.failedEditSignatures.add(editSignature(path, firstOldText(input)));
  });

  pi.events.on(EDIT_FALLBACK_CAPABILITY_EVENTS.request, (busEvent) => {
    const request = busEvent as EditFallbackCapabilityRequest;
    request.respond(state.candidate ?? {});
  });

  pi.on("session_shutdown", () => {
    state.failedEditSignatures.clear();
    state.seenPaths.clear();
    state.candidate = undefined;
  });

  return state;
}
