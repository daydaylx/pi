import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import {
  checkRelativeImports,
  relativeImportSpecifiers,
  resolveRelativeImport,
} from "../scripts/check-relative-imports.mjs";

await test("relative import check accepts the current source tree", () => {
  eq(
    checkRelativeImports().length,
    0,
    "every literal relative source import resolves in the working tree",
  );
});

await test("relative import check resolves extensions and reports a missing target", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-relative-imports-"));
  try {
    mkdirSync(path.join(root, "src", "folder"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "entry.ts"),
      'import "./target";\nexport { value } from "./folder";\n',
    );
    writeFileSync(path.join(root, "src", "target.ts"), "export const value = 1;\n");
    writeFileSync(path.join(root, "src", "folder", "index.mjs"), "export const value = 2;\n");
    writeFileSync(path.join(root, "src", "missing.mjs"), 'import "./absent.ts";\n');

    eq(
      relativeImportSpecifiers('const text = "import from ./ignored"; import "./real.ts";').join(","),
      "./real.ts",
      "import-shaped strings are ignored",
    );
    assert(
      resolveRelativeImport(path.join(root, "src", "entry.ts"), "./target"),
      "extensionless TypeScript target resolves",
    );
    assert(
      resolveRelativeImport(path.join(root, "src", "entry.ts"), "./folder"),
      "directory index target resolves",
    );
    eq(
      checkRelativeImports(root, ["src"]),
      ["src/missing.mjs -> ./absent.ts"],
      "only the genuinely missing literal import is reported",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
