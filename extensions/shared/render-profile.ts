export interface RenderProfile {
  unicode: boolean;
  color: boolean;
  animations: boolean;
  compact: boolean;
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

export function supportsUnicode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PI_ASCII_UI === "1") return false;
  if (env.TERM === "dumb") return false;
  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG, env.LANGUAGE]
    .filter(Boolean)
    .join(" ");
  return locale ? UTF8_RE.test(locale) : process.platform === "win32";
}

export function supportsColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_COLOR || env.CLICOLOR_FORCE === "1") return true;
  return true;
}

export function supportsAnimations(
  env: NodeJS.ProcessEnv = process.env,
  mode: string | undefined = "tui",
): boolean {
  if (mode !== "tui") return false;
  if (env.CI === "1" || env.CI === "true") return false;
  if (env.TERM === "dumb") return false;
  if (env.PI_DISABLE_ANIMATIONS === "1" || env.PI_REDUCED_MOTION === "1")
    return false;
  return true;
}

export function resolveRenderProfile(options: {
  env?: NodeJS.ProcessEnv;
  width?: number;
  mode?: string;
} = {}): RenderProfile {
  const env = options.env ?? process.env;
  return {
    unicode: supportsUnicode(env),
    color: supportsColor(env),
    animations: supportsAnimations(env, options.mode),
    compact: (options.width ?? 100) < 90,
  };
}

export function glyphsFor(profile: Pick<RenderProfile, "unicode">): RenderGlyphs {
  return profile.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

export function statusLabel(status: RenderStatus): string {
  switch (status) {
    case "idle":
      return "idle";
    case "queued":
      return "queued";
    case "waiting":
      return "waiting";
    case "running":
      return "running";
    case "thinking":
      return "thinking";
    case "completed":
      return "completed";
    case "warning":
      return "warning";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
  }
}

export function statusMark(status: RenderStatus, profile: Pick<RenderProfile, "unicode">): string {
  return glyphsFor(profile).status[status];
}

export function formatStatus(status: RenderStatus, profile: Pick<RenderProfile, "unicode">): string {
  return `${statusMark(status, profile)} ${statusLabel(status)}`;
}

export function truncatePlain(value: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= ellipsis.length) return ellipsis.slice(0, width);
  return `${value.slice(0, width - ellipsis.length)}${ellipsis}`;
}

export function truncateMiddle(value: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= ellipsis.length + 1) return truncatePlain(value, width, ellipsis);
  const available = width - ellipsis.length;
  const left = Math.ceil(available / 2);
  const right = Math.floor(available / 2);
  return `${value.slice(0, left)}${ellipsis}${value.slice(value.length - right)}`;
}

export function truncateModelName(model: string | undefined, width = 26): string {
  if (!model) return "no-model";
  const short = model.replace(/^([^/]+\/)/, "");
  return truncateMiddle(short, width);
}
