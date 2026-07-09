#!/usr/bin/env node
/**
 * Fake pi binary for subagent E2E tests (#40).
 *
 * Reads scenario name from PI_TEST_SCENARIO env var and outputs matching
 * JSON-line events to stdout (and optionally stderr).
 *
 * Supported scenarios:
 *   success        – normal assistant response with usage
 *   error          – process exits 1 with stderr
 *   timeout        – hangs forever (test must kill via timeout/abort)
 *   invalid-json   – emits non-JSON garbage on stdout
 *   multi-turn     – two assistant messages, simulating multi-turn
 *   stderr-noise   – emits large stderr, small valid stdout
 *   chain-probe    – emits an oversized reply for a "STEP1" task, otherwise
 *                    echoes back the exact task text it received (#38)
 */

const scenario = process.env.PI_TEST_SCENARIO || "success";

const events = {
  success: [
    {
      type: "message_end",
      message: {
        role: "assistant",
        model: "fake-model",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Fake agent completed successfully." }],
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.001 },
        },
      },
    },
  ],
  "multi-turn": [
    {
      type: "message_end",
      message: {
        role: "assistant",
        model: "fake-model",
        stopReason: "tool_use",
        content: [{ type: "text", text: "First turn response." }],
        usage: { input: 100, output: 30, cost: { total: 0.0005 } },
      },
    },
    {
      type: "tool_result_end",
      message: {
        role: "user",
        content: [{ type: "text", text: "Tool result data." }],
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        model: "fake-model",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Final response after tool use." }],
        usage: { input: 150, output: 40, cost: { total: 0.0008 } },
      },
    },
  ],
  error: [], // outputs nothing, exits with error
  timeout: [], // hangs – we never write anything
  "invalid-json": [], // handled below
  "stderr-noise": [
    {
      type: "message_end",
      message: {
        role: "assistant",
        model: "fake-model",
        stopReason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input: 10, output: 2, cost: { total: 0.0001 } },
      },
    },
  ],
};

// Writes to piped stdout/stderr are asynchronous on POSIX (unlike files or
// TTYs). process.exit() terminates immediately and can truncate output that
// hasn't reached the pipe yet, causing flaky tests. Setting `exitCode`
// instead lets Node exit naturally once the event loop drains (i.e. once all
// writes have flushed), without forcing an immediate, lossy shutdown.
function emit(scenarioName) {
  if (scenarioName === "error") {
    process.stderr.write("Fake agent error: something went wrong\n");
    process.exitCode = 1;
    return;
  }

  if (scenarioName === "timeout") {
    // Hang indefinitely – test must kill us
    setInterval(() => {}, 60000);
    return;
  }

  if (scenarioName === "invalid-json") {
    process.stdout.write("This is not valid JSON\n");
    process.stdout.write("Still not JSON\n");
    process.stdout.write(
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Recovered after garbage"}]}}\n',
    );
    return;
  }

  if (scenarioName === "chain-probe") {
    const taskArg = process.argv[process.argv.length - 1] || "";
    const taskText = taskArg.startsWith("Task: ")
      ? taskArg.slice("Task: ".length)
      : taskArg;
    const text = taskText.startsWith("STEP1")
      ? "A".repeat(50 * 1024)
      : taskText;
    process.stdout.write(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          model: "fake-model",
          stopReason: "end_turn",
          content: [{ type: "text", text }],
          usage: { input: 10, output: 10, cost: { total: 0.0001 } },
        },
      }) + "\n",
    );
    return;
  }

  if (scenarioName === "stderr-noise") {
    // Emit enough stderr to exceed STDERR_CAP (128 KiB)
    // Each line is ~60 bytes → 2500 lines ≈ 150 KiB
    for (let i = 0; i < 2500; i++) {
      process.stderr.write(
        `Warning: line ${i}: some diagnostic message that repeats many times\n`,
      );
    }
    // Then valid stdout
    for (const event of events[scenarioName]) {
      process.stdout.write(JSON.stringify(event) + "\n");
    }
    return;
  }

  for (const event of events[scenarioName]) {
    process.stdout.write(JSON.stringify(event) + "\n");
  }
}

emit(scenario);
