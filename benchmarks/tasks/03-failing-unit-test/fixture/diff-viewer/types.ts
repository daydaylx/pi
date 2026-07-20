/** Ein einzelnes Zeichen-Level-Diff-Segment innerhalb einer geänderten Zeile. */
export interface InlineSegment {
  type: "equal" | "added" | "removed";
  text: string;
}

/** Eine Zeile innerhalb eines Hunks. */
export interface DiffLine {
  kind: "context" | "added" | "removed";
  /** Original-Zeilennummer (für removed/context), undefined für added. */
  oldLine?: number;
  /** Neue Zeilennummer (für added/context), undefined für removed. */
  newLine?: number;
  /** Rohtext ohne Prefix (+, -, Leerzeichen). */
  text: string;
  /** Zeichen-Level-Highlights für diese Zeile (nur bei kind=added/removed). */
  highlights?: InlineSegment[];
}

/** Ein Diff-Hunk (zusammenhängender Änderungsblock). */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Optionaler Kontext-Header aus dem Unified-Diff-Format. */
  heading?: string;
  lines: DiffLine[];
}

/** Statistiken für eine Dateiänderung. */
export interface DiffStats {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  hunks: number;
}

/** Vollständige Diff-Daten für eine Datei. */
export interface FileDiff {
  stats: DiffStats;
  hunks: DiffHunk[];
  /** Zeitstempel der Änderung. */
  timestamp: number;
  /** Git-Diff-Ausgabe im Rohformat (für erweiterte Nutzung). */
  raw?: string;
}

/** Gespeicherter Änderungsdatensatz für den Session-Tracker. */
export interface SessionChange {
  path: string;
  toolName: string;
  timestamp: number;
  stats: DiffStats;
  hunks: DiffHunk[];
}

/** Payload-Typ für den customEntry "diff-view". */
export interface DiffViewEntryData {
  path: string;
  stats: DiffStats;
  hunks: DiffHunk[];
  toolName: string;
  timestamp: number;
}
