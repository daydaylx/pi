// Offline-only Pi stand-in for p3.test.mjs. It writes the explicit session
// path supplied by the controller and never makes a model or network call.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const sessionIndex = process.argv.indexOf("--session");
if (sessionIndex < 0 || !process.argv[sessionIndex + 1]) {
  process.stderr.write("missing explicit --session path\n");
  process.exit(2);
}

const sessionPath = process.argv[sessionIndex + 1];
mkdirSync(dirname(sessionPath), { recursive: true, mode: 0o700 });
if (!existsSync(sessionPath)) {
  writeFileSync(
    sessionPath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "p3-offline-stub",
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
      content: [{ type: "text", text: "offline P3 stub" }],
      usage: { input: 1, output: 1, reasoning: 0, totalTokens: 2 },
    },
  })}\n`,
);
