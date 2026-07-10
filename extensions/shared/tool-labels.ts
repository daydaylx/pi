/**
 * Geteilte Kurzbeschreibungen für Tool-Aufrufe.
 *
 * Wird sowohl von tool-visuals.ts (kompakte Inline-Zeile im Hauptbereich)
 * als auch von activity-panel.ts (rechtes Activity Panel) genutzt, damit
 * beide Anzeigen exakt denselben Text zeigen.
 */

const MAX_PREVIEW_CHARS = 400;

export function shortPreview(value: unknown, max = MAX_PREVIEW_CHARS): string {
  const oneLine = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function argString(args: unknown, key: string, fallback = "-"): string {
  if (!args || typeof args !== "object") return fallback;
  const value = (args as Record<string, unknown>)[key];
  return value === undefined || value === null ? fallback : String(value);
}

export function argNumber(args: unknown, key: string): number | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

/** Kurzer, einzeiliger Titel für einen Tool-Aufruf (ohne Statuspräfix). */
export function toolCallLabel(
  toolName: string,
  args: unknown,
  maxCommandChars = 60,
): string {
  switch (toolName) {
    case "bash":
      return `$ ${shortPreview(argString(args, "command", ""), maxCommandChars)}`;
    case "read":
      return `read ${argString(args, "path")}`;
    case "write":
      return `write ${argString(args, "path")}`;
    case "edit":
      return `edit ${argString(args, "path")}`;
    case "grep":
      return `grep ${argString(args, "pattern")}`;
    case "find":
      return `find ${argString(args, "pattern")}`;
    case "ls":
      return `ls ${argString(args, "path", ".")}`;
    default:
      return toolName;
  }
}
