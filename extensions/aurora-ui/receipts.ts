import type { Theme } from "@earendil-works/pi-coding-agent";
import { crop } from "./layout.ts";
import type {
  ReceiptKind,
  ReceiptStatus,
  TaskReceipt,
} from "./task-view-model.ts";

export interface ToolExecutionRecord {
  id: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  startedAt: number;
  completedAt?: number;
}

/** How many recently completed tool records {@link ReceiptAggregator.getRecord}
 * can still resolve. Bounded so a long session cannot grow this without limit;
 * the receipts themselves (and error details in particular) never depend on
 * the record surviving here — they already carry their own summary/errorDetails
 * inline, so an evicted record only loses its optional drill-down target, not
 * the receipt's visible content. */
const MAX_RECENT_RECORDS = 20;

export class ReceiptAggregator {
  private activeRecords = new Map<string, ToolExecutionRecord>();
  private completedReceipts: TaskReceipt[] = [];
  private recentRecords: ToolExecutionRecord[] = [];

  // Aggregated counters
  private inspectedFiles = new Set<string>();
  private searchQueries = new Set<string>();
  private editedFiles = new Set<string>();
  // Id of the most recent completed record behind each aggregated receipt,
  // used as that receipt's detailRef — never invented, only ever a real id.
  private lastRecordId: {
    investigation?: string;
    search?: string;
    edit?: string;
  } = {};

  recordStart(
    id: string,
    toolName: string,
    args: unknown,
    startedAt: number,
  ): void {
    this.activeRecords.set(id, {
      id,
      toolName,
      args,
      startedAt,
    });
  }

  recordEnd(
    id: string,
    result: unknown,
    isError: boolean,
    completedAt: number,
  ): void {
    const record = this.activeRecords.get(id);
    if (!record) return;
    record.result = result;
    record.isError = isError;
    record.completedAt = completedAt;
    this.activeRecords.delete(id);
    this.recentRecords.push(record);
    if (this.recentRecords.length > MAX_RECENT_RECORDS) {
      this.recentRecords.shift();
    }
    this.processCompletedRecord(record);
  }

  /** Resolves a receipt's `detailRef` back to its raw tool record, when it is
   * still within the recent-records window. */
  getRecord(id: string): ToolExecutionRecord | undefined {
    return this.recentRecords.find((record) => record.id === id);
  }

  reset(): void {
    this.activeRecords.clear();
    this.completedReceipts = [];
    this.recentRecords = [];
    this.inspectedFiles.clear();
    this.searchQueries.clear();
    this.editedFiles.clear();
    this.lastRecordId = {};
  }

  private extractPath(args: unknown): string | undefined {
    if (!args || typeof args !== "object") return undefined;
    const rec = args as Record<string, unknown>;
    if (typeof rec.path === "string") return rec.path;
    if (typeof rec.filePath === "string") return rec.filePath;
    if (typeof rec.file === "string") return rec.file;
    if (typeof rec.pattern === "string") return rec.pattern;
    if (typeof rec.query === "string") return rec.query;
    return undefined;
  }

  private processCompletedRecord(record: ToolExecutionRecord): void {
    const { toolName, args, isError, result } = record;
    const target = this.extractPath(args);

    if (
      toolName === "read" ||
      toolName === "read_file" ||
      toolName === "view_file" ||
      toolName.startsWith("read_")
    ) {
      if (target) {
        this.inspectedFiles.add(target);
        this.lastRecordId.investigation = record.id;
      }
    } else if (
      toolName === "grep" ||
      toolName === "find" ||
      toolName === "grep_search" ||
      toolName === "find_by_name" ||
      toolName.startsWith("lsp_")
    ) {
      if (target) {
        this.searchQueries.add(target);
        this.lastRecordId.search = record.id;
      }
    } else if (
      toolName === "edit" ||
      toolName === "write" ||
      toolName === "write_to_file"
    ) {
      if (target) {
        this.editedFiles.add(target);
        this.lastRecordId.edit = record.id;
      }
    }

    if (isError) {
      const errorMsg =
        typeof result === "string"
          ? result
          : result && typeof result === "object" && "content" in result
            ? String((result as { content: unknown }).content)
            : `Tool ${toolName} fehlgeschlagen.`;

      this.completedReceipts.push({
        id: record.id,
        kind: "generic",
        status: "failed",
        title: `${toolName} (Fehler)`,
        summary: errorMsg.slice(0, 120),
        errorDetails: errorMsg,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        detailRef: record.id,
      });
    }
  }

  getReceipts(): TaskReceipt[] {
    const receipts: TaskReceipt[] = [];

    // Investigation receipt
    if (this.inspectedFiles.size > 0) {
      const count = this.inspectedFiles.size;
      receipts.push({
        id: "receipt-investigation",
        kind: "investigation",
        status: "completed",
        title: "Investigation",
        summary: `${count} ${count === 1 ? "Datei" : "Dateien"} untersucht`,
        metrics: [`${count} files inspected`],
        evidenceRefs: [...this.inspectedFiles].slice(0, 5),
        detailRef: this.lastRecordId.investigation,
      });
    }

    // Search receipt
    if (this.searchQueries.size > 0) {
      const count = this.searchQueries.size;
      receipts.push({
        id: "receipt-search",
        kind: "search",
        status: "completed",
        title: "Suche",
        summary: `${count} ${count === 1 ? "Suchabfrage" : "Suchabfragen"} ausgeführt`,
        metrics: [`${count} patterns queried`],
        evidenceRefs: [...this.searchQueries].slice(0, 5),
        detailRef: this.lastRecordId.search,
      });
    }

    // Changes receipt
    if (this.editedFiles.size > 0) {
      const count = this.editedFiles.size;
      receipts.push({
        id: "receipt-edits",
        kind: "edit",
        status: "completed",
        title: "Änderungen",
        // Diff statistics belong to diff-viewer, which is the only component
        // with the actual before/after snapshots. A receipt must not guess.
        summary: `${count} ${count === 1 ? "Datei geändert" : "Dateien geändert"}`,
        metrics: [`${count} files`],
        evidenceRefs: [...this.editedFiles].slice(0, 5),
        detailRef: this.lastRecordId.edit,
      });
    }

    // Explicit error receipts
    receipts.push(...this.completedReceipts);

    return receipts;
  }
}

export function receiptGlyph(kind: ReceiptKind, status: ReceiptStatus): string {
  if (status === "failed") return "✗";
  if (status === "warning") return "⚠";
  if (status === "running") return "◌";
  switch (kind) {
    case "investigation":
      return "✓";
    case "search":
      return "⌕";
    case "edit":
      return "✎";
    case "test":
      return "▹";
    case "verification":
      return "✓";
    case "subagent":
      return "◉";
    case "generic":
      return "✓";
  }
}

export function renderReceiptLines(
  receipts: readonly TaskReceipt[],
  theme: Theme,
  width: number,
  limit = 4,
): string[] {
  if (receipts.length === 0) return [];
  const lines: string[] = [];
  const visible = receipts.slice(-limit);

  for (const receipt of visible) {
    const glyph = receiptGlyph(receipt.kind, receipt.status);
    const tone =
      receipt.status === "failed"
        ? "error"
        : receipt.status === "warning"
          ? "warning"
          : receipt.status === "running"
            ? "accent"
            : "success";

    const header = `${theme.fg(tone, glyph)} ${theme.bold(receipt.title)}: ${receipt.summary}`;
    lines.push(crop(header, width));

    if (receipt.findings && receipt.findings.length > 0) {
      for (const finding of receipt.findings.slice(0, 2)) {
        const sevTone =
          finding.severity === "HIGH"
            ? "error"
            : finding.severity === "MEDIUM"
              ? "warning"
              : "muted";
        const sev = finding.severity ? `[${finding.severity}] ` : "";
        lines.push(
          crop(`  ${theme.fg(sevTone, sev)}${finding.message}`, width),
        );
      }
    }
  }

  return lines;
}
