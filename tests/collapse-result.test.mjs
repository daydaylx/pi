import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { createHarness, stripAnsi } from "./shared/harness.mjs";
import { importModule } from "./shared/jiti-loader.mjs";

const { collapseResult } = await importModule(
  "extensions/compact-tools/collapse-result.ts",
);
const theme = createHarness().makeContext().ui.theme;

function result(text) {
  return { content: text === undefined ? [] : [{ type: "text", text }] };
}

function renderReceipt(name, args, text) {
  const original = { kind: "original" };
  const wrapped = collapseResult({
    name,
    label: name.toUpperCase(),
    renderResult: () => original,
  });
  const component = wrapped.renderResult(
    result(text),
    { expanded: false, isPartial: false },
    theme,
    {
      args,
      lastComponent: undefined,
      isError: false,
    },
  );
  return { text: stripAnsi(component.render(200).join("\n")), original, wrapped };
}

await test("collapsed local tools show informative one-line receipts", () => {
  const read = renderReceipt("read", { path: "src/main.ts", offset: 5 }, "one\ntwo");
  assert(read.text.includes("src/main.ts") && read.text.includes("Zeilen 5–6"), "read names file and line range");

  const grep = renderReceipt(
    "grep",
    { pattern: "render", path: "extensions" },
    "extensions/a.ts:4: render\nextensions/b.ts:9: render",
  );
  assert(
    grep.text.includes("2 Treffer") && grep.text.includes("2 Dateien") && grep.text.includes("render"),
    "grep names hit count, file count, and pattern",
  );

  const find = renderReceipt("find", { path: "src" }, "src/a.ts\nsrc/b.ts\nsrc/c.ts");
  assert(find.text.includes("3 Dateien") && find.text.includes("src"), "find names file count and scope");

  const ls = renderReceipt("ls", { path: "docs" }, "a.md\nb.md");
  assert(ls.text.includes("2 Einträge") && ls.text.includes("docs"), "ls names entry count and scope");

  const write = renderReceipt("write", { path: "docs/out.md" }, "written");
  assert(write.text.includes("geschrieben: docs/out.md"), "write names target file");

  const bash = renderReceipt("bash", { command: "npm test" }, "starting\nPASS: 5 passed");
  assert(bash.text.includes("Exit 0") && bash.text.includes("PASS: 5 passed"), "bash names success and test summary");
  assert(bash.text.includes("Details"), "receipt keeps the Ctrl+O expansion affordance");
});

await test("collapsed receipts preserve empty, error, partial, and expanded visibility", () => {
  const empty = renderReceipt("read", { path: "empty.txt" }, undefined);
  assert(empty.text.includes("keine Ausgabe"), "unexpected empty result remains visible");

  const original = { kind: "original" };
  const wrapped = collapseResult({
    name: "bash",
    label: "Shell",
    renderResult: () => original,
  });
  for (const [options, isError, label] of [
    [{ expanded: true, isPartial: false }, false, "expanded"],
    [{ expanded: false, isPartial: true }, false, "partial"],
    [{ expanded: false, isPartial: false }, true, "error"],
  ]) {
    eq(
      wrapped.renderResult(result("detail"), options, theme, {
        args: { command: "false" },
        lastComponent: undefined,
        isError,
      }),
      original,
      `${label} result uses the native renderer unchanged`,
    );
  }
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
