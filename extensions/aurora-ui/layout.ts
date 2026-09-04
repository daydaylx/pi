import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Aurora's width-safe truncation, accounting for ANSI escapes and wide glyphs.
 *
 * The size classes this file used to define moved to `shared/layout.ts`, where
 * the menu shell reaches them too. Only the truncation stayed behind: it is the
 * one piece that needs `pi-tui` at module scope, and `shared/layout.ts` has to
 * remain import-free so the menu modules can use it under the jiti test loader.
 *
 * `truncateToWidth` wraps its injected ellipsis in full resets
 * (`\x1b[0m…\x1b[0m`) and may preserve the original closing codes after it.
 * That punches an unfilled hole into a tile row and can leave the preceding
 * `\x1b[38;...m` or `\x1b[1m` unclosed; the unclosed codes then bleed into the
 * next segment, frame, or neighbouring tile. This wrapper removes the reset
 * artifacts, keeps any suffix that still fits, and re-balances the visible
 * prefix by appending only the closes that are actually missing
 * (`\x1b[39m` for foreground, `\x1b[22m` for bold).
 */

interface StyleBalance {
  fgOpens: number;
  fgCloses: number;
  boldOpens: number;
  boldCloses: number;
}

/**
 * Counts the foreground and bold codes a string leaves open.
 *
 * Pi's theme picks its escape form from the detected colour depth, so the same
 * `theme.fg(...)` call emits `\x1b[38;2;r;g;bm` on a truecolor terminal,
 * `\x1b[38;5;Nm` on a 256-colour one and a plain `\x1b[3Xm` below that. Counting
 * only the truecolor form left the 256-colour case unbalanced, which is exactly
 * the leak `crop` exists to prevent. Parsing SGR parameters instead of matching
 * one spelling also keeps `\x1b[48;5;31m` (a *background*) from being misread as
 * an open foreground, because the extended-colour arguments are skipped.
 */
function styleBalance(value: string): StyleBalance {
  const balance: StyleBalance = {
    fgOpens: 0,
    fgCloses: 0,
    boldOpens: 0,
    boldCloses: 0,
  };
  for (const match of value.matchAll(/\x1b\[([0-9;]*)m/g)) {
    // `\x1b[m` is the parameterless spelling of a full reset.
    const params = match[1].length > 0 ? match[1].split(";") : ["0"];
    for (let index = 0; index < params.length; index += 1) {
      const code = Number(params[index]);
      // 38/48/58 select an extended foreground/background/underline colour and
      // carry their own arguments: `5;N` (256 colour) or `2;R;G;B` (truecolor).
      if (code === 38 || code === 48 || code === 58) {
        const form = params[index + 1];
        index += form === "5" ? 2 : form === "2" ? 4 : 1;
        if (code === 38) balance.fgOpens += 1;
        continue;
      }
      if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
        balance.fgOpens += 1;
      else if (code === 39) balance.fgCloses += 1;
      else if (code === 1) balance.boldOpens += 1;
      else if (code === 22) balance.boldCloses += 1;
      else if (code === 0) {
        balance.fgCloses = balance.fgOpens;
        balance.boldCloses = balance.boldOpens;
      }
    }
  }
  return balance;
}

export function crop(value: string, width: number): string {
  const clipped = truncateToWidth(value, Math.max(1, width), "…");
  // If nothing was truncated, leave the caller's string exactly as is.
  if (clipped === value) return clipped;
  const ellipsisIndex = clipped.lastIndexOf("…");
  if (ellipsisIndex < 0) return clipped;
  // Strip the reset that truncateToWidth placed immediately before the
  // ellipsis and any codes it preserved/added after the ellipsis. The suffix
  // (e.g. a status/runtime marker) starts at the first non-ANSI char after
  // the trailing reset run.
  const beforeReset = clipped
    .slice(0, ellipsisIndex)
    .replace(/(?:\x1b\[[0-9;]*[A-Za-z])+$/, "");
  const afterEllipsis = clipped
    .slice(ellipsisIndex + 1)
    .replace(/^(?:\x1b\[[0-9;]*[A-Za-z])+/, "");
  const prefix = `${beforeReset}…`;
  const { fgOpens, fgCloses, boldOpens, boldCloses } = styleBalance(prefix);
  const closes: string[] = [];
  if (boldOpens > boldCloses) closes.push("\x1b[22m");
  if (fgOpens > fgCloses) closes.push("\x1b[39m");
  return `${prefix}${closes.join("")}${afterEllipsis}`;
}
