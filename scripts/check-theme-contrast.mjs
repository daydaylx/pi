#!/usr/bin/env node
/**
 * Dev tool: reports WCAG contrast ratios between every foreground colour in
 * an Aurora theme JSON and the card surfaces it actually appears on (`bg`,
 * `surface`, `highlight`), plus a hue-distance check between the warm brand
 * accents that a pure fg/bg contrast check cannot see (two colours can both
 * read fine against the background yet be hard to tell apart from each
 * other). Not wired into `npm run verify` — run it by hand when tuning a
 * theme's palette (see themes/aurora-night.json, themes/aurora-day.json).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "../tests/shared/harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Vars that only ever paint a background, never text/UI foreground. */
const BACKGROUND_VAR_NAMES = new Set([
  "bg",
  "bgDark",
  "surface",
  "highlight",
  "selection",
  "successBg",
  "errorBg",
]);

/** The card/panel surfaces foreground colours are actually read against. */
const SURFACE_BACKGROUNDS = ["bg", "surface", "highlight"];

const TEXT_THRESHOLD = 4.5;
const UI_THRESHOLD = 3.0;

/** Warm brand accents worth checking pairwise for hue proximity. */
const WARM_ACCENT_NAMES = [
  "copper",
  "amber",
  "terracotta",
  "burgundy",
  "ochre",
  "rosewood",
];
const HUE_DISTANCE_THRESHOLD = 15;
const SIMILARITY_THRESHOLD = 20; // saturation/lightness points

export function loadTheme(themePath) {
  return JSON.parse(readFileSync(themePath, "utf8"));
}

/** Every fg/bg pair worth checking, with its contrast ratio and verdicts. */
export function checkContrast(theme) {
  const fgNames = Object.keys(theme.vars).filter(
    (name) => !BACKGROUND_VAR_NAMES.has(name),
  );
  const rows = [];
  for (const fg of fgNames) {
    for (const bg of SURFACE_BACKGROUNDS) {
      const ratio = contrastRatio(theme.vars[fg], theme.vars[bg]);
      rows.push({
        fg,
        bg,
        ratio,
        belowText: ratio < TEXT_THRESHOLD,
        belowUi: ratio < UI_THRESHOLD,
      });
    }
  }
  return rows;
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h / 6) * 360, s: s * 100, l: l * 100 };
}

function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Warm-accent pairs whose hue sits too close together to read as distinct
 * status colours, even though each may individually pass its own contrast
 * check against the background. */
export function checkHueProximity(theme) {
  const names = WARM_ACCENT_NAMES.filter((name) => theme.vars[name]);
  const hsl = Object.fromEntries(
    names.map((name) => [name, hexToHsl(theme.vars[name])]),
  );
  const warnings = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = hsl[names[i]];
      const b = hsl[names[j]];
      const dHue = hueDistance(a.h, b.h);
      const closeSat = Math.abs(a.s - b.s) < SIMILARITY_THRESHOLD;
      const closeLight = Math.abs(a.l - b.l) < SIMILARITY_THRESHOLD;
      if (dHue < HUE_DISTANCE_THRESHOLD && closeSat && closeLight) {
        warnings.push({ a: names[i], b: names[j], hueDistance: dHue });
      }
    }
  }
  return warnings;
}

function main() {
  const themePath = path.resolve(
    process.argv[2] ??
      path.join(__dirname, "..", "themes", "aurora-night.json"),
  );
  const theme = loadTheme(themePath);
  console.log(`Theme: ${theme.name} (${themePath})\n`);

  const rows = checkContrast(theme);
  console.log("Contrast (fg on bg):");
  let anyBelowText = false;
  for (const row of rows) {
    const flag = row.belowUi
      ? " ⚠ below 3.0:1 (UI)"
      : row.belowText
        ? " ⚠ below 4.5:1 (text)"
        : "";
    if (row.belowText) anyBelowText = true;
    console.log(
      `  ${row.fg.padEnd(12)} on ${row.bg.padEnd(10)} ${row.ratio.toFixed(2)}:1${flag}`,
    );
  }

  const hueWarnings = checkHueProximity(theme);
  console.log("\nHue proximity (warm accents):");
  if (hueWarnings.length === 0) {
    console.log(
      "  no pairs closer than 15° with similar saturation/lightness.",
    );
  } else {
    for (const w of hueWarnings) {
      console.log(
        `  ⚠ ${w.a} / ${w.b} are only ${w.hueDistance.toFixed(1)}° apart — may read as the same colour.`,
      );
    }
  }

  if (
    process.argv.includes("--exit-code") &&
    (anyBelowText || hueWarnings.length > 0)
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
