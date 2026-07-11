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
 *                    echoes back the exact task text it received (#38). Since
 *                    #47 the task arrives via an `@<file>` argument (0600
 *                    temp file) instead of a raw CLI arg, so the file is
 *                    read to recover the task text.
 *   self-kill      – writes partial output, then dies via SIGKILL so the
 *                    parent sees a signal exit without an exit code
 */
import { readFileSync } from "node:fs";

const scenario = process.env.PI_TEST_SCENARIO || "success";

function selectedModel() {
  const idx = process.argv.indexOf("--model");
  return idx >= 0 ? process.argv[idx + 1] || "" : "";
}

function selectedThinking() {
  const idx = process.argv.indexOf("--thinking");
  return idx >= 0 ? process.argv[idx + 1] || "" : "";
}

function emitAssistantText(text, model = selectedModel() || "fake-model") {
  process.stdout.write(
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        model,
        stopReason: "end_turn",
        content: [{ type: "text", text }],
        usage: { input: 1, output: 1, cost: { total: 0 } },
      },
    }) + "\n",
  );
}

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

  if (scenarioName === "model-primary-ok") {
    emitAssistantText(`Primary model ${selectedModel()} succeeded.`);
    return;
  }

  if (scenarioName === "model-fail-then-success") {
    if (selectedModel() === "primary-model") {
      process.stderr.write("Provider unavailable for primary-model (503)\n");
      process.exitCode = 1;
      return;
    }
    emitAssistantText(`Fallback model ${selectedModel()} succeeded.`);
    return;
  }

  if (scenarioName === "model-all-fail") {
    process.stderr.write(`Provider unavailable for ${selectedModel()} (503)\n`);
    process.exitCode = 1;
    return;
  }

  if (scenarioName === "task-error-no-retry") {
    process.stderr.write("Task failed: assertion failed\n");
    process.exitCode = 1;
    return;
  }

  if (
    scenarioName === "structured-valid" ||
    scenarioName === "structured-missing"
  ) {
    // #53: structured output validation scenarios.
    const text =
      scenarioName === "structured-valid"
        ? "## Summary\nDone.\n\n## Risks\nNone."
        : "## Summary\nDone.";
    process.stdout.write(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          model: "fake-model",
          stopReason: "end_turn",
          content: [{ type: "text", text }],
          usage: { input: 1, output: 1, cost: { total: 0 } },
        },
      }) + "\n",
    );
    return;
  }

  if (scenarioName === "empty-output") {
    // #49: exits 0 but writes nothing usable -> parent must treat as failure.
    return;
  }
  if (scenarioName === "all-invalid") {
    // #49: only garbage on stdout, exit 0, no recoverable message -> failure.
    process.stdout.write("definitely not json\n");
    process.stdout.write("still not json\n");
    return;
  }

  if (scenarioName === "env-probe") {
    // #48: report which env vars the child actually received, so tests can
    // assert the parent env is whitelisted (no unrelated leak) while
    // essentials + PI_SUBAGENT* are present.
    const env = process.env;
    const text = JSON.stringify({
      bogusPresent: "BOGUS_UNRELATED_VAR_48" in env,
      piSubagentPresent: env.PI_SUBAGENT === "1",
      permPresent: env.PI_SUBAGENT_PERMISSION_LEVEL != null,
      writePresent: env.PI_SUBAGENT_WRITE_OVERRIDE != null,
      pathPresent: "PATH" in env,
    });
    process.stdout.write(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          model: "fake-model",
          stopReason: "end_turn",
          content: [{ type: "text", text }],
          usage: { input: 1, output: 1, cost: { total: 0 } },
        },
      }) + "\n",
    );
    return;
  }

  if (scenarioName === "argv-probe") {
    // #47: echo the received argv so tests can assert the task text is NOT
    // passed as a raw CLI argument (only an @<file> reference should appear).
    const text = JSON.stringify(process.argv);
    process.stdout.write(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          model: "fake-model",
          stopReason: "end_turn",
          content: [{ type: "text", text }],
          usage: { input: 1, output: 1, cost: { total: 0 } },
        },
      }) + "\n",
    );
    return;
  }

  if (scenarioName === "model-thinking-inherit-probe") {
    // #58/#59: echo the resolved --model/--thinking flags so tests can
    // assert inherited vs. overridden values without parsing raw argv.
    const text = JSON.stringify({
      model: selectedModel(),
      thinking: selectedThinking(),
    });
    process.stdout.write(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          model: selectedModel() || "fake-model",
          stopReason: "end_turn",
          content: [{ type: "text", text }],
          usage: { input: 1, output: 1, cost: { total: 0 } },
        },
      }) + "\n",
    );
    return;
  }

  if (scenarioName === "chain-probe") {
    // #47: the task is delivered via an `@<file>` temp-file argument. Read it
    // back; fall back to a raw trailing arg for older callers.
    let taskText = "";
    const atFile = process.argv.find((a) => a.startsWith("@"));
    if (atFile) {
      try {
        const content = readFileSync(atFile.slice(1), "utf8");
        taskText = content.startsWith("Task: ")
          ? content.slice("Task: ".length)
          : content;
      } catch {
        taskText = "";
      }
    } else {
      const taskArg = process.argv[process.argv.length - 1] || "";
      taskText = taskArg.startsWith("Task: ")
        ? taskArg.slice("Task: ".length)
        : taskArg;
    }
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

  if (scenarioName === "self-kill") {
    process.stdout.write(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          model: "fake-model",
          stopReason: "end_turn",
          content: [{ type: "text", text: "Partial output before kill" }],
          usage: { input: 1, output: 1, cost: { total: 0 } },
        },
      }) + "\n",
    );
    // Give the pipe a moment to flush, then die by signal (no exit code).
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 50);
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
