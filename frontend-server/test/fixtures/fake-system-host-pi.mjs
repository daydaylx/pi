import { appendFileSync } from "node:fs";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("1.0.4\n");
  process.exit(0);
}

if (process.env.FAKE_PI_START_LOG) {
  appendFileSync(process.env.FAKE_PI_START_LOG, `${process.pid}\n`);
}

const input = readline.createInterface({ input: process.stdin });
function send(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    send({
      id: request.id,
      type: "response",
      success: true,
      data: {
        sessionId: "shared-system-session",
        sessionName: "System",
        isStreaming: false,
        messageCount: 0,
      },
    });
    return;
  }
  if (request.type === "prompt") {
    if (process.env.FAKE_PI_PROMPT_LOG) {
      appendFileSync(process.env.FAKE_PI_PROMPT_LOG, `${request.id}\n`);
    }
    if (process.env.FAKE_PI_HANG_PROMPT === "1") return;
    send({ type: "agent_start" });
    send({
      id: request.id,
      type: "response",
      success: true,
      data: {},
    });
    setTimeout(() => send({ type: "agent_settled" }), 350);
    return;
  }
  send({
    id: request.id,
    type: "response",
    success: true,
    data: {},
  });
});
