#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

if (process.env.FAKE_PI_ENV_DUMP) {
  writeFileSync(process.env.FAKE_PI_ENV_DUMP, JSON.stringify(process.env));
}

if (process.env.FAKE_SYSTEM_HOST_BACKEND === "1") {
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.kind === "hello") {
      send({
        kind: "hello",
        accepted: true,
        protocolVersion: 1,
        serverVersion: "1.3.0",
        piVersion: "1.0.4",
        capabilities: [],
      });
      send({
        kind: "event",
        event: "state.snapshot",
        data: {
          session: {
            id: "fake-session",
            name: "Fake Session",
            cwd: "/tmp",
            connected: true,
          },
          workflow: { mode: "work", label: "Work", available: ["work"] },
          task: { title: "Fake", phaseLabel: "Ready", status: "active" },
          activity: { kind: "idle" },
          permissions: {
            current: "confirm-all",
            label: "Confirm All",
            options: ["confirm-all"],
          },
          lsp: { state: "idle", detail: "" },
          model: { current: "fake-model", available: ["fake-model"] },
          thinking: { current: "off", available: ["off"] },
          changes: null,
          verification: null,
          subagents: [],
          configuration: {},
        },
      });
      return;
    }
    const size =
      request.method === "session.messages"
        ? Number(
            request.params?.before === "small"
              ? (process.env.FAKE_PI_SMALL_MESSAGES ?? 0)
              : request.params?.before === "normal"
                ? (process.env.FAKE_PI_BIG_MESSAGES ?? 0)
                : request.params?.before === "oversized"
                  ? (process.env.FAKE_PI_OVERSIZED_MESSAGES ?? 0)
                  : 0,
          )
        : 0;
    const result =
      request.method === "session.messages"
        ? {
            messages: [
              {
                role: "user",
                blocks: [
                  {
                    type: "text",
                    text: "x".repeat(size),
                  },
                ],
              },
            ],
          }
        : { pong: true, protocolVersion: 1, piVersion: "1.0.4" };
    const response = {
      protocolVersion: 1,
      kind: "response",
      id: request.id,
      ok: true,
      result,
    };
    if (
      request.method === "session.messages" &&
      request.params?.before === "oversized"
    ) {
      process.stdout.write(
        `${JSON.stringify(response)}\n${JSON.stringify({
          kind: "event",
          event: "session.changed",
          data: { id: "after-oversized" },
        })}\n`,
      );
    } else if (
      request.method === "system.ping" &&
      process.env.FAKE_PI_HANG_PING === "1"
    ) {
      setTimeout(() => send(response), 1_500);
    } else send(response);
  });

  function send(frame) {
    process.stdout.write(`${JSON.stringify(frame)}\n`);
  }
} else {
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
      if (process.env.FAKE_PI_UI_REQUEST === "1") {
        send({
          type: "extension_ui_request",
          id: "fake-approval",
          method: "confirm",
          title: "Fake approval",
          message: "Proceed?",
        });
      }
      return;
    }
    if (request.type === "get_messages") {
      const size = Number(process.env.FAKE_PI_BIG_MESSAGES ?? 0);
      send({
        id: request.id,
        type: "response",
        success: true,
        data: { messages: [{ role: "user", content: "x".repeat(size) }] },
      });
      return;
    }
    if (request.type === "extension_ui_response") {
      if (process.env.FAKE_PI_UI_RESPONSE_LOG) {
        appendFileSync(
          process.env.FAKE_PI_UI_RESPONSE_LOG,
          `${JSON.stringify(request)}\n`,
        );
      }
      send({ id: request.id, type: "response", success: true, data: {} });
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
}
