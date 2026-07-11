/**
 * InfoBox – zentraler Render-Kern für strukturierte Anzeigeboxen.
 *
 * Bietet einheitliche Rahmen, Titel, Sections, Statuszeilen und optionalen
 * Hintergrund. Unterstützt Unicode-/ASCII-Fallback über `render-profile.ts`
 * und kann kollabierbar sein (Enter/Space/E zum Auf-/Zuklappen).
 * `createInfoBoxComponent()` bindet zusätzlich ein Theme und liefert das
 * eigentliche Pi-TUI-Component-Objekt (`render(width)`, `invalidate()`).
 *
 * Der statische Import von `@earendil-works/pi-tui` wird bewusst vermieden,
 * damit diese Datei auch in der `tests/run.mjs`-jiti-Harness ladbar bleibt.
 * TUI-Helfer (`visibleWidth`, `truncateToWidth`, `matchesKey`) werden
 * optional übergeben oder durch interne Fallbacks ersetzt.
 */

import {
  glyphsFor,
  resolveRenderProfile,
  truncatePlain,
  type RenderGlyphs,
  type RenderProfile,
} from "./render-profile.ts";

export type InfoBoxTone =
  "neutral" | "accent" | "success" | "warning" | "error" | "muted";

export type InfoBoxBackground =
  | "customMessageBg"
  | "toolPendingBg"
  | "toolSuccessBg"
  | "toolErrorBg"
  | "userMessageBg";

export interface InfoBoxSection {
  title?: string;
  lines: string[];
}

export interface InfoBoxStatus {
  symbol: string;
  label: string;
}

export interface InfoBoxTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
}

export interface InfoBoxTuiHelpers {
  visibleWidth(value: string): number;
  truncateToWidth(value: string, width: number, ellipsis?: string): string;
  wrapTextWithAnsi(value: string, width: number): string[];
  matchesKey(data: string, key: unknown): boolean;
  Key: Record<string, unknown>;
}

export interface InfoBoxOptions {
  title: string;
  subtitle?: string;
  status?: InfoBoxStatus;
  sections?: InfoBoxSection[];
  tone?: InfoBoxTone;
  background?: InfoBoxBackground;
  collapsible?: boolean;
  expanded?: boolean;
  maxPreviewLines?: number;
  tuiHelpers?: InfoBoxTuiHelpers;
  profile?: RenderProfile;
}

const DEFAULT_MAX_PREVIEW_LINES = 6;
const EXPAND_HINT = "Enter/Leertaste/E aufklappen";
const COLLAPSE_HINT = "Enter/Leertaste/E einklappen";

function toneColor(tone: InfoBoxTone): string {
  switch (tone) {
    case "accent":
      return "accent";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "muted":
      return "muted";
    case "neutral":
    default:
      return "border";
  }
}

function visibleWidthFallback(value: string): number {
  // Strips ANSI escape sequences and counts display width.
  const stripped = value.replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0) ?? 0;
    width += code >= 0x1100 && isWideChar(code) ? 2 : 1;
  }
  return width;
}

function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2329 && code <= 0x232a) || // Angle brackets
    (code >= 0x2e80 && code <= 0x303e) || // CJK ...
    (code >= 0x3040 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Symbols
    (code >= 0x20000 && code <= 0x2fffd) || // CJK Extension B
    (code >= 0x30000 && code <= 0x3fffd)
  );
}

function truncateToWidthFallback(
  value: string,
  width: number,
  ellipsis = "…",
): string {
  if (width <= 0) return "";
  const stripped = value.replace(/\x1b\[[0-9;]*m/g, "");
  if (visibleWidthFallback(stripped) <= width) return value;
  if (width <= ellipsis.length) return ellipsis.slice(0, width);
  let result = "";
  let w = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0) ?? 0;
    const charWidth = code >= 0x1100 && isWideChar(code) ? 2 : 1;
    if (w + charWidth > width - ellipsis.length) break;
    result += char;
    w += charWidth;
  }
  return result + ellipsis;
}

function wrapTextFallback(value: string, width: number): string[] {
  if (width <= 0) return [];
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const sep = current ? " " : "";
    const next = current + sep + word;
    if (visibleWidthFallback(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current =
      visibleWidthFallback(word) > width
        ? truncateToWidthFallback(word, width, "")
        : word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export class InfoBox {
  private title: string;
  private subtitle?: string;
  private status?: InfoBoxStatus;
  private sections: InfoBoxSection[];
  private tone: InfoBoxTone;
  private background?: InfoBoxBackground;
  private collapsible: boolean;
  private expanded: boolean;
  private maxPreviewLines: number;
  private helpers: InfoBoxTuiHelpers;
  private profile: RenderProfile;
  private glyphs: RenderGlyphs;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(options: InfoBoxOptions) {
    this.title = options.title;
    this.subtitle = options.subtitle;
    this.status = options.status;
    this.sections = options.sections ?? [];
    this.tone = options.tone ?? "neutral";
    this.background = options.background;
    this.collapsible = options.collapsible ?? false;
    this.expanded = options.expanded ?? true;
    this.maxPreviewLines = options.maxPreviewLines ?? DEFAULT_MAX_PREVIEW_LINES;
    this.profile = options.profile ?? resolveRenderProfile({});
    this.glyphs = glyphsFor(this.profile);
    this.helpers = options.tuiHelpers ?? {
      visibleWidth: visibleWidthFallback,
      truncateToWidth: truncateToWidthFallback,
      wrapTextWithAnsi: wrapTextFallback,
      matchesKey: () => false,
      Key: {},
    };
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.invalidate();
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  setSections(sections: InfoBoxSection[]): void {
    this.sections = sections;
    this.invalidate();
  }

  handleInput(data: string): void {
    if (!this.collapsible) return;
    const { matchesKey, Key } = this.helpers;
    if (
      data === "e" ||
      data === "E" ||
      (Key.enter && matchesKey(data, Key.enter)) ||
      (Key.space && matchesKey(data, Key.space))
    ) {
      this.setExpanded(!this.expanded);
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number, theme: InfoBoxTheme): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const minWidth = 8;
    if (width < minWidth) {
      this.cachedWidth = width;
      this.cachedLines = [
        truncatePlain(this.title, width, this.glyphs.ellipsis),
      ];
      return this.cachedLines;
    }

    const innerWidth = Math.max(1, width - 4); // 2 borders + 2 padding
    const lines = this.buildLines(innerWidth, theme);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private buildLines(innerWidth: number, theme: InfoBoxTheme): string[] {
    const borderColor = toneColor(this.tone);
    const bg = this.background;
    const { glyphs } = this;

    const lines: string[] = [];

    // Top border with title
    const titleText = this.formatTitle(innerWidth, theme);
    lines.push(this.frameTop(titleText, innerWidth + 4, theme, borderColor));

    // Subtitle
    if (this.subtitle) {
      lines.push(
        this.contentRow(this.subtitle, innerWidth, theme, "muted", bg),
      );
    }

    // Divider after header
    lines.push(this.dividerRow(innerWidth, theme, borderColor));

    if (!this.expanded && this.collapsible) {
      const hint = this.status
        ? `${this.status.symbol} ${this.status.label} · ${EXPAND_HINT}`
        : EXPAND_HINT;
      lines.push(this.contentRow(hint, innerWidth, theme, "dim", bg));
      lines.push(this.frameBottom(innerWidth, theme, borderColor));
      return lines;
    }

    // Sections
    let lineCount = 0;
    let remainingHintShown = false;
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i];
      if (i > 0) {
        lines.push(this.dividerRow(innerWidth, theme, borderColor));
      }
      if (section.title) {
        lines.push(
          this.contentRow(
            theme.bold(section.title),
            innerWidth,
            theme,
            "accent",
            bg,
          ),
        );
      }
      for (let j = 0; j < section.lines.length; j++) {
        const wrapped = this.wrapLine(section.lines[j], innerWidth);
        for (let k = 0; k < wrapped.length; k++) {
          if (
            this.collapsible &&
            lineCount >= this.maxPreviewLines &&
            !remainingHintShown
          ) {
            const remaining = this.countRemainingLines(i, j, k, innerWidth);
            if (remaining > 0) {
              lines.push(
                this.contentRow(
                  `${this.glyphs.ellipsis} ${remaining} weitere ${remaining === 1 ? "Zeile" : "Zeilen"} · ${COLLAPSE_HINT}`,
                  innerWidth,
                  theme,
                  "dim",
                  bg,
                ),
              );
            }
            remainingHintShown = true;
          }
          if (!remainingHintShown) {
            lines.push(
              this.contentRow(wrapped[k], innerWidth, theme, undefined, bg),
            );
            lineCount++;
          }
        }
      }
    }

    // Collapse hint for expanded collapsible boxes
    if (this.collapsible && this.expanded && !remainingHintShown) {
      lines.push(this.contentRow(COLLAPSE_HINT, innerWidth, theme, "dim", bg));
    }

    lines.push(this.frameBottom(innerWidth, theme, borderColor));
    return lines;
  }

  private formatTitle(innerWidth: number, theme: InfoBoxTheme): string {
    const statusSuffix = this.status
      ? ` ${this.status.symbol} ${this.status.label}`
      : "";
    const full = theme.bold(this.title) + statusSuffix;
    return this.helpers.truncateToWidth(full, innerWidth, this.glyphs.ellipsis);
  }

  private frameTop(
    title: string,
    totalWidth: number,
    theme: InfoBoxTheme,
    borderColor: string,
  ): string {
    const { glyphs } = this;
    const titlePlain = ` ${title} `;
    const titleWidth = this.helpers.visibleWidth(titlePlain);
    const fillWidth = Math.max(0, totalWidth - 2 - titleWidth);
    const before = Math.min(2, fillWidth);
    const after = fillWidth - before;
    const border = `${glyphs.box.tl}${glyphs.box.h.repeat(before)}${titlePlain}${glyphs.box.h.repeat(after)}${glyphs.box.tr}`;
    return theme.fg(borderColor, border);
  }

  private frameBottom(
    innerWidth: number,
    theme: InfoBoxTheme,
    borderColor: string,
  ): string {
    const { glyphs } = this;
    const border = `${glyphs.box.bl}${glyphs.box.h.repeat(innerWidth + 2)}${glyphs.box.br}`;
    return theme.fg(borderColor, border);
  }

  private dividerRow(
    innerWidth: number,
    theme: InfoBoxTheme,
    borderColor: string,
  ): string {
    const { glyphs } = this;
    const border = `${glyphs.box.dividerLeft}${glyphs.box.h.repeat(innerWidth + 2)}${glyphs.box.dividerRight}`;
    return theme.fg(borderColor, border);
  }

  private contentRow(
    content: string,
    innerWidth: number,
    theme: InfoBoxTheme,
    color?: string,
    background?: InfoBoxBackground,
  ): string {
    const { glyphs } = this;
    const fitted = this.helpers.truncateToWidth(
      content,
      innerWidth,
      this.glyphs.ellipsis,
    );
    const padded = this.padContent(fitted, innerWidth);
    const colored = color ? theme.fg(color, padded) : padded;
    const bgColored = background ? theme.bg(background, colored) : colored;
    const left = theme.fg(toneColor(this.tone), glyphs.box.v);
    const right = theme.fg(toneColor(this.tone), glyphs.box.v);
    return `${left} ${bgColored} ${right}`;
  }

  private padContent(content: string, innerWidth: number): string {
    const textWidth = this.helpers.visibleWidth(content);
    const padding = Math.max(0, innerWidth - textWidth);
    return `${content}${" ".repeat(padding)}`;
  }

  private wrapLine(line: string, innerWidth: number): string[] {
    return this.helpers.wrapTextWithAnsi(line, innerWidth);
  }

  private countRemainingLines(
    fromSection: number,
    fromLine: number,
    fromWrapped: number,
    innerWidth: number,
  ): number {
    let count = 0;
    for (let i = fromSection; i < this.sections.length; i++) {
      const section = this.sections[i];
      for (
        let j = i === fromSection ? fromLine : 0;
        j < section.lines.length;
        j++
      ) {
        const wrapped = this.wrapLine(section.lines[j], innerWidth);
        const startK = i === fromSection && j === fromLine ? fromWrapped : 0;
        count += Math.max(0, wrapped.length - startK);
      }
    }
    return Math.max(0, count);
  }
}

export function createInfoBox(options: InfoBoxOptions): InfoBox {
  return new InfoBox(options);
}

/**
 * Rendert eine InfoBox in einen mehrzeiligen String, der z. B. an
 * `ctx.ui.notify()` übergeben werden kann. In non-TUI-Kontexten oder wenn
 * keine Theme-Funktionen verfügbar sind, kann der Aufrufer stattdessen den
 * `plainText`-Fallback nutzen.
 */
export function renderInfoBoxString(
  options: InfoBoxOptions,
  width: number,
  theme: InfoBoxTheme,
): string {
  const box = new InfoBox(options);
  return box.render(width, theme).join("\n");
}

/**
 * TUI-Component-Wrapper für InfoBox. Das zurückgegebene Objekt implementiert
 * das `Component`-Interface (`render(width)`, `invalidate()`, optionales
 * `handleInput()`), indem es das übergebene Theme intern hält. Wird für
 * `renderCall`/`renderResult`, Widgets und Overlays benötigt.
 */
export interface InfoBoxComponent {
  render(width: number): string[];
  invalidate(): void;
  setSections?(sections: InfoBoxSection[]): void;
  handleInput?(data: string): void;
  /** Current expand/collapse state (only meaningful when `collapsible` was set). */
  isExpanded?(): boolean;
}

export function createInfoBoxComponent(
  options: InfoBoxOptions,
  theme: InfoBoxTheme,
): InfoBoxComponent {
  const box = new InfoBox(options);
  return {
    render(width: number): string[] {
      return box.render(width, theme);
    },
    invalidate(): void {
      box.invalidate();
    },
    setSections(sections: InfoBoxSection[]): void {
      box.setSections(sections);
    },
    handleInput: box.handleInput.bind(box),
    isExpanded(): boolean {
      return box.isExpanded();
    },
  };
}
