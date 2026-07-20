/**
 * Diff-Browser-Overlay: Vollbild-Ansicht aller Session-Änderungen.
 * Registriert als `/changes`-Command.
 */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  truncateToWidth,
  visibleWidth,
  matchesKey,
  Key,
} from "@earendil-works/pi-tui";
import type { FileDiff, SessionChange } from "./types.ts";
import { renderFull } from "./diff-renderer.ts";

/** Ansichtsmodus im Diff-Browser. */
type ViewMode = "file-list" | "diff-view";

/**
 * Diff-Browser-Komponente: zeigt alle Session-Änderungen in einem Overlay.
 *
 * Tastatursteuerung:
 * - ↑↓: Datei in der Liste auswählen
 * - → / Enter: Diff der ausgewählten Datei anzeigen
 * - ← / Escape: Zurück zur Dateiliste
 * - j/k: Scrollen im Diff
 * - q / Ctrl+C: Browser schließen
 */
export class DiffBrowserComponent implements Component {
  // State
  private mode: ViewMode = "file-list";
  private selectedFile = 0;
  private listScrollOffset = 0;
  private scrollOffset = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Callbacks
  public onClose?: () => void;

  constructor(
    private readonly files: SessionChange[],
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly getDiffForFile: (path: string) => FileDiff | null,
    private readonly maxHeight = 40,
    private readonly requestRender: () => void = () => {},
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c")) || data === "q") {
      this.onClose?.();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.mode === "diff-view") {
        this.mode = "file-list";
        this.scrollOffset = 0;
        this.invalidate();
        this.requestRender();
      } else {
        this.onClose?.();
      }
      return;
    }

    if (this.mode === "file-list") this.handleFileListInput(data);
    else this.handleDiffViewInput(data);
    this.requestRender();
  }

  private handleFileListInput(data: string): void {
    if (matchesKey(data, Key.up) || data === "k") {
      if (this.selectedFile > 0) {
        this.selectedFile--;
        this.invalidate();
      }
    } else if (matchesKey(data, Key.down) || data === "j") {
      if (this.selectedFile < this.files.length - 1) {
        this.selectedFile++;
        this.invalidate();
      }
    } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
      if (this.files.length > 0) {
        this.mode = "diff-view";
        this.scrollOffset = 0;
        this.invalidate();
      }
    }
  }

  private handleDiffViewInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.mode = "file-list";
      this.scrollOffset = 0;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      if (this.scrollOffset > 0) {
        this.scrollOffset--;
        this.invalidate();
      }
    } else if (matchesKey(data, Key.down) || data === "j") {
      this.scrollOffset++;
      this.invalidate();
    }
  }

  render(width: number): string[] {
    if (this.files.length === 0) {
      return this.renderEmpty(width);
    }

    const availableHeight = Math.max(8, this.maxHeight - 6);

    if (this.mode === "file-list") {
      return this.renderFileList(width, availableHeight);
    } else {
      return this.renderDiff(width, availableHeight);
    }
  }

  private renderEmpty(width: number): string[] {
    const lines: string[] = [];
    const th = this.theme;
    lines.push(renderBorder(th, " DIFF BROWSER ", width, "top"));
    lines.push("");
    lines.push(truncate(th.fg("muted", "  Keine Änderungen in dieser Session."), width));
    lines.push(truncate(th.fg("dim", "  Führe eine edit- oder write-Operation aus, um Diffs zu sehen."), width));
    lines.push("");
    lines.push(renderBorder(th, "", width, "bottom"));
    lines.push(truncate(th.fg("dim", "  Escape · Schließen"), width));
    return lines;
  }

  private renderFileList(width: number, availableHeight: number): string[] {
    const lines: string[] = [];
    const th = this.theme;

    // Header
    lines.push(renderBorder(th, ` DIFF BROWSER · ${this.files.length} Dateien `, width, "top"));
    lines.push(truncate(th.fg("dim", `  Datei                                  +/−  Hunks`), width));
    lines.push(truncate(th.fg("borderMuted", "  " + "─".repeat(Math.max(0, width - 4))), width));

    // Dateiliste mit Scroll-Offset, damit die Auswahl stets sichtbar bleibt.
    const listHeight = Math.max(1, availableHeight - 5);
    if (this.selectedFile < this.listScrollOffset) this.listScrollOffset = this.selectedFile;
    if (this.selectedFile >= this.listScrollOffset + listHeight) {
      this.listScrollOffset = this.selectedFile - listHeight + 1;
    }
    const end = Math.min(this.files.length, this.listScrollOffset + listHeight);

    for (let i = this.listScrollOffset; i < end; i++) {
      const change = this.files[i]!;
      const isSelected = i === this.selectedFile;
      const prefix = isSelected ? th.fg("accent", "▶ ") : "  ";
      const pathDisplay = truncate(change.stats.path, width - 22);
      const pathStyled = isSelected
        ? th.fg("accent", th.bold(pathDisplay))
        : th.fg("text", pathDisplay);

      let statsLine = prefix + pathStyled;

      // Stats rechtsbündig
      const added = th.fg("toolDiffAdded", `+${change.stats.linesAdded}`);
      const removed = th.fg("toolDiffRemoved", `−${change.stats.linesRemoved}`);
      const hunks = th.fg("dim", `${change.stats.hunks}h`);
      const right = `${added} ${removed}  ${hunks}`;

      const padding = Math.max(1, width - visibleWidth(prefix) - visibleWidth(pathDisplay) - visibleWidth(right) - 2);
      statsLine += " ".repeat(padding) + right;
      lines.push(truncate(statsLine, width));
    }

    if (this.files.length > listHeight) {
      lines.push(truncate(th.fg("dim", `  ${this.listScrollOffset + 1}-${end} von ${this.files.length}`), width));
    }

    // Footer
    lines.push(truncate(th.fg("borderMuted", "  " + "─".repeat(Math.max(0, width - 4))), width));
    lines.push(renderBorder(th, "", width, "bottom"));
    lines.push(truncate(
      th.fg("dim", "  ↑↓ Navigieren  ·  Enter / → Diff anzeigen  ·  Escape Schließen"),
      width,
    ));

    return lines;
  }

  private renderDiff(width: number, availableHeight: number): string[] {
    const lines: string[] = [];
    const th = this.theme;

    if (this.files.length === 0) return this.renderEmpty(width);

    const selected = this.files[this.selectedFile]!;
    const fileDiff = this.getDiffForFile(selected.path);

    if (!fileDiff) {
      lines.push(renderBorder(th, ` ${selected.path} `, width, "top"));
      lines.push(truncate(th.fg("warning", "  Diff nicht verfügbar – Datei konnte nicht gelesen werden."), width));
      lines.push(renderBorder(th, "", width, "bottom"));
      return lines;
    }

    const fullLines = renderFull(fileDiff, th, width - 2);
    const headerLine = ` DIFF: ${selected.path}  +${selected.stats.linesAdded} −${selected.stats.linesRemoved} `;

    lines.push(renderBorder(th, headerLine, width, "top"));

    // Scrollbarer Diff-Bereich
    const maxVisible = availableHeight - 3;
    const maxOffset = Math.max(0, fullLines.length - maxVisible);
    const clampedOffset = Math.min(this.scrollOffset, maxOffset);
    this.scrollOffset = clampedOffset;

    const visibleLines = fullLines.slice(clampedOffset, clampedOffset + maxVisible);

    for (const line of visibleLines) {
      lines.push(truncate(`  ${line}`, width));
    }

    // Scroll-Indikator
    if (fullLines.length > maxVisible) {
      const pos = `${clampedOffset + 1}-${Math.min(clampedOffset + maxVisible, fullLines.length)} von ${fullLines.length}`;
      lines.push(truncate(th.fg("dim", `  ${pos}  ↑↓ j/k scrollen`), width));
    }

    lines.push(renderBorder(th, "", width, "bottom"));
    lines.push(truncate(
      th.fg("dim", "  ← / Escape Zurück  ·  ↑↓ / j/k Scrollen  ·  q Schließen"),
      width,
    ));

    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

function renderBorder(
  theme: Theme,
  label: string,
  width: number,
  edge: "top" | "bottom",
): string {
  const color = theme.fg("borderAccent", "");
  if (width <= 2) return truncateToWidth(label, width);
  const left = edge === "top" ? "╭─" : "╰─";
  const right = edge === "top" ? "╮" : "╯";
  const inner = label ? ` ${label} ` : "";
  const fill = "─".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(inner) - visibleWidth(right)));
  return truncateToWidth(
    theme.fg("borderAccent", left) + theme.fg("accent", inner) + theme.fg("borderAccent", fill + right),
    width,
  );
}

function truncate(s: string, width: number): string {
  return truncateToWidth(s, Math.max(1, width), "…");
}
