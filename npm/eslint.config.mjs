import js from "@eslint/js";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/",
      "npm/node_modules/",
      "**/dist/",
      "**/*.map",
      "sessions/",
      "backups/",
      "git/",
      ".pi-subagents/",
      "docs/archive/",
      ".agent/",
      "benchmarks/tasks/*/fixture/",
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
    // — reines Node-.mjs/.js/.cjs.
    files: [
      "scripts/**/*.mjs",
      "frontend-server/**/*.mjs",
      "tests/**/*.mjs",
      "shared/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // node:test-Dateien überall im Repo.
    files: ["**/test/**/*.mjs", "**/*.test.mjs"],
    languageOptions: { globals: globals.node },
  },
];
