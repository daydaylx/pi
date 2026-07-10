/**
 * Reines Rendering für den PI-AGENT-Startbanner: Breiten-Tier-Auswahl,
 * 5x5-Blockglyphen und Türkis→Violett→Pink-Farbverlauf.
 *
 * Keine npm-Value-Imports (siehe Kommentar in menu-ui.ts) — diese Datei wird
 * direkt von tests/run.mjs per jiti geladen und ein statischer Value-Import
 * eines npm-Pakets würde dort an der kaputten /home/d/package.json scheitern.
 */

export type BannerColorMode = "truecolor" | "256color" | "none";
export type BannerTier = "full" | "compact" | "plain";
export type BannerWord = "PI AGENT" | "PI";

// Sichtbare Breite bei "full": 86 Zeichen (43 Glyphspalten × 2). Bei "compact"
// (nur "PI"): 22 Zeichen (11 Glyphspalten × 2). Schwellen mit Rand-Puffer.
const FULL_TIER_MIN_WIDTH = 90;
const COMPACT_TIER_MIN_WIDTH = 26;

export function resolveBannerTier(width: number): BannerTier {
  if (width >= FULL_TIER_MIN_WIDTH) return "full";
  if (width >= COMPACT_TIER_MIN_WIDTH) return "compact";
  return "plain";
}

/** NO_COLOR hat Vorrang vor der vom Theme erkannten Terminal-Farbfähigkeit. */
export function resolveBannerColorMode(
  themeColorMode: "truecolor" | "256color",
  env: Pick<NodeJS.ProcessEnv, "NO_COLOR"> = {
    NO_COLOR: process.env.NO_COLOR,
  },
): BannerColorMode {
  if (env.NO_COLOR !== undefined) return "none";
  return themeColorMode;
}

// 5x5-Blockglyphen; "1" = gefülltes Pixel, gerendert als "██".
const GLYPHS: Record<string, readonly string[]> = {
  P: ["1111 ", "1   1", "1111 ", "1    ", "1    "],
  I: ["11111", "  1  ", "  1  ", "  1  ", "11111"],
  A: [" 111 ", "1   1", "11111", "1   1", "1   1"],
  G: [" 1111", "1    ", "1  11", "1   1", " 1111"],
  E: ["11111", "1    ", "1111 ", "1    ", "11111"],
  N: ["1   1", "11  1", "1 1 1", "1  11", "1   1"],
  T: ["11111", "  1  ", "  1  ", "  1  ", "  1  "],
};
const GLYPH_ROWS = 5;
const GLYPH_COLS = 5;

type Token = { letter: string } | { gap: number };

function tokensFor(word: BannerWord): Token[] {
  if (word === "PI") {
    return [{ letter: "P" }, { gap: 1 }, { letter: "I" }];
  }
  return [
    { letter: "P" },
    { gap: 1 },
    { letter: "I" },
    { gap: 3 },
    { letter: "A" },
    { gap: 1 },
    { letter: "G" },
    { gap: 1 },
    { letter: "E" },
    { gap: 1 },
    { letter: "N" },
    { gap: 1 },
    { letter: "T" },
  ];
}

function totalColumns(tokens: Token[]): number {
  return tokens.reduce(
    (sum, token) => sum + ("letter" in token ? GLYPH_COLS : token.gap),
    0,
  );
}

// Farbverlauf Türkis → Violett → Pink, zweiteilig linear interpoliert.
const GRADIENT_STOPS: readonly (readonly [number, number, number])[] = [
  [34, 211, 238], // Türkis/Cyan
  [168, 85, 247], // Violett
  [236, 72, 153], // Pink
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function colorAt(t: number): readonly [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const segment = clamped < 0.5 ? 0 : 1;
  const localT = clamped < 0.5 ? clamped / 0.5 : (clamped - 0.5) / 0.5;
  const [r1, g1, b1] = GRADIENT_STOPS[segment];
  const [r2, g2, b2] = GRADIENT_STOPS[segment + 1];
  return [lerp(r1, r2, localT), lerp(g1, g2, localT), lerp(b1, b2, localT)];
}

/** Standard-Konvertierung RGB → 256-Farben-Palette (6x6x6-Würfel + Graustufen). */
function rgbTo256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const toIdx = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * toIdx(r) + 6 * toIdx(g) + toIdx(b);
}

// String.fromCharCode statt Literal, damit das ESC-Steuerzeichen (0x1B) nicht
// als unsichtbares Rohbyte im Quelltext landet.
const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;

function paint(
  text: string,
  rgb: readonly [number, number, number],
  colorMode: BannerColorMode,
): string {
  if (colorMode === "none") return text;
  const [r, g, b] = rgb;
  const code =
    colorMode === "truecolor"
      ? `${ESC}[38;2;${r};${g};${b}m`
      : `${ESC}[38;5;${rgbTo256(r, g, b)}m`;
  return `${code}${text}${RESET}`;
}

function buildGlyphLines(
  tokens: Token[],
  colorMode: BannerColorMode,
): string[] {
  const cols = totalColumns(tokens);
  const lines: string[] = [];
  for (let row = 0; row < GLYPH_ROWS; row++) {
    let line = "";
    let col = 0;
    for (const token of tokens) {
      if ("gap" in token) {
        line += "  ".repeat(token.gap);
        col += token.gap;
        continue;
      }
      const glyph = GLYPHS[token.letter];
      for (let c = 0; c < GLYPH_COLS; c++, col++) {
        const filled = glyph[row][c] === "1";
        const t = cols <= 1 ? 0 : col / (cols - 1);
        line += filled ? paint("██", colorAt(t), colorMode) : "  ";
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Großer Blockbanner ("PI AGENT" oder "PI"), 5 Zeilen hoch. */
export function buildBigBanner(
  word: BannerWord,
  colorMode: BannerColorMode,
): string[] {
  return buildGlyphLines(tokensFor(word), colorMode);
}

/** Einfache einzeilige Textzeile mit Farbverlauf für sehr schmale Terminals. */
export function buildPlainBannerLine(
  text: string,
  colorMode: BannerColorMode,
): string {
  const len = text.length;
  let out = "";
  for (let i = 0; i < len; i++) {
    const t = len <= 1 ? 0 : i / (len - 1);
    out += paint(text[i], colorAt(t), colorMode);
  }
  return out;
}
