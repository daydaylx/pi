import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { collectContextDiagnostics } from "../setup-core/context-diagnostics.ts";
import { renderInspectorBox, type InspectorContent } from "./inspector.ts";
import { thinkingLabel } from "./thinking.ts";
import type { AuroraUiState } from "./state.ts";
import type {
  TaskViewModel,
  VerificationViewModel,
} from "./task-view-model.ts";

export interface InspectorDeps {
  getState: () => AuroraUiState | undefined;
  getTask: () => TaskViewModel | undefined;
}

interface InspectorEntry {
  id:
    | "changes"
    | "context"
    | "verification"
    | "models"
    | "reasoning"
    | "diagnostics";
  label: string;
}

// Same priority order the UI rework concept package gives for unifying
// secondary surfaces behind one inspector shell.
const ENTRIES: readonly InspectorEntry[] = [
  { id: "changes", label: "Changes" },
  { id: "context", label: "Kontext" },
  { id: "verification", label: "Verification Evidence" },
  { id: "models", label: "Modelle" },
  { id: "reasoning", label: "Reasoning" },
  { id: "diagnostics", label: "Diagnostics" },
];

function changesContent(state: AuroraUiState): InspectorContent {
  const changes = state.changes;
  return {
    title: "CHANGES",
    badge: changes
      ? `${changes.filesCount} ${changes.filesCount === 1 ? "Datei" : "Dateien"}`
      : undefined,
    sections: changes
      ? [
          {
            title: "Diff",
            lines: [`+${changes.linesAdded} −${changes.linesRemoved}`],
          },
          { title: "Dateien", lines: changes.files.slice(0, 10) },
        ]
      : [
          {
            title: "",
            lines: ["Keine Edit-/Write-Operationen in dieser Session."],
          },
        ],
    actions: [{ label: "Details/Diff", key: "/changes" }],
  };
}

/**
 * Deliberately does NOT break the active context down by category
 * (conversation/files/tool results/memory) — that would need a per-category
 * token estimate the runtime cannot provide without guessing, which the UI
 * rework's own leitplanken rule out as fake precision. Only fields the
 * runtime reports exactly (bytes, counts, timestamps) are shown.
 */
function contextContent(
  diagnostics: ReturnType<typeof collectContextDiagnostics>,
): InspectorContent {
  const active = diagnostics.activeContext;
  const percentText =
    active?.percent === null || active?.percent === undefined
      ? "n/a"
      : `${active.percent.toFixed(1)}%`;
  return {
    title: "KONTEXT",
    badge: percentText,
    sections: [
      {
        title: "Fenster",
        lines: [
          `Tokens: ${active?.tokens ?? "n/a"} / ${active?.contextWindow ?? "n/a"}`,
          `Anteil: ${percentText}`,
        ],
      },
      {
        title: "Bytes (deterministisch)",
        lines: [
          `System-Prompt: ${diagnostics.systemPromptBytes ?? "n/a"} bytes`,
          `Aktive Tool-Schemas: ${diagnostics.schemaBytes} bytes`,
        ],
      },
      {
        title: "Compaction",
        lines: [
          `Anzahl: ${diagnostics.compactionTimestamps.length}`,
          `Zuletzt: ${diagnostics.compactionTimestamps.at(-1) ?? "keine"}`,
        ],
      },
      {
        title: "Lifetime Usage (kumulativ, kein aktueller Anteil)",
        lines: diagnostics.lifetimeUsage
          ? [
              `input=${diagnostics.lifetimeUsage.input}, output=${diagnostics.lifetimeUsage.output}`,
              `cacheRead=${diagnostics.lifetimeUsage.cacheRead}, cacheWrite=${diagnostics.lifetimeUsage.cacheWrite}`,
            ]
          : ["n/a"],
      },
    ],
    actions: [{ label: "Vollständige Diagnose", key: "/setup-doctor context" }],
  };
}

function verificationChecksLines(
  verification: VerificationViewModel,
): string[] {
  const checks = verification.checks ?? [];
  if (checks.length === 0) return ["keine deklarierten Pflichtprüfungen"];
  return checks.map((check) => {
    const glyph =
      check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "○";
    return `${glyph} ${check.label} (${check.status})`;
  });
}

function verificationContent(
  verification: VerificationViewModel | undefined,
): InspectorContent {
  if (!verification) {
    return {
      title: "VERIFICATION EVIDENCE",
      sections: [
        { title: "", lines: ["Keine Verification-Daten für diese Session."] },
      ],
    };
  }
  return {
    title: "VERIFICATION EVIDENCE",
    badge: verification.verdict,
    sections: [
      { title: "Checks", lines: verificationChecksLines(verification) },
      {
        title: "Evidence",
        lines:
          verification.evidence && verification.evidence.length > 0
            ? verification.evidence
            : ["keine"],
      },
    ],
  };
}

function modelsContent(state: AuroraUiState): InspectorContent {
  return {
    title: "MODELLE",
    sections: [{ title: "Aktiv", lines: [state.model.id ?? "n/a"] }],
    actions: [{ label: "/model", key: "Super+M" }],
  };
}

function reasoningContent(state: AuroraUiState): InspectorContent {
  return {
    title: "REASONING",
    sections: [
      { title: "Thinking", lines: [thinkingLabel(state.model.thinking)] },
    ],
    actions: [{ label: "/thinking", key: "Super+D" }],
  };
}

function diagnosticsContent(
  state: AuroraUiState,
  diagnostics: ReturnType<typeof collectContextDiagnostics>,
): InspectorContent {
  return {
    title: "DIAGNOSTICS",
    sections: [
      {
        title: "Tool-Truncations",
        lines: [
          `count=${diagnostics.toolTruncation.count}, bytes=${diagnostics.toolTruncation.totalBytes}`,
        ],
      },
      {
        title: "LSP",
        lines: [
          state.lsp.state
            ? `${state.lsp.state}${state.lsp.detail ? ` (${state.lsp.detail})` : ""}`
            : "n/a",
        ],
      },
    ],
    actions: [{ label: "Vollständige Diagnose", key: "/setup-doctor" }],
  };
}

export function registerInspectorCommand(
  pi: ExtensionAPI,
  deps: InspectorDeps,
): void {
  pi.registerCommand("inspect", {
    description: catalogDescription("inspect"),
    handler: async (_args, ctx) => {
      const state = deps.getState();
      if (!state) {
        ctx.ui.notify(
          "Inspector ist erst nach Sitzungsstart verfügbar.",
          "warning",
        );
        return;
      }

      const choice = await ctx.ui.select(
        "Inspector",
        ENTRIES.map((entry) => entry.label),
      );
      const entry = ENTRIES.find((candidate) => candidate.label === choice);
      if (!entry) return;

      const content = buildContent(pi, ctx, state, deps.getTask(), entry.id);
      const lines = renderInspectorBox(content, ctx.ui.theme, 76);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function buildContent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: AuroraUiState,
  task: TaskViewModel | undefined,
  id: InspectorEntry["id"],
): InspectorContent {
  switch (id) {
    case "changes":
      return changesContent(state);
    case "context":
      return contextContent(collectDiagnostics(pi, ctx));
    case "verification":
      return verificationContent(task?.verification);
    case "models":
      return modelsContent(state);
    case "reasoning":
      return reasoningContent(state);
    case "diagnostics":
      return diagnosticsContent(state, collectDiagnostics(pi, ctx));
  }
}

function collectDiagnostics(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): ReturnType<typeof collectContextDiagnostics> {
  return collectContextDiagnostics({
    registeredTools: pi.getAllTools(),
    activeToolNames: pi.getActiveTools(),
    systemPrompt: ctx.getSystemPrompt(),
    sessionEntries: ctx.sessionManager.getEntries(),
    activeContext: ctx.getContextUsage(),
    model: ctx.model,
  });
}
