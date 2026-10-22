import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

const UNIT = /^(?!-)[A-Za-z0-9_.@:-]{1,120}\.service$/;
const SYSTEM = /^\/nix\/store\/[a-z0-9]{32}-nixos-system-[A-Za-z0-9+._-]+$/;
const JOB = /^pi-job-[0-9a-f-]{36}$/;

function runCommand(file, args, options = {}) {
  const env = Object.fromEntries(
    [
      "HOME",
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
      "WAYLAND_DISPLAY",
      "HYPRLAND_INSTANCE_SIGNATURE",
    ]
      .filter((name) => typeof (options.env ?? process.env)[name] === "string")
      .map((name) => [name, (options.env ?? process.env)[name]]),
  );
  return String(
    (options.exec ?? execFileSync)(`/run/current-system/sw/bin/${file}`, args, {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 16384,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

export function readApplyJob(jobId, options = {}) {
  if (typeof jobId !== "string" || !JOB.test(jobId))
    throw new Error("Invalid apply job ID");
  const output = runCommand(
    "systemctl",
    [
      "--user",
      "show",
      "--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,InvocationID",
      "--",
      `${jobId}.service`,
    ],
    options,
  );
  const fields = Object.fromEntries(
    output
      .trim()
      .split("\n")
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  if (
    fields.LoadState !== "loaded" ||
    !/^[a-f0-9]{32}$/.test(fields.InvocationID ?? "")
  )
    throw new Error("Apply job evidence unavailable");
  const failed =
    fields.ActiveState === "failed" ||
    (fields.Result && fields.Result !== "success");
  return {
    completed:
      failed ||
      (fields.ActiveState === "active" && fields.SubState === "exited"),
    passed:
      fields.ActiveState === "active" &&
      fields.SubState === "exited" &&
      fields.Result === "success" &&
      fields.ExecMainStatus === "0",
    invocationId: fields.InvocationID,
  };
}

// Release only the exact, already completed transient job whose evidence is
// persisted in a terminal run. Running/failed/replaced units are never stopped.
export function releaseApplyJob(jobId, invocationId, options = {}) {
  try {
    const current = readApplyJob(jobId, options);
    if (
      !current.completed ||
      !current.passed ||
      current.invocationId !== invocationId
    )
      return false;
    runCommand(
      "systemctl",
      ["--user", "stop", "--", `${jobId}.service`],
      options,
    );
    return true;
  } catch {
    return false;
  }
}

// Closed goal predicates, never a command or an evaluator supplied by a model.
export function normalizeSystemGoal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("A system goal is required");
  const keys = Object.keys(value).sort().join(",");
  if (
    value.kind === "user-service" &&
    keys === "kind,operation,unit" &&
    UNIT.test(value.unit) &&
    ["start", "stop", "restart"].includes(value.operation)
  )
    return { kind: value.kind, unit: value.unit, operation: value.operation };
  if (
    value.kind === "workspace" &&
    keys === "kind,workspace" &&
    Number.isInteger(value.workspace) &&
    value.workspace >= 1 &&
    value.workspace <= 99
  )
    return { kind: value.kind, workspace: value.workspace };
  if (
    value.kind === "nixos-generation" &&
    keys === "expectedSystem,kind" &&
    typeof value.expectedSystem === "string" &&
    SYSTEM.test(value.expectedSystem)
  )
    return { kind: value.kind, expectedSystem: value.expectedSystem };
  throw new Error("Unsupported or invalid system goal");
}

export function systemGoalForTool(toolName, args = {}) {
  try {
    if (toolName === "user_service")
      return normalizeSystemGoal({
        kind: "user-service",
        unit: args.unit,
        operation: args.action,
      });
    if (toolName === "desktop_switch_workspace")
      return normalizeSystemGoal({ kind: "workspace", workspace: args.n });
    if (toolName === "nixos_apply" && args.expectedSystem)
      return normalizeSystemGoal({
        kind: "nixos-generation",
        expectedSystem: args.expectedSystem,
      });
  } catch {
    /* Invalid arguments cannot acquire a verification target. */
  }
  return undefined;
}

export function readSystemGoal(value, options = {}) {
  const goal = normalizeSystemGoal(value);
  const run = (file, args) => runCommand(file, args, options);
  if (goal.kind === "user-service") {
    const output = run("systemctl", [
      "--user",
      "show",
      "--property=LoadState,ActiveState,InvocationID",
      "--",
      goal.unit,
    ]);
    const fields = Object.fromEntries(
      output
        .trim()
        .split("\n")
        .map((line) => {
          const split = line.indexOf("=");
          return [line.slice(0, split), line.slice(split + 1)];
        }),
    );
    if (
      fields.LoadState !== "loaded" ||
      !fields.ActiveState ||
      !/^(?:[a-f0-9]{32})?$/.test(fields.InvocationID ?? "invalid")
    )
      throw new Error("Unit readback is missing or invalid");
    const expected = goal.operation === "stop" ? "inactive" : "active";
    return {
      passed: fields.ActiveState === expected,
      observation: {
        activeState: fields.ActiveState,
        invocationId: fields.InvocationID,
      },
      source: `systemd-user:${goal.unit}`,
    };
  }
  if (goal.kind === "workspace") {
    const workspace = JSON.parse(run("hyprctl", ["-j", "activeworkspace"]));
    if (!Number.isInteger(workspace?.id))
      throw new Error("Invalid workspace readback");
    return {
      passed: workspace.id === goal.workspace,
      observation: { workspace: workspace.id },
      source: "hyprland:activeworkspace",
    };
  }
  const currentSystem = (options.realpath ?? realpathSync)(
    "/run/current-system",
  );
  if (!SYSTEM.test(currentSystem))
    throw new Error("Invalid running NixOS system path");
  return {
    passed: currentSystem === goal.expectedSystem,
    observation: { currentSystem },
    source: "/run/current-system",
  };
}
