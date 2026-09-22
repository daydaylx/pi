import js from "@eslint/js";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/",
      "npm/node_modules/",
      "gui/node_modules/",
      "**/dist/",
      "**/*.map",
      "sessions/",
      "backups/",
      "git/",
      ".pi-subagents/",
      "docs/archive/",
      ".agent/",
      "benchmarks/tasks/*/fixture/",
      "benchmarks/real-duel/tasks/*/instruction.md",
      "pi_gui_arbeitsauftrag/",
      "pi_gui_cursor_redesign/",
      "pi-audit-remediation-improved-e8196d6/",
      "pi_benchmark_befunde_arbeitsauftraege/",
      "pi-second-opinion-agent/",
      "work/",
      "coverage/",
      // typescript-eslint verweigert den Start gegen die hier gepinnte
      // typescript@7.0.2 (siehe https://github.com/typescript-eslint/typescript-eslint/issues/10940).
      // .ts-Dateien bleiben deshalb vorerst außen vor und laufen weiter
      // ausschließlich über `tsc --noEmit` (strict); Aufnahme hier, sobald
      // typescript-eslint TS 7 unterstützt.
      "**/*.ts",
      "**/*.tsx",
    ],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    // scripts/**, frontend-server/**, tests/**, shared/**,
    // benchmarks/real-duel/scripts/** — reines Node-.mjs/.js/.cjs.
    files: [
      "scripts/**/*.mjs",
      "frontend-server/**/*.mjs",
      "tests/**/*.mjs",
      "shared/**/*.mjs",
      "benchmarks/real-duel/scripts/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // gui/main/** — Electron-Main-Prozess (Node).
    files: ["gui/main/**/*.js", "gui/main/**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // gui/renderer/** — läuft im Chromium-Renderer (window/document),
    // exportiert sich aber per typeof-Guard zusätzlich als CommonJS-Modul
    // (siehe z. B. gui/renderer/interaction-helpers.js) — daher module/require
    // zusätzlich zu den Browser-Globals.
    files: ["gui/renderer/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, module: "readonly", require: "readonly" },
    },
  },
  {
    // node:test-Dateien überall im Repo.
    files: ["gui/test/**/*.mjs", "**/test/**/*.mjs", "**/*.test.mjs"],
    languageOptions: { globals: globals.node },
  },
];
