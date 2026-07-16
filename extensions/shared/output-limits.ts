import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES };

export interface OutputTruncationDetails {
  truncated: true;
  strategy: "balanced-head-tail";
  truncatedBy: "lines" | "bytes";
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
}

export interface LimitedTextOutput {
  text: string;
  truncation?: OutputTruncationDetails;
}

function utf8Prefix(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = Math.min(maxBytes, buffer.length);
  // If the byte immediately after the slice boundary is a continuation byte,
  // move back to the start of that incomplete code point.
  while (end > 0 && end < buffer.length && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.length;
}

/**
 * Limits model-facing text while retaining both the beginning (context) and
 * the end (usually errors or summaries). Pi's own truncators provide the
 * byte-safe head/tail slices; this helper reserves space for a visible marker.
 */
export function limitTextOutput(
  text: string,
  options: { maxBytes?: number; maxLines?: number } = {},
): LimitedTextOutput {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const probe = truncateHead(text, { maxBytes, maxLines });
  if (!probe.truncated) return { text };

  const marker = `\n\n[Ausgabe gekürzt: ${probe.totalLines} Zeilen/${probe.totalBytes} Bytes; Anfang und Ende erhalten.]\n\n`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  // The marker contains four newlines between the retained head and tail.
  const markerLines = 4;
  const availableBytes = Math.max(1, maxBytes - markerBytes);
  const availableLines = Math.max(2, maxLines - markerLines);
  const headBytes = Math.max(1, Math.floor(availableBytes / 2));
  const tailBytes = Math.max(1, availableBytes - headBytes);
  const headLines = Math.max(1, Math.floor(availableLines / 2));
  const tailLines = Math.max(1, availableLines - headLines);

  const head = truncateHead(text, {
    maxBytes: headBytes,
    maxLines: headLines,
  });
  const tail = truncateTail(text, {
    maxBytes: tailBytes,
    maxLines: tailLines,
  });
  // Pi's head truncator intentionally refuses to return a partial first line.
  // For a single very long line that would lose all leading context, so take
  // a UTF-8-safe byte prefix while retaining Pi's safe partial tail.
  const headContent = head.firstLineExceedsLimit
    ? utf8Prefix(text, headBytes)
    : head.content;
  const limited = `${headContent}${marker}${tail.content}`;

  return {
    text: limited,
    truncation: {
      truncated: true,
      strategy: "balanced-head-tail",
      truncatedBy: probe.truncatedBy ?? "bytes",
      totalLines: probe.totalLines,
      totalBytes: probe.totalBytes,
      outputLines: countLines(limited),
      outputBytes: Buffer.byteLength(limited, "utf8"),
      maxLines,
      maxBytes,
    },
  };
}
