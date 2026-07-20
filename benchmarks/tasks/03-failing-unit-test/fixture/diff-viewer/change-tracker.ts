/**
 * Session-Change-Tracker: Verfolgt alle Dateiänderungen während einer Session.
 * Rekonstruiert State aus Session-Entries beim Branch-Wechsel.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DiffHunk, DiffStats, SessionChange } from "./types.ts";

export class ChangeTracker {
  private changes = new Map<string, SessionChange[]>();
  private _initialized = false;

  /** Alle geänderten Dateipfade mit letztem Change. */
  get changedFiles(): SessionChange[] {
    const result: SessionChange[] = [];
    for (const [, fileChanges] of this.changes) {
      if (fileChanges.length > 0) {
        result.push(fileChanges[fileChanges.length - 1]!);
      }
    }
    // Neueste zuerst
    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Gesamtanzahl Änderungen. */
  get totalChanges(): number {
    let count = 0;
    for (const changes of this.changes.values()) count += changes.length;
    return count;
  }

  /** Fügt eine Änderung hinzu. */
  recordChange(
    path: string,
    toolName: string,
    stats: DiffStats,
    hunks: DiffHunk[],
    timestamp = Date.now(),
  ): void {
    const entry: SessionChange = {
      path,
      toolName,
      timestamp,
      stats,
      hunks,
    };

    const existing = this.changes.get(path);
    if (existing) {
      existing.push(entry);
    } else {
      this.changes.set(path, [entry]);
    }
  }

  /** Gibt alle Änderungen für eine Datei zurück. */
  getChangesForFile(path: string): SessionChange[] {
    return this.changes.get(path) ?? [];
  }

  /** Setzt den Tracker zurück. */
  reset(): void {
    this.changes.clear();
    this._initialized = false;
  }

  /** Initialisiert den Tracker durch Rekonstruktion aus Session-Entries. */
  reconstructFromSession(ctx: ExtensionContext): void {
    this.reset();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") continue;
      if (entry.customType !== "diff-view") continue;

      const data = entry.data as {
        path: string;
        toolName?: string;
        stats?: DiffStats;
        hunks?: DiffHunk[];
        timestamp?: number;
      } | undefined;

      if (data?.path && data.stats && data.hunks) {
        this.recordChange(
          data.path,
          data.toolName ?? "unknown",
          data.stats,
          data.hunks,
          data.timestamp,
        );
      }
    }

    this._initialized = true;
  }

  get initialized(): boolean {
    return this._initialized;
  }
}
