import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { importModule } from "./shared/jiti-loader.mjs";

const extension = await importModule("extensions/system-control/index.ts");
const audit = await importModule("extensions/system-control/audit.ts");
const policy = await importModule("extensions/system-control/policy.ts");
const toolPolicy = await importModule("extensions/permissions/tool-policy.ts");
const bashPolicy = await importModule("extensions/shared/permission-policy.ts");
const guards = await importModule("extensions/permissions/guards.ts");
const { Value } =
  await import("../npm/node_modules/typebox/build/value/index.mjs");

function register(profile, exec = async () => ({ stdout: "ok", stderr: "" })) {
  const tools = new Map();
  extension.registerSystemControl(
    { registerTool: (tool) => tools.set(tool.name, tool) },
    { profile: () => profile, exec },
  );
  return tools;
}

test("System-Control ist profilgebunden, strikt und registriert den festen Katalog", () => {
  assert.equal(register("project").size, 0);
  const tools = register("system");
  assert.deepEqual(
    [...tools.keys()],
    [
      "system_unit_status",
      "system_journal",
      "nixos_status",
      "desktop_state",
      "audio_status",
      "desktop_switch_workspace",
      "desktop_focus_window",
      "audio_set_volume",
      "notify",
      "user_service",
      "nixos_build",
      "nixos_apply",
      "system_job",
    ],
  );
  for (const tool of tools.values())
    assert.equal(tool.parameters.additionalProperties, false);
  assert.equal(
    policy.systemBashNeedsApproval(
      "/run/current-system/sw/bin/nixos-agent-apply",
    ),
    true,
  );
  assert.equal(
    policy.systemBashNeedsApproval(
      "env FOO=1 command /run/current-system/sw/bin/nixos-agent-switch",
    ),
    true,
  );
  assert.equal(
    policy.systemBashNeedsApproval(
      "command -- /nix/store/x/switch-to-configuration",
    ),
    true,
  );
  assert.equal(
    policy.systemBashNeedsApproval(
      "env -i PATH=/run/current-system/sw/bin sudo -n nixos-rebuild test",
    ),
    true,
  );
  assert.equal(policy.systemBashNeedsApproval("nixos-rebuild boot"), true);
  assert.equal(policy.systemBashNeedsApproval("nixos-rebuild test"), true);
  assert.equal(policy.systemBashNeedsApproval("nixos-rebuild switch"), true);
  assert.equal(policy.systemBashNeedsApproval("echo nixos-agent-apply"), true);
  assert.equal(
    policy.systemBashNeedsApproval("echo safe; /usr/bin/nixos-agent-apply"),
    true,
  );
  assert.equal(policy.systemBashNeedsApproval("true && sudo -n true"), true);
  for (const command of [
    "bash -c 'nixos-agent-apply'",
    'sh -c "sudo id"',
    "timeout 5 nixos-agent-apply",
    "nohup nixos-agent-apply",
    "xargs nixos-agent-apply",
    "exec nixos-agent-apply",
    "/run/current-system/sw/bin/nixos-agent-apply",
    "env -i sudo id",
    "bash -lc 'echo x; nixos-agent-switch'",
    "echo sudo",
    `echo "sudo"`,
    "nixos-agent\\-apply",
    "echo nixos-rebuild; echo switch",
  ]) {
    assert.equal(policy.systemBashNeedsApproval(command), true, command);
  }
  for (const command of [
    "ls",
    "git status",
    "nixos-rebuild build",
    "grep -r nixos-agent docs",
  ]) {
    assert.equal(policy.systemBashNeedsApproval(command), false, command);
  }
});

test("System-Bash-Policy hebt nur allow für geschützte Befehle auf ask an", () => {
  const levels = [
    "readonly",
    "project-write",
    "confirm-all",
    "headless",
    "yolo",
    "yolo-ask",
    "yolo-full",
  ];
  const baseline = {
    "ls /tmp": ["allow", "allow", "allow", "allow", "allow", "allow", "allow"],
    "nixos-agent-build": [
      "block",
      "allow",
      "ask",
      "allow",
      "allow",
      "allow",
      "allow",
    ],
    "nixos-agent-apply": [
      "block",
      "allow",
      "ask",
      "allow",
      "allow",
      "allow",
      "allow",
    ],
    "sudo ls": ["block", "ask", "ask", "block", "block", "ask", "allow"],
    "su -c id": ["block", "allow", "ask", "allow", "block", "ask", "allow"],
    "env sudo id": ["block", "ask", "ask", "block", "block", "ask", "allow"],
    "bash -c 'nixos-agent-apply'": [
      "block",
      "ask",
      "ask",
      "block",
      "block",
      "ask",
      "allow",
    ],
    "timeout 5 nixos-agent-apply": [
      "block",
      "allow",
      "ask",
      "allow",
      "allow",
      "allow",
      "allow",
    ],
    "nixos-rebuild switch --flake .#nixos": [
      "block",
      "allow",
      "ask",
      "allow",
      "allow",
      "allow",
      "allow",
    ],
    "nixos-rebuild build --flake .#nixos": [
      "block",
      "allow",
      "ask",
      "allow",
      "allow",
      "allow",
      "allow",
    ],
    "echo sudo": ["allow", "ask", "allow", "block", "block", "ask", "allow"],
  };
  const commands = Object.keys(baseline);

  function expectedAction(profile, command, existingAction) {
    if (profile === "project") return existingAction;
    if (existingAction === "allow" && policy.systemBashNeedsApproval(command))
      return "ask";
    return existingAction;
  }

  const previousProfile = process.env.PI_LAUNCH_PROFILE;
  try {
    for (const profile of ["system", "project"]) {
      process.env.PI_LAUNCH_PROFILE = profile;
      for (const command of commands) {
        for (const [index, level] of levels.entries()) {
          const existingAction = baseline[command][index];
          const decision = toolPolicy.decideTool(
            level,
            { toolName: "bash", input: { command } },
            "/tmp",
            { unknownTools: "block", bash: "allow" },
          );
          assert.equal(
            decision.action,
            expectedAction(profile, command, existingAction),
            `${profile} ${level}: ${command}`,
          );
        }
      }
    }
  } finally {
    if (previousProfile === undefined) delete process.env.PI_LAUNCH_PROFILE;
    else process.env.PI_LAUNCH_PROFILE = previousProfile;
  }
});

test("Schemas begrenzen Unit, Job, Desktop, Audio und Allowlist-Parameter", () => {
  const tools = register("system");
  const validUnit = tools.get("system_unit_status").parameters;
  for (const unit of ["demo.service", "templated@user.timer"]) {
    assert.equal(Value.Check(validUnit, { unit }), true);
  }
  for (const unit of [
    "../demo.service",
    "~/.config.service",
    "-bad.service",
    "bad unit.service",
    "bad\n.service",
    "bad\0.service",
    "δοκιμή.service",
    "bad.service/",
    "bad",
  ]) {
    assert.equal(Value.Check(validUnit, { unit }), false, JSON.stringify(unit));
  }
  assert.equal(
    Value.Check(tools.get("system_unit_status").parameters, {
      unit: "demo.service",
      extra: true,
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("system_journal").parameters, {
      unit: "demo.service",
      lines: 1,
      priority: "emerg",
    }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("system_journal").parameters, {
      unit: "demo.service",
      lines: 0,
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("system_journal").parameters, {
      unit: "demo.service",
      lines: 201,
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("system_journal").parameters, {
      unit: "demo.service",
      priority: "trace",
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("desktop_switch_workspace").parameters, { n: 1 }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("desktop_switch_workspace").parameters, { n: 99 }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("desktop_switch_workspace").parameters, { n: 0 }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("desktop_focus_window").parameters, {
      address: "0x123abc",
    }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("desktop_focus_window").parameters, {
      address: "0x-1",
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("audio_set_volume").parameters, {
      target: "sink",
      volume: 1.5,
    }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("audio_set_volume").parameters, {
      target: "monitor",
      volume: 0.5,
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("audio_set_volume").parameters, {
      target: "sink",
      volume: 1.51,
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("user_service").parameters, {
      action: "restart",
      unit: "waybar.service",
    }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("user_service").parameters, {
      action: "restart",
      unit: "agent-control.service",
    }),
    false,
  );
  assert.equal(
    Value.Check(tools.get("system_job").parameters, {
      id: "pi-job-12345678-1234-1234-1234-123456789abc",
      action: "status",
    }),
    true,
  );
  assert.equal(
    Value.Check(tools.get("system_job").parameters, {
      id: "foreign.service",
      action: "stop",
    }),
    false,
  );
});

test("Ungültige Toolparameter werden vor exec abgelehnt", async () => {
  const previousAudit = process.env.PI_SYSTEM_AUDIT_DIR;
  const temp = mkdtempSync(path.join(tmpdir(), "pi-system-control-invalid-"));
  process.env.PI_SYSTEM_AUDIT_DIR = path.join(temp, "audit");
  let calls = 0;
  const tools = register("system", async () => {
    calls += 1;
    return { stdout: "unexpected", stderr: "" };
  });
  try {
    for (const unit of [
      "../bad.service",
      "-bad.service",
      "bad\n.service",
      "bad\0.service",
      "δοκιμή.service",
      "bad unit.service",
    ]) {
      const result = await tools
        .get("system_unit_status")
        .execute("id", { unit }, undefined, () => {}, {});
      assert.equal(result.isError, true);
      assert.equal(result.details.outcome, "denied");
    }
    const invalidJob = await tools
      .get("system_job")
      .execute(
        "id",
        { id: "wrong.service", action: "stop" },
        undefined,
        () => {},
        {},
      );
    assert.equal(invalidJob.isError, true);
    assert.equal(calls, 0);
  } finally {
    if (previousAudit === undefined) delete process.env.PI_SYSTEM_AUDIT_DIR;
    else process.env.PI_SYSTEM_AUDIT_DIR = previousAudit;
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Jede Aktion nutzt feste argv und eine minimale Kindumgebung", async () => {
  const previousAudit = process.env.PI_SYSTEM_AUDIT_DIR;
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  const previousSsh = process.env.SSH_AUTH_SOCK;
  const previousDesktop = [
    "XDG_RUNTIME_DIR",
    "WAYLAND_DISPLAY",
    "HYPRLAND_INSTANCE_SIGNATURE",
  ].map((key) => process.env[key]);
  const temp = mkdtempSync(path.join(tmpdir(), "pi-system-control-"));
  process.env.PI_SYSTEM_AUDIT_DIR = path.join(temp, "audit");
  process.env.ANTHROPIC_API_KEY = "sensitive-test-value";
  process.env.SSH_AUTH_SOCK = "/tmp/test-agent.sock";
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  process.env.WAYLAND_DISPLAY = "wayland-1";
  process.env.HYPRLAND_INSTANCE_SIGNATURE = "test-instance";
  const calls = [];
  const tools = register("system", async (file, args, options) => {
    calls.push({ file, args, options });
    return {
      stdout:
        file === "hyprctl" && args[1] === "activewindow"
          ? JSON.stringify({
              title: "secret title",
              class: "term",
              workspace: { id: 2 },
              address: "0xabc",
            })
          : file === "hyprctl" && args[1] === "workspaces"
            ? JSON.stringify([
                {
                  id: 2,
                  name: "2",
                  monitor: "DP-1",
                  windows: 1,
                  hasfullscreen: false,
                  lastwindowtitle: "secret workspace title",
                  title: "secret",
                  initialTitle: "secret",
                },
              ])
            : file === "hyprctl" && args[1] === "monitors"
              ? JSON.stringify([
                  {
                    id: 1,
                    name: "DP-1",
                    width: 1920,
                    height: 1080,
                    refreshRate: 60,
                    activeWorkspace: { id: 2 },
                    focused: true,
                    lastwindowtitle: "secret monitor title",
                    title: "secret",
                    initialTitle: "secret",
                  },
                ])
              : "ok",
      stderr: "",
    };
  });
  const ctx = {};
  const invoke = async (name, params = {}) =>
    tools.get(name).execute("id", params, undefined, () => {}, ctx);
  try {
    await invoke("system_unit_status", { unit: "sshd.service" });
    await invoke("system_journal", {
      unit: "sshd.service",
      lines: 44,
      priority: "warning",
    });
    await invoke("nixos_status");
    const desktop = await invoke("desktop_state", { what: "active" });
    const workspaces = await invoke("desktop_state", { what: "workspaces" });
    const monitors = await invoke("desktop_state", { what: "monitors" });
    for (const result of [desktop, workspaces, monitors]) {
      for (const titleField of ["title", "lastwindowtitle", "initialTitle"])
        assert.equal(result.content[0].text.includes(titleField), false);
    }
    assert.match(workspaces.content[0].text, /"hasfullscreen":false/);
    assert.match(monitors.content[0].text, /"refreshRate":60/);
    const malformedDesktop = register("system", async () => ({
      stdout: JSON.stringify({
        raw: "must not pass through",
        title: "private",
      }),
      stderr: "",
    }));
    const malformed = await malformedDesktop
      .get("desktop_state")
      .execute("id", { what: "monitors" }, undefined, () => {}, ctx);
    assert.match(malformed.content[0].text, /Ungültige Hyprland-Antwort/);
    assert.equal(
      malformed.content[0].text.includes("must not pass through"),
      false,
    );
    assert.equal(malformed.content[0].text.includes("private"), false);
    await invoke("audio_status");
    await invoke("desktop_switch_workspace", { n: 4 });
    await invoke("desktop_focus_window", { address: "0xabc" });
    await invoke("audio_set_volume", { target: "source", volume: 0.75 });
    await invoke("notify", { title: "hi", text: "there" });
    await invoke("user_service", { action: "restart", unit: "waybar.service" });
    const build = await invoke("nixos_build");
    const apply = await invoke("nixos_apply");
    await invoke("system_job", {
      id: "pi-job-12345678-1234-1234-1234-123456789abc",
      action: "status",
    });
    await invoke("audio_set_volume", { target: "sink", volume: 1 });
    await invoke("system_job", {
      id: "pi-job-12345678-1234-1234-1234-123456789abc",
      action: "output",
    });
    await invoke("system_job", {
      id: "pi-job-12345678-1234-1234-1234-123456789abc",
      action: "stop",
    });
    assert.deepEqual(
      calls.slice(0, 12).map(({ file, args }) => [file, args]),
      [
        [
          "systemctl",
          ["status", "--no-pager", "--lines=20", "--", "sshd.service"],
        ],
        [
          "journalctl",
          ["-u", "sshd.service", "-n", "44", "--no-pager", "-p", "warning"],
        ],
        ["nixos-agent-status", []],
        ["hyprctl", ["-j", "activewindow"]],
        ["hyprctl", ["-j", "workspaces"]],
        ["hyprctl", ["-j", "monitors"]],
        ["wpctl", ["status"]],
        ["hyprctl", ["dispatch", "workspace", "4"]],
        ["hyprctl", ["dispatch", "focuswindow", "address:0xabc"]],
        ["wpctl", ["set-volume", "@DEFAULT_AUDIO_SOURCE@", "0.75"]],
        ["notify-send", ["--", "hi", "there"]],
        ["systemctl", ["--user", "restart", "--", "waybar.service"]],
      ],
    );
    assert.match(calls[12].args[3], /^--unit=pi-job-[0-9a-f-]{36}$/);
    assert.deepEqual(calls[12].args, [
      "--user",
      "--collect",
      "--quiet",
      calls[12].args[3],
      "--",
      "nixos-agent-build",
    ]);
    assert.deepEqual(calls[13].args, [
      "--user",
      "--collect",
      "--quiet",
      calls[13].args[3],
      "--",
      "nixos-agent-apply",
    ]);
    assert.deepEqual(calls[14].args, [
      "--user",
      "show",
      "-p",
      "ActiveState,SubState,Result,ExecMainStatus,InvocationID",
      "--",
      "pi-job-12345678-1234-1234-1234-123456789abc.service",
    ]);
    assert.deepEqual(calls[15].args, [
      "set-volume",
      "@DEFAULT_AUDIO_SINK@",
      "1",
    ]);
    assert.deepEqual(calls[16].args, [
      "--user",
      "-u",
      "pi-job-12345678-1234-1234-1234-123456789abc.service",
      "-n",
      "200",
      "--no-pager",
    ]);
    assert.deepEqual(calls[17].args, [
      "--user",
      "stop",
      "--",
      "pi-job-12345678-1234-1234-1234-123456789abc.service",
    ]);
    assert.equal(desktop.content[0].text.includes("secret title"), false);
    for (const { options } of calls) {
      assert.equal(options.timeout, 15_000);
      assert.equal(options.maxBuffer, 64_000);
      assert.equal(options.env.PATH, "/run/current-system/sw/bin");
      assert.equal("ANTHROPIC_API_KEY" in options.env, false);
      assert.equal("SSH_AUTH_SOCK" in options.env, false);
      assert.deepEqual(
        Object.keys(options.env).sort(),
        [
          "DBUS_SESSION_BUS_ADDRESS",
          "HOME",
          "HYPRLAND_INSTANCE_SIGNATURE",
          "LANG",
          "PATH",
          "WAYLAND_DISPLAY",
          "XDG_RUNTIME_DIR",
        ]
          .filter((key) => options.env[key] !== undefined)
          .sort(),
      );
    }
    assert.match(build.content[0].text, /^Job gestartet: pi-job-/);
    assert.match(apply.content[0].text, /^Job gestartet: pi-job-/);
  } finally {
    if (previousAudit === undefined) delete process.env.PI_SYSTEM_AUDIT_DIR;
    else process.env.PI_SYSTEM_AUDIT_DIR = previousAudit;
    if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousApiKey;
    if (previousSsh === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = previousSsh;
    [
      "XDG_RUNTIME_DIR",
      "WAYLAND_DISPLAY",
      "HYPRLAND_INSTANCE_SIGNATURE",
    ].forEach((key, index) => {
      if (previousDesktop[index] === undefined) delete process.env[key];
      else process.env[key] = previousDesktop[index];
    });
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Policy-Matrix erzwingt Systemklassen und Bash-Gegenprobe", async () => {
  const previousProfile = process.env.PI_LAUNCH_PROFILE;
  process.env.PI_LAUNCH_PROFILE = "system";
  const levels = [
    "project-write",
    "confirm-all",
    "yolo",
    "yolo-ask",
    "yolo-full",
    "readonly",
    "headless",
  ];
  try {
    for (const level of levels) {
      const decision = (toolName) =>
        toolPolicy.decideTool(level, { toolName, input: {} }, "/tmp", {
          unknownTools: "block",
          bash: "allow",
        });
      assert.equal(decision("system_unit_status").action, "allow");
      assert.equal(
        decision("desktop_switch_workspace").action,
        ["readonly", "headless"].includes(level) ? "block" : "ask",
      );
      assert.equal(
        decision("nixos_apply").action,
        ["readonly", "headless"].includes(level) ? "block" : "ask",
      );
      assert.equal(
        toolPolicy.decideTool(
          level,
          { toolName: "bash", input: { command: "nixos-agent-apply" } },
          "/tmp",
          { unknownTools: "block", bash: "allow" },
        ).action,
        bashPolicy.decideBash(level, "nixos-agent-apply", "/tmp").action ===
          "allow"
          ? "ask"
          : bashPolicy.decideBash(level, "nixos-agent-apply", "/tmp").action,
      );
    }
    assert.equal(
      toolPolicy.decideTool(
        "yolo-full",
        { toolName: "system_job", input: { action: "stop" } },
        "/tmp",
        { unknownTools: "block", bash: "allow" },
      ).action,
      "ask",
    );
    assert.equal(
      toolPolicy.decideTool(
        "yolo-full",
        { toolName: "system_job", input: { action: "unexpected" } },
        "/tmp",
        { unknownTools: "block", bash: "allow" },
      ).action,
      "block",
    );
    process.env.PI_LAUNCH_PROFILE = "project";
    assert.equal(
      toolPolicy.decideTool(
        "yolo-full",
        { toolName: "bash", input: { command: "nixos-agent-apply" } },
        "/tmp",
        { unknownTools: "block", bash: "allow" },
      ).action,
      "allow",
    );
    assert.equal(policy.systemBashNeedsApproval("nixos-rebuild build"), false);
    const plan = { mode: "simple_plan" };
    process.env.PI_LAUNCH_PROFILE = "system";
    assert.equal(
      guards.systemControlPlanModeBlocks(plan, {
        toolName: "nixos_apply",
        input: {},
      }),
      true,
    );
    assert.equal(
      guards.systemControlPlanModeBlocks(plan, {
        toolName: "system_unit_status",
        input: { unit: "demo.service" },
      }),
      false,
    );
    for (const toolName of ["bash", "interactive_shell"]) {
      assert.equal(
        toolPolicy.decideTool(
          "yolo-full",
          { toolName, input: { command: "nixos-agent-apply" } },
          "/tmp",
          { unknownTools: "block", bash: "allow" },
        ).action,
        "ask",
      );
    }
  } finally {
    if (previousProfile === undefined) delete process.env.PI_LAUNCH_PROFILE;
    else process.env.PI_LAUNCH_PROFILE = previousProfile;
  }
});

test("Agent-Busy wird strukturiert gemeldet; Desktopfehler startet keinen Prozess", async () => {
  const previousAudit = process.env.PI_SYSTEM_AUDIT_DIR;
  const temp = mkdtempSync(path.join(tmpdir(), "pi-system-control-errors-"));
  process.env.PI_SYSTEM_AUDIT_DIR = path.join(temp, "audit");
  let count = 0;
  const busy = register("system", async () => {
    count += 1;
    const error = new Error("busy");
    error.code = 75;
    throw error;
  });
  const result = await busy
    .get("nixos_apply")
    .execute("id", {}, undefined, () => {}, {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /busy/);
  assert.equal(count, 1);
  const previous = process.env.WAYLAND_DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  try {
    const noDesktop = register("system", async () => {
      count += 1;
      return { stdout: "", stderr: "" };
    });
    const failure = await noDesktop
      .get("desktop_state")
      .execute("id", { what: "monitors" }, undefined, () => {}, {});
    assert.equal(failure.isError, true);
    assert.equal(count, 1);
    const completedBusyJob = register("system", async () => ({
      stdout: "ExecMainStatus=75\n",
      stderr: "",
    }));
    const busyStatus = await completedBusyJob
      .get("system_job")
      .execute(
        "id",
        { id: "pi-job-12345678-1234-1234-1234-123456789abc", action: "status" },
        undefined,
        () => {},
        {},
      );
    assert.equal(busyStatus.isError, true);
    assert.equal(busyStatus.details.exit, 75);
    assert.match(busyStatus.content[0].text, /busy/);
  } finally {
    if (previous !== undefined) process.env.WAYLAND_DISPLAY = previous;
    if (previousAudit === undefined) delete process.env.PI_SYSTEM_AUDIT_DIR;
    else process.env.PI_SYSTEM_AUDIT_DIR = previousAudit;
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Audit redigiert Argumente, setzt Modi und rotiert bei 1 MiB", async () => {
  const previousAudit = process.env.PI_SYSTEM_AUDIT_DIR;
  const temp = mkdtempSync(path.join(tmpdir(), "pi-system-control-audit-"));
  const file = path.join(temp, "state", "audit.jsonl");
  process.env.PI_SYSTEM_AUDIT_DIR = path.dirname(file);
  try {
    const tools = register("system", async () => ({
      stdout:
        "Bearer abcdefghijklmnopqrstuvwxyz123456 api_key=token-value-that-must-hide",
      stderr: "",
    }));
    const result = await tools
      .get("nixos_status")
      .execute("id", {}, undefined, () => {}, {});
    assert.equal(
      result.content[0].text.includes("abcdefghijklmnopqrstuvwxyz123456"),
      false,
    );
    assert.equal(
      result.content[0].text.includes("token-value-that-must-hide"),
      false,
    );
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const log = readFileSync(file, "utf8");
    assert.equal(
      log.includes("Bearer abcdefghijklmnopqrstuvwxyz123456"),
      false,
    );
    assert.equal(log.includes("nixos_status"), true);
    assert.equal(log.includes("argsDigest"), true);
    assert.equal(log.includes("outcome"), true);
    assert.equal(log.includes("stdout"), false);
    assert.equal(log.includes("sensitive-test-value"), false);
    assert.equal(log.includes("sshd.service"), false);
    const largeOutput = register("system", async () => ({
      stdout: "x".repeat(20_000),
      stderr: "",
    }));
    const bounded = await largeOutput
      .get("nixos_status")
      .execute("id", {}, undefined, () => {}, {});
    assert.equal(bounded.content[0].text.length, 16_000);
    writeFileSync(file, `${"x".repeat(1024 * 1024)}\n`);
    await tools.get("nixos_status").execute("id", {}, undefined, () => {}, {});
    assert.equal(statSync(`${file}.1`).size > 1024 * 1024, true);
    assert.equal(statSync(file).size < 1024, true);
    const denied = await audit.auditSystemDenial("user_service", {
      unit: "waybar.service",
      action: "stop",
      text: "private",
    });
    assert.equal(denied, undefined);
    const entries = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((entry) => JSON.parse(entry));
    assert.equal(entries.at(-1).outcome, "denied");
    assert.equal(JSON.stringify(entries).includes("private"), false);
    assert.equal(JSON.stringify(entries).includes("waybar.service"), false);
  } finally {
    if (previousAudit === undefined) delete process.env.PI_SYSTEM_AUDIT_DIR;
    else process.env.PI_SYSTEM_AUDIT_DIR = previousAudit;
    rmSync(temp, { recursive: true, force: true });
  }
});
