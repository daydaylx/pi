/**
 * Read-Tracker: erkennt exakte Wiederholungs-Reads unveränderter Dateien.
 *
 * Ein Read gilt als bereits im Kontext, wenn eine frühere, nicht gekürzte
 * Ausgabe denselben Zeilenbereich abdeckt und Datei (mtime/size) unverändert
 * ist. Nach Kompaktierung oder neuer Sitzung wird zurückgesetzt.
 */

export interface ReadRange {
  offset?: number;
  limit?: number;
}

export interface FileStamp {
  mtimeMs: number;
  size: number;
}

interface Entry extends ReadRange {
  stamp: FileStamp;
}

function start(range: ReadRange): number {
  return range.offset && range.offset > 0 ? range.offset : 1;
}

/** Letzte Zeile des Bereichs; `undefined` = bis Dateiende. */
function end(range: ReadRange): number | undefined {
  return range.limit && range.limit > 0
    ? start(range) + range.limit - 1
    : undefined;
}

export function covers(earlier: ReadRange, next: ReadRange): boolean {
  if (start(earlier) > start(next)) return false;
  const earlierEnd = end(earlier);
  if (earlierEnd === undefined) return true;
  const nextEnd = end(next);
  return nextEnd !== undefined && earlierEnd >= nextEnd;
}

export interface ReadTracker {
  /** True, wenn der Read nichts Neues liefern würde. */
  isRedundant(path: string, range: ReadRange, stamp: FileStamp): boolean;
  /** Erfolgreichen, nicht gekürzten Read festhalten. */
  record(
    path: string,
    range: ReadRange,
    stamp: FileStamp,
    truncated: boolean,
  ): void;
  invalidate(path: string): void;
  reset(): void;
}

export function createReadTracker(): ReadTracker {
  const entries = new Map<string, Entry[]>();
  return {
    isRedundant(path, range, stamp) {
      return (entries.get(path) ?? []).some(
        (entry) =>
          entry.stamp.mtimeMs === stamp.mtimeMs &&
          entry.stamp.size === stamp.size &&
          covers(entry, range),
      );
    },
    record(path, range, stamp, truncated) {
      // Ein gekürzter Read deckt seinen angeforderten Bereich nicht ab.
      if (truncated) return;
      const list = (entries.get(path) ?? []).filter(
        (entry) =>
          entry.stamp.mtimeMs === stamp.mtimeMs &&
          entry.stamp.size === stamp.size,
      );
      list.push({ ...range, stamp });
      entries.set(path, list);
    },
    invalidate(path) {
      entries.delete(path);
    },
    reset() {
      entries.clear();
    },
  };
}
