import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

function makeFakeTerminal({
  columns = 80,
  rows = 24,
  enterError = false,
} = {}) {
  let input;
  let resize;
  let currentColumns = columns;
  let currentRows = rows;
  const outputs = [];
  let enters = 0;
  let leaves = 0;
  return {
    getSize() {
      return { columns: currentColumns, rows: currentRows };
    },
    enter(onInput, onResize) {
      enters += 1;
      if (enterError) throw new Error("terminal setup failed");
      input = onInput;
      resize = onResize;
    },
    write(data) {
      outputs.push(data);
    },
    leave() {
      leaves += 1;
    },
    send(data) {
      input?.(data);
    },
    setSize(nextColumns, nextRows) {
      currentColumns = nextColumns;
      currentRows = nextRows;
      resize?.();
    },
    outputs,
    get enters() {
      return enters;
    },
    get leaves() {
      return leaves;
    },
  };
}

function makeFakePty() {
  let dataHandler;
  let exitHandler;
  const writes = [];
  const resizes = [];
  const kills = [];
  return {
    pid: 4321,
    onData(handler) {
      dataHandler = handler;
      return { dispose() {} };
    },
    onExit(handler) {
      exitHandler = handler;
      return { dispose() {} };
    },
    write(data) {
      writes.push(data);
    },
    resize(columns, rows) {
      resizes.push({ columns, rows });
    },
    kill(signal) {
      kills.push(signal);
    },
    emitData(data) {
      dataHandler?.(data);
    },
    emitExit(exitCode, signal) {
      exitHandler?.({ exitCode, signal });
    },
    writes,
    resizes,
    kills,
  };
}

export const interactivePtySections = {
  "interactive PTY runner": async (context) => {
    const {
      section,
      interactiveRunner,
      interactivePty,
      modePermissions,
      planMode,
    } = context;
    if (!interactiveRunner || !interactivePty || !modePermissions || !planMode)
      return;

    await section("interactive PTY runner", async () => {
      const terminal = makeFakeTerminal();
      const pty = makeFakePty();
      const run = interactiveRunner.runInteractivePty({
        file: "/bin/sh",
        args: ["-c", "sudo id"],
        cwd: "/tmp",
        env: { PATH: "/usr/bin" },
        terminal,
        spawn: () => pty,
      });

      terminal.send("SUPER_SECRET_TEST_VALUE_123456\n");
      terminal.send("\u0003");
      terminal.setSize(120, 40);
      pty.emitData("[sudo] password for user: \n");
      pty.emitExit(0);
      const result = await run;

      const previousPasswordEnv = process.env.SUDO_PASSWORD;
      process.env.SUDO_PASSWORD = "SUPER_SECRET_TEST_VALUE_123456";
      const childEnv = interactivePty.shellEnvironment();
      if (previousPasswordEnv === undefined) delete process.env.SUDO_PASSWORD;
      else process.env.SUDO_PASSWORD = previousPasswordEnv;
      eq(
        childEnv.SUDO_PASSWORD,
        undefined,
        "interactive child environment has no password shortcut",
      );
      eq(result.exitCode, 0, "interactive runner returns the PTY exit code");
      eq(result.killed, false, "normal interactive exit is not marked killed");
      eq(terminal.enters, 1, "runner enters the terminal exactly once");
      eq(terminal.leaves, 1, "runner restores the terminal exactly once");
      eq(
        pty.writes,
        ["SUPER_SECRET_TEST_VALUE_123456\n", "\u0003"],
        "keyboard data reaches the PTY without transformation",
      );
      eq(
        pty.resizes.at(-1),
        { columns: 120, rows: 40 },
        "terminal resize reaches the PTY",
      );
      assert(
        !JSON.stringify(result).includes("SUPER_SECRET_TEST_VALUE_123456"),
        "interactive result never contains keyboard input",
      );
      assert(
        !JSON.stringify(terminal.outputs).includes(
          "SUPER_SECRET_TEST_VALUE_123456",
        ),
        "PTY output sink does not receive keyboard input implicitly",
      );

      const timeoutTerminal = makeFakeTerminal();
      const timeoutPty = makeFakePty();
      const timeoutGroupKills = [];
      const timeoutRun = interactiveRunner.runInteractivePty({
        file: "/bin/sh",
        args: ["-c", "sleep 10"],
        cwd: "/tmp",
        env: {},
        terminal: timeoutTerminal,
        spawn: () => timeoutPty,
        killProcessGroup: (pid, signal) =>
          timeoutGroupKills.push({ pid, signal }),
        timeoutMs: 5,
        killGraceMs: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      assert(timeoutPty.kills.includes("SIGTERM"), "timeout sends SIGTERM");
      eq(
        timeoutGroupKills[0],
        { pid: 4321, signal: "SIGTERM" },
        "timeout escalates through the child process group",
      );
      timeoutPty.emitExit(143, 15);
      const timeoutResult = await timeoutRun;
      eq(
        timeoutResult.timedOut,
        true,
        "timeout is reported without PTY output",
      );
      eq(timeoutTerminal.leaves, 1, "timeout restores the terminal");

      const abortTerminal = makeFakeTerminal();
      const abortPty = makeFakePty();
      const controller = new AbortController();
      const abortRun = interactiveRunner.runInteractivePty({
        file: "/bin/sh",
        args: ["-c", "wait"],
        cwd: "/tmp",
        env: {},
        terminal: abortTerminal,
        spawn: () => abortPty,
        signal: controller.signal,
        killGraceMs: 1,
      });
      controller.abort();
      assert(abortPty.kills.includes("SIGTERM"), "abort sends SIGTERM");
      abortPty.emitExit(130, 2);
      const abortResult = await abortRun;
      eq(abortResult.aborted, true, "abort is reported separately");
      eq(abortTerminal.leaves, 1, "abort restores the terminal");

      const failingTerminal = makeFakeTerminal({ enterError: true });
      const failingPty = makeFakePty();
      const failingRun = interactiveRunner.runInteractivePty({
        file: "/bin/sh",
        args: ["-c", "true"],
        cwd: "/tmp",
        env: {},
        terminal: failingTerminal,
        spawn: () => failingPty,
      });
      await failingRun.then(
        () => assert(false, "terminal setup failure must reject"),
        (error) =>
          eq(
            error.message,
            "Interactive process could not be started.",
            "setup errors do not expose PTY data",
          ),
      );
      eq(
        failingTerminal.leaves,
        0,
        "terminal setup failure never claims a terminal was entered",
      );

      const nonTui = createHarness();
      interactivePty.default(nonTui.api);
      const nonTuiContext = nonTui.makeContext({ mode: "print", hasUI: false });
      const nonTuiResult = await nonTui.tools
        .get("interactive_shell")
        .execute(
          "interactive-call",
          { command: "sudo id" },
          undefined,
          undefined,
          nonTuiContext,
        );
      assert(
        nonTuiResult.content[0].text.includes("requires the TUI"),
        "interactive tool fails closed outside the TUI",
      );
      assert(
        !nonTuiResult.content[0].text.includes(
          "SUPER_SECRET_TEST_VALUE_123456",
        ),
        "non-TUI result cannot contain interactive input",
      );

      const policyHarness = createHarness({ confirm: false });
      policyHarness.api.events.on("recovery-status:request", (request) =>
        request.respond({ armed: false }),
      );
      modePermissions.default(policyHarness.api);
      const policyContext = policyHarness.makeContext();
      await policyHarness.runHooks("session_start", {}, policyContext);
      const rejected = await policyHarness.runHooks(
        "tool_call",
        {
          toolName: "interactive_shell",
          toolCallId: "interactive-rejected",
          input: { command: "sudo id" },
        },
        policyContext,
      );
      assert(
        rejected.some((entry) => entry?.block),
        "permission rejection blocks interactive shell before execution",
      );
      for (const command of [
        "printf secret | sudo -S id",
        "sudo --stdin id",
        "SUDO_PASSWORD=secret sudo id",
        "/usr/bin/env PASSWORD=secret sudo id",
        "sshpass -p secret ssh host",
        "printf secret | ssh host",
        "sudo '-S' id",
        'sudo "$(printf -- --stdin)" id',
        "sudo --password=secret id",
      ]) {
        assert(
          interactivePty.forbiddenInteractiveCredentialPath(command),
          `${command} is rejected as a credential shortcut`,
        );
      }

      const approvedHarness = createHarness({ confirm: true });
      approvedHarness.api.events.on("recovery-status:request", (request) =>
        request.respond({ armed: false }),
      );
      planMode.default(approvedHarness.api);
      modePermissions.default(approvedHarness.api);
      const approvedContext = approvedHarness.makeContext();
      approvedContext.ui.custom = async () => {
        throw new Error("use deterministic confirm fallback");
      };
      await approvedHarness.runHooks("session_start", {}, approvedContext);
      const approved = await approvedHarness.runHooks(
        "tool_call",
        {
          toolName: "interactive_shell",
          toolCallId: "interactive-approved",
          input: { command: "sudo id" },
        },
        approvedContext,
      );
      assert(
        !approved.some((entry) => entry?.block),
        "sudo reaches the existing confirmation gate for interactive_shell",
      );
      await approvedHarness.commands.get("permission")("yolo", approvedContext);
      const yolo = await approvedHarness.runHooks(
        "tool_call",
        {
          toolName: "interactive_shell",
          toolCallId: "interactive-yolo",
          input: { command: "sudo id" },
        },
        approvedContext,
      );
      assert(
        yolo.some((entry) => entry?.block),
        "YOLO does not bypass the interactive sudo restriction",
      );

      const normalBash = await policyHarness.runHooks(
        "tool_call",
        {
          toolName: "bash",
          toolCallId: "normal-bash",
          input: { command: "pwd" },
        },
        policyContext,
      );
      assert(
        !normalBash.some((entry) => entry?.block),
        "normal bash remains available through its existing runner path",
      );
    });
  },
};
