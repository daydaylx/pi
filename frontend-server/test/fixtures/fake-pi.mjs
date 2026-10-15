#!/usr/bin/env node
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_PI_VERSION ?? "0.84.99-test"}\n`);
  process.exit(0);
}

const lines = readline.createInterface({ input: process.stdin });
let pendingPromptId;
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
    const count = Number(process.env.FAKE_PI_MESSAGES_COUNT ?? 0);
    data = {
      messages:
        count > 0
          ? Array.from({ length: count }, (_, index) => ({
              role: "assistant",
              content: [{ type: "text", text: `message-${index}` }],
            }))
          : [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text:
                      "x".repeat(
                        Number(process.env.FAKE_PI_BIG_MESSAGES ?? 0),
                      ) || "ok",
                  },
                ],
              },
            ],
    };
  }
  if (request.type === "prompt" && process.env.FAKE_PI_UI_CONFIRM === "1") {
    pendingPromptId = request.id;
    process.stdout.write(
      `${JSON.stringify({
        type: "extension_ui_request",
        id: "dialog-1",
        method: "confirm",
        title: "Freigabe benötigt",
        message: "Soll die Aktion ausgeführt werden?",
      })}\n`,
    );
    return;
  }
  if (request.type === "extension_ui_response") {
    if (pendingPromptId) {
      process.stdout.write(
        `${JSON.stringify({
          id: pendingPromptId,
          type: "response",
          command: "prompt",
          success: true,
          data: { disposition: "completed" },
        })}\n`,
      );
      pendingPromptId = undefined;
    }
    return;
  }
  if (request.type === "abort") {
    if (process.env.FAKE_PI_HANG_ABORT === "1") return;
    process.stdout.write(
      `${JSON.stringify({ type: "agent_settled", aborted: true })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`,
    );
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`,
  );
});
