import { assert, test, counters as summary } from "./shared/assertions.mjs";
import {
  checkContrast,
  checkHueProximity,
  checkStatusDistinctness,
  loadTheme,
} from "../scripts/check-theme-contrast.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const auroraNight = loadTheme(
  path.join(__dirname, "..", "themes", "aurora-night.json"),
);
const auroraForge = loadTheme(
  path.join(__dirname, "..", "themes", "aurora-forge.json"),
);

await test("checkContrast covers every non-background var against every surface", () => {
  const rows = checkContrast(auroraNight);
  const fgCount = Object.keys(auroraNight.vars).length - 7; // 7 background-only vars
  assert(rows.length === fgCount * 3, "one row per (foreground, surface) pair");
  const burgundyOnHighlight = rows.find(
    (row) => row.fg === "burgundy" && row.bg === "highlight",
  );
  assert(
    burgundyOnHighlight.belowText && !burgundyOnHighlight.belowUi,
    "burgundy on highlight is a documented sub-4.5:1, still-above-3:1 case",
  );
  const copperOnBg = rows.find((row) => row.fg === "copper" && row.bg === "bg");
  assert(
    !copperOnBg.belowText,
    "copper on bg comfortably clears the text contrast threshold",
  );
});

await test("checkHueProximity flags the documented burgundy/rosewood clash", () => {
  const warnings = checkHueProximity(auroraNight);
  const pair = warnings.find(
    (w) =>
      (w.a === "burgundy" && w.b === "rosewood") ||
      (w.a === "rosewood" && w.b === "burgundy"),
  );
  assert(
    pair !== undefined && pair.hueDistance < 2,
    "burgundy (syntax keyword) and rosewood (error) sit under 2° apart",
  );
});

await test("Aurora Forge contains every Pi color slot used by Aurora Night", () => {
  for (const color of Object.keys(auroraNight.colors)) {
    assert(
      Object.hasOwn(auroraForge.colors, color),
      `Forge defines the required Pi color slot ${color}`,
    );
  }
  assert(
    auroraForge.name === "aurora-forge" &&
      auroraForge.vars.bg === "#12100F" &&
      auroraForge.vars.bgDark === "#0D0B0A",
    "Forge exposes its deep warm surfaces",
  );
});

await test("Aurora Forge keeps runtime status tones distinct", () => {
  assert(
    checkStatusDistinctness(auroraForge).length === 0,
    "Forge runtime status slots do not collapse into indistinguishable tones",
  );
});

await test("checkHueProximity finds nothing for two warm-accent slots set far apart in hue", () => {
  const syntheticTheme = {
    vars: {
      // Both are checked warm-accent slot names, but this one is a synthetic
      // blue rather than a warm colour — proves distant hues stay unflagged.
      copper: "#d59661",
      rosewood: "#3355cc",
    },
  };
  assert(
    checkHueProximity(syntheticTheme).length === 0,
    "an orange and a synthetic blue in warm-accent slots are not flagged as too close",
  );
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
