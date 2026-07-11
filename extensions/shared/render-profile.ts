export type ColorLevel = 0 | 1 | 2 | 3;

export type RenderDensity = "compact" | "medium" | "detailed";

export interface RenderProfile {
  unicode: boolean;
  /** Backward-compatible shorthand for `colorLevel > 0`. */
  color: boolean;
  /** 0 = none, 1 = ANSI, 2 = 256 colors, 3 = true color. */
  colorLevel: ColorLevel;
  animations: boolean;
  compact: boolean;
  density: RenderDensity;
}

// Terminalbreite, ab der activity-panel.ts das rechte Activity Panel zeigt.
// Darunter fällt tool-visuals.ts auf kompakte Inline-Zeilen im Hauptbereich
// zurück. Ein einzelner geteilter Wert verhindert ein Auseinanderlaufen der
// beiden Schwellen.
export const ACTIVITY_PANEL_MIN_WIDTH = 120;

// Anteil + Mindestbreite + Rand, den activity-panel.ts für das rechte Panel
// reserviert (muss zu dessen overlayOptions passen). tool-visuals.ts nutzt
// denselben Wert, um volle Tool-Boxen (Fehler/expandiert) bei sichtbarem
// Panel schmaler zu rendern — sonst würde die Box unter das Panel-Overlay
// hineinragen und dessen Rahmen optisch durchschneiden (das Overlay
// komposittet Spalten in die bereits gerenderten Zeilen hinein, statt den
// Hauptbereich echt schmaler zu reflowen).
const ACTIVITY_PANEL_WIDTH_FRACTION = 0.34;
const ACTIVITY_PANEL_MIN_PANEL_WIDTH = 30;
const ACTIVITY_PANEL_MARGIN = 1;

/**
 * Effektive Breite für Hauptbereichs-Komponenten, wenn das Activity Panel
 * (falls sichtbar) rechts Platz beansprucht. Unterhalb von
 * ACTIVITY_PANEL_MIN_WIDTH ist das Panel unsichtbar; dort wird die volle
 * Breite zurückgegeben.
 */
export function widthReservedForActivityPanel(termWidth: number): number {
  if (termWidth < ACTIVITY_PANEL_MIN_WIDTH) return termWidth;
  const panelWidth = Math.max(
    ACTIVITY_PANEL_MIN_PANEL_WIDTH,
    Math.floor(termWidth * ACTIVITY_PANEL_WIDTH_FRACTION),
  );
  return Math.max(1, termWidth - panelWidth - ACTIVITY_PANEL_MARGIN * 2);
}

export type RenderStatus =
  | "idle"
  | "queued"
  | "waiting"
  | "running"
  | "thinking"
  | "completed"
  | "warning"
  | "failed"
  | "blocked";

export interface RenderGlyphs {
  status: Record<RenderStatus, string>;
  box: {
    h: string;
    v: string;
    tl: string;
    tr: string;
    bl: string;
    br: string;
    dividerLeft: string;
    dividerRight: string;
  };
  cursor: string;
  selected: string;
  unselected: string;
  ellipsis: string;
  edit: string;
}

const UTF8_RE = /utf-?8/i;
const TRUE_COLOR_RE = /(?:truecolor|24bit)/i;
const COLOR_256_RE = /(?:256color|256colour)/i;

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && !/^(?:0|false|no|off)$/i.test(value);
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  return isTruthy(env.CI) || isTruthy(env.CONTINUOUS_INTEGRATION);
}

function supportsColorInCi(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.GITHUB_ACTIONS ||
      env.GITLAB_CI ||
      env.BUILDKITE ||
      env.CIRCLECI ||
      env.TRAVIS ||
      env.TEAMCITY_VERSION,
  );
}

function resolveTty(
  env: NodeJS.ProcessEnv,
  isTTY: boolean | undefined,
): boolean | undefined {
  if (isTTY !== undefined) return isTTY;
  return env === process.env ? Boolean(process.stdout?.isTTY) : undefined;
}

function forcedColorLevel(env: NodeJS.ProcessEnv): ColorLevel | undefined {
  const raw = env.FORCE_COLOR ?? env.CLICOLOR_FORCE;
  if (raw === undefined) return undefined;
  if (raw === "" || /^(?:true|yes|on)$/i.test(raw)) return 1;
  if (/^(?:false|no|off)$/i.test(raw)) return 0;
  const numeric = Number.parseInt(raw, 10);
  if (Number.isNaN(numeric)) return 1;
  return Math.max(0, Math.min(3, numeric)) as ColorLevel;
}

export const UNICODE_GLYPHS: RenderGlyphs = {
  status: {
    idle: "○",
    queued: "○",
    waiting: "○",
    running: "●",
    thinking: "…",
    completed: "✓",
    warning: "!",
    failed: "✕",
    blocked: "⏸",
  },
  box: {
    h: "─",
    v: "│",
    tl: "╭",
    tr: "╮",
    bl: "╰",
    br: "╯",
    dividerLeft: "├",
    dividerRight: "┤",
  },
  cursor: "›",
  selected: "●",
  unselected: "○",
  ellipsis: "…",
  edit: "✎",
};

export const ASCII_GLYPHS: RenderGlyphs = {
  status: {
    idle: "o",
    queued: "o",
    waiting: "o",
    running: "*",
    thinking: "...",
    completed: "OK",
    warning: "!",
    failed: "X",
    blocked: "PAUSE",
  },
  box: {
    h: "-",
    v: "|",
    tl: "+",
    tr: "+",
    bl: "+",
    br: "+",
    dividerLeft: "+",
    dividerRight: "+",
  },
  cursor: ">",
  selected: "*",
  unselected: "o",
  ellipsis: "...",
  edit: "edit",
};

export function supportsUnicode(
  env: NodeJS.ProcessEnv = process.env,
  isTTY?: boolean,
): boolean {
  if (env.PI_ASCII_UI === "1") return false;
  if (env.TERM?.toLowerCase() === "dumb") return false;
  if (env.PI_UNICODE_UI === "1") return true;

  // Locale variables have precedence. LC_ALL=C must not be accidentally
  // overridden by a UTF-8 LANG value further down the chain.
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? env.LANGUAGE;
  if (locale) return UTF8_RE.test(locale);

  const tty = resolveTty(env, isTTY);
  if (tty === false) return false;
  if (process.platform === "win32") return true;

  // Modern terminal identifiers are a useful fallback when a minimal shell
  // omits locale variables. An arbitrary TERM alone only counts on a real TTY.
  if (
    env.WT_SESSION ||
    env.COLORTERM ||
    env.TERM_PROGRAM ||
    env.VTE_VERSION ||
    env.KITTY_WINDOW_ID ||
    env.WEZTERM_EXECUTABLE
  ) {
    return true;
  }
  return tty === true && Boolean(env.TERM);
}

export function detectColorLevel(
  env: NodeJS.ProcessEnv = process.env,
  isTTY?: boolean,
): ColorLevel {
  const forced = forcedColorLevel(env);
  if (forced !== undefined) return forced;
  if (env.NO_COLOR !== undefined || env.CLICOLOR === "0") return 0;
  if (env.TERM?.toLowerCase() === "dumb") return 0;

  const tty = resolveTty(env, isTTY);
  if (tty === false) return 0;
  if (isCiEnvironment(env) && !supportsColorInCi(env)) return 0;

  const terminalDescription = [env.COLORTERM, env.TERM]
    .filter(Boolean)
    .join(" ");
  if (
    TRUE_COLOR_RE.test(terminalDescription) ||
    env.WT_SESSION ||
    env.KITTY_WINDOW_ID ||
    env.WEZTERM_EXECUTABLE
  ) {
    return 3;
  }
  if (COLOR_256_RE.test(terminalDescription)) return 2;
  if (env.COLORTERM || env.TERM_PROGRAM || env.ANSICON) return 1;
  if (
    env.TERM &&
    /(?:ansi|color|xterm|screen|tmux|vt100|linux|cygwin)/i.test(env.TERM)
  ) {
    return 1;
  }
  if (env.CLICOLOR === "1" || tty === true) return 1;
  return 0;
}

export function supportsColor(
  env: NodeJS.ProcessEnv = process.env,
  isTTY?: boolean,
): boolean {
  return detectColorLevel(env, isTTY) > 0;
}

export function supportsAnimations(
  env: NodeJS.ProcessEnv = process.env,
  mode: string | undefined = "tui",
  isTTY?: boolean,
): boolean {
  if (mode !== "tui") return false;
  if (isCiEnvironment(env)) return false;
  if (env.TERM?.toLowerCase() === "dumb") return false;
  if (resolveTty(env, isTTY) === false) return false;
  if (env.PI_DISABLE_ANIMATIONS === "1" || env.PI_REDUCED_MOTION === "1")
    return false;
  return true;
}

export function renderDensity(width: number): RenderDensity {
  if (width < 60) return "compact";
  if (width < 90) return "medium";
  return "detailed";
}

export function resolveRenderProfile(
  options: {
    env?: NodeJS.ProcessEnv;
    width?: number;
    mode?: string;
    isTTY?: boolean;
  } = {},
): RenderProfile {
  const env = options.env ?? process.env;
  const density = renderDensity(options.width ?? 100);
  const colorLevel = detectColorLevel(env, options.isTTY);
  return {
    unicode: supportsUnicode(env, options.isTTY),
    color: colorLevel > 0,
    colorLevel,
    animations: supportsAnimations(env, options.mode, options.isTTY),
    compact: density === "compact",
    density,
  };
}

export function glyphsFor(
  profile: Pick<RenderProfile, "unicode">,
): RenderGlyphs {
  return profile.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

export function statusLabel(status: RenderStatus): string {
  switch (status) {
    case "idle":
      return "inaktiv";
    case "queued":
      return "eingereiht";
    case "waiting":
      return "wartend";
    case "running":
      return "aktiv";
    case "thinking":
      return "denkt";
    case "completed":
      return "erledigt";
    case "warning":
      return "Warnung";
    case "failed":
      return "fehlgeschlagen";
    case "blocked":
      return "blockiert";
  }
}

export function statusMark(
  status: RenderStatus,
  profile: Pick<RenderProfile, "unicode">,
): string {
  return glyphsFor(profile).status[status];
}

export function formatStatus(
  status: RenderStatus,
  profile: Pick<RenderProfile, "unicode">,
): string {
  return `${statusMark(status, profile)} ${statusLabel(status)}`;
}

export function truncatePlain(
  value: string,
  width: number,
  ellipsis = "…",
): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= ellipsis.length) return ellipsis.slice(0, width);
  return `${value.slice(0, width - ellipsis.length)}${ellipsis}`;
}

export function truncateMiddle(
  value: string,
  width: number,
  ellipsis = "…",
): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= ellipsis.length + 1)
    return truncatePlain(value, width, ellipsis);
  const available = width - ellipsis.length;
  const left = Math.ceil(available / 2);
  const right = Math.floor(available / 2);
  return `${value.slice(0, left)}${ellipsis}${value.slice(value.length - right)}`;
}

export function truncateModelName(
  model: string | undefined,
  width = 26,
): string {
  if (!model) return "no-model";
  const short = model.replace(/^([^/]+\/)/, "");
  return truncateMiddle(short, width);
}
