import {
  CustomEditor,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

function rail(
  left: string,
  right: string,
  width: number,
  border: (value: string) => string,
): string {
  if (width <= 0) return "";
  if (width === 1) return border("─");

  const available = Math.max(0, width - 2);
  let start = left;
  let end = right;
  while (visibleWidth(start) + visibleWidth(end) > available) {
    if (visibleWidth(end) > 0)
      end = truncateToWidth(end, visibleWidth(end) - 1, "");
    else start = truncateToWidth(start, visibleWidth(start) - 1, "");
  }
  return `${border("─")}${start}${border("─".repeat(available - visibleWidth(start) - visibleWidth(end)))}${end}${border("─")}`;
}

/**
 * Keeps Pi's complete editor implementation and changes only its two rails.
 * Editing, completion, history and application shortcuts remain in CustomEditor.
 */
export class AuroraEditor extends CustomEditor {
  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly auroraTheme: Theme,
  ) {
    super(tui, editorTheme, keybindings, {
      paddingX: 1,
      autocompleteMaxVisible: 8,
    });
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;
    const label = this.focused
      ? this.auroraTheme.fg("accent", this.auroraTheme.bold(" EINGABE "))
      : this.auroraTheme.fg("borderMuted", " EINGABE ");
    const helper =
      width >= 52 ? this.auroraTheme.fg("muted", " Enter senden ") : "";
    lines[0] = rail(label, helper, width, (value) => this.borderColor(value));
    lines[lines.length - 1] = rail("", "", width, (value) =>
      this.borderColor(value),
    );
    return lines;
  }
}
