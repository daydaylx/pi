/**
 * Custom-Entry-Renderer für "diff-view".
 * Rendert Diff-Einträge inline in der Konversation.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { keyHint } from "@earendil-works/pi-coding-agent";
import type { DiffViewEntryData } from "./types.ts";
import { renderCompact, renderFull } from "./diff-renderer.ts";

/**
 * Diff-Entry-Komponente: Rendert einen Diff inline in der Konversation.
 * Unterstützt Compact- und Expanded-Modi (gesteuert durch `expanded`-Prop).
 */
export class DiffEntryComponent implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly theme: Theme,
    private readonly data: DiffViewEntryData,
    private readonly expanded: boolean,
  ) {}

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    if (this.expanded) {
      lines.push(...renderFull(
        { stats: this.data.stats, hunks: this.data.hunks, timestamp: this.data.timestamp },
        th,
        width,
      ));
    } else {
      lines.push(
        ...renderCompact(
          { stats: this.data.stats, hunks: this.data.hunks, timestamp: this.data.timestamp },
          th,
          width,
        ),
      );

      // Key-Hint zum Erweitern
      const totalLines = this.countTotalLines();
      if (totalLines > 6) {
        lines.push(
          th.fg("dim", `  ${keyHint("app.tools.expand", "zum Erweitern")} – ${totalLines} Zeilen gesamt`),
        );
      }
    }

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private countTotalLines(): number {
    let count = 0;
    for (const hunk of this.data.hunks) {
      count++; // Hunk-Header
      count += hunk.lines.length;
    }
    return count;
  }
}
