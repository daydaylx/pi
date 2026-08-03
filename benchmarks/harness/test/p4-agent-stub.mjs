// Offline-only Pi stand-in for p4.test.mjs. It never makes a model or
// network call. It simulates the two currently-active non-main P4 roles
// (investigator, debugger) having actually run, by writing the same
// {runId}_{role}_meta.json artifact shape pi-subagents documents, so the
// real subagent-artifacts.mjs reader has real files to parse.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function argAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sessionPath = argAfter("--session");
const sessionDir = argAfter("--session-dir");
const runId = argAfter("--name");
if (!sessionPath || !sessionDir || !runId) {
  process.stderr.write("missing explicit --session/--session-dir/--name\n");
  process.exit(2);
}

mkdirSync(dirname(sessionPath), { recursive: true, mode: 0o700 });
if (!existsSync(sessionPath)) {
  writeFileSync(
    sessionPath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "p4-offline-stub",
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    })}\n`,
    { mode: 0o600 },
  );
}
appendFileSync(
  sessionPath,
  `${JSON.stringify({
    type: "message",
    id: `stub-${Date.now()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text: "offline P4 stub" }],
      usage: { input: 1, output: 1, reasoning: 0, totalTokens: 2 },
    },
  })}\n`,
);

const artifactsDir = join(sessionDir, "subagent-artifacts");
mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });
const stubModel = process.env.P4_STUB_MODEL ?? "opencode-go/kimi-k2.7-code";
for (const role of ["investigator", "debugger"]) {
  writeFileSync(
    join(artifactsDir, `${runId}_${role}_meta.json`),
    JSON.stringify({
      model: stubModel,
      durationMs: 5,
      usage: { totalTokens: 3 },
    }),
    { mode: 0o600 },
  );
}
