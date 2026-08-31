#!/usr/bin/env node
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_PI_VERSION ?? "0.84.99-test"}\n`);
  process.exit(0);
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  let data = {};
  if (request.type === "get_state") {
    data = {
      sessionId: "fake-session",
      sessionName: "Fake",
      isStreaming: false,
      messageCount: 0,
    };
  } else if (request.type === "get_session_stats") {
    data = {
      sessionFile: "/secret/session.jsonl",
      sessionId: "fake-session",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        total: 15,
      },
      cost: 0.01,
    };
  } else if (request.type === "get_messages") {
    data = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
      ],
    };
  }
  if (request.type === "abort" && process.env.FAKE_PI_HANG_ABORT === "1")
    return;
  process.stdout.write(
    `${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`,
  );
});
