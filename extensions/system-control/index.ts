import { readFileGoal } from "../../frontend-server/file-readback.mjs";
import { readSystemGoal } from "../../frontend-server/state-readback.mjs";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { getPiLaunchProfile } from "../shared/profile.ts";
import { strictCategoriesForRequest } from "../system-context/collector.mjs";
import { audit, digest } from "./audit.ts";
import {
  SYSTEM_CONTROL_TOOL,
  SYSTEM_CONTROL_TOOL_NAME_SET,
} from "./tool-names.ts";

const execFile = promisify(nodeExecFile);
const LIMIT = 16_000;
const ALLOWED_UNITS = new Set([
  "waybar.service",
  "mako.service",
  "hyprpaper.service",
  "walker.service",
  "elephant.service",
  "quickshell.service",
  "pipewire.service",
  "pipewire-pulse.service",
  "wireplumber.service",
]);
const PRIORITIES = new Set([
  "emerg",
  "alert",
  "crit",
  "err",
  "warning",
  "notice",
  "info",
  "debug",
]);
const UNIT = /^(?!-)[A-Za-z0-9_.@:-]{1,120}\.(?:service|timer|socket|target)$/;
const JOB = /^pi-job-[0-9a-f-]{36}$/;
const ADDRESS = /^0x[0-9a-fA-F]{1,16}$/;
const TOKEN_PATTERNS = [
  /\b(?:sk|gh[pousr])-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /\b[A-Z0-9._%+-]+:[A-Za-z0-9/_+=-]{16,}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*["']?[^\s"',;]+/gi,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export type Exec = (
  file: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;
const defaultExec: Exec = async (file, args, options) => {
  const result = await execFile(file, args, options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

function strictObject(properties: Record<string, TSchema>) {
  return Type.Object(properties, { additionalProperties: false });
}
function validParams(schema: TSchema, value: unknown): boolean {
  const shape = schema as unknown as {
    type?: string;
    properties?: Record<string, TSchema>;
    required?: string[];
    additionalProperties?: boolean;
    pattern?: string;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
  };
  if (shape.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const candidate = value as Record<string, unknown>;
    const properties = shape.properties ?? {};
    if (
      shape.additionalProperties === false &&
      Object.keys(candidate).some((key) => !(key in properties))
    )
      return false;
    if ((shape.required ?? []).some((key) => !(key in candidate))) return false;
    return Object.entries(candidate).every(([key, entry]) =>
      validParams(properties[key], entry),
    );
  }
  if (shape.type === "string") {
    return (
      typeof value === "string" &&
      (shape.minLength === undefined || value.length >= shape.minLength) &&
      (shape.maxLength === undefined || value.length <= shape.maxLength) &&
      (!shape.pattern || new RegExp(shape.pattern).test(value)) &&
      (!shape.enum || shape.enum.includes(value))
    );
  }
  if (shape.type === "integer" || shape.type === "number") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (shape.type !== "integer" || Number.isInteger(value)) &&
      (shape.minimum === undefined || value >= shape.minimum) &&
      (shape.maximum === undefined || value <= shape.maximum)
    );
  }
  return false;
}
const Empty = strictObject({});
const UnitParams = strictObject({
  unit: Type.String({ pattern: UNIT.source }),
});
const JournalParams = strictObject({
  unit: Type.String({ pattern: UNIT.source }),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 30 })),
  priority: Type.Optional(Type.String({ enum: [...PRIORITIES] })),
});
const DesktopParams = strictObject({
  what: Type.String({ enum: ["workspaces", "monitors", "active", "clients"] }),
});
const WorkspaceParams = strictObject({
  n: Type.Integer({ minimum: 1, maximum: 99 }),
});
const AddressParams = strictObject({
  address: Type.String({ pattern: ADDRESS.source }),
});
const VolumeParams = strictObject({
  target: Type.String({ enum: ["sink", "source"] }),
  volume: Type.Number({ minimum: 0, maximum: 1.5 }),
});
const NotifyParams = strictObject({
  title: Type.String({ maxLength: 120 }),
  text: Type.String({ maxLength: 1000 }),
});
const ServiceParams = strictObject({
  action: Type.String({ enum: ["start", "stop", "restart"] }),
  unit: Type.String({ enum: [...ALLOWED_UNITS] }),
});
const JobParams = strictObject({
  id: Type.String({ pattern: JOB.source }),
  action: Type.String({ enum: ["status", "output", "stop"] }),
});

function redact(value: string): string {
  return TOKEN_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[REDACTED]"),
    value,
  ).slice(0, LIMIT);
}
function minimalEnv(): NodeJS.ProcessEnv {
  const keys = [
    "HOME",
    "LANG",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "WAYLAND_DISPLAY",
    "HYPRLAND_INSTANCE_SIGNATURE",
  ];
  const env: NodeJS.ProcessEnv = { PATH: "/run/current-system/sw/bin" };
  for (const key of keys)
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}
function desktopRequired(): string | undefined {
  if (
    !process.env.XDG_RUNTIME_DIR ||
    !process.env.WAYLAND_DISPLAY ||
    !process.env.HYPRLAND_INSTANCE_SIGNATURE
  )
    return "Desktop-Umgebung fehlt (XDG_RUNTIME_DIR/WAYLAND_DISPLAY/HYPRLAND_INSTANCE_SIGNATURE).";
  return undefined;
}
function makeTool(
  pi: ExtensionAPI,
  exec: Exec,
  definition: {
    name: string;
    label: string;
    description: string;
    parameters: ReturnType<typeof strictObject>;
    run: (
      params: Record<string, unknown>,
      ctx: ExtensionContext,
    ) => Promise<{
      file: string;
      args: string[];
      jobId?: string;
      transform?: (text: string) => string;
    }>;
  },
) {
  if (!SYSTEM_CONTROL_TOOL_NAME_SET.has(definition.name))
    throw new Error(`Unknown system-control tool name: ${definition.name}`);
  pi.registerTool({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    async execute(_id, params, _signal, _update, ctx) {
      const started = Date.now();
      let outcome = "ok";
      let exit: number | null = 0;
      let jobId: string | undefined;
      if (!validParams(definition.parameters, params)) {
        outcome = "denied";
        const auditError = await audit({
          ts: new Date().toISOString(),
          tool: definition.name,
          argsDigest: digest(params),
          outcome,
          exit: null,
          durationMs: Date.now() - started,
        });
        return {
          content: [
            {
              type: "text",
              text: [
                "Ungültige Parameter; kein Prozess wurde gestartet.",
                auditError,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: { outcome, exit: null, auditError },
          isError: true,
        };
      }
      try {
        const invocation = await definition.run(
          params as Record<string, unknown>,
          ctx,
        );
        jobId = invocation.jobId;
        const result = await exec(invocation.file, invocation.args, {
          timeout: 15_000,
          env: minimalEnv(),
          maxBuffer: LIMIT * 4,
        });
        let output = invocation.transform
          ? invocation.transform(result.stdout)
          : result.stdout;
        output = redact(
          `${output}${result.stderr ? `\n${result.stderr}` : ""}`,
        );
        if (
          definition.name === "system_job" &&
          params.action === "status" &&
          /(?:^|\n)ExecMainStatus=75(?:\n|$)/.test(output)
        ) {
          outcome = "error";
          exit = 75;
          output = `busy: nixos-agent meldet bereits laufenden Auftrag.\n${output}`;
        }
        if (
          definition.name === "nixos_build" ||
          definition.name === "nixos_apply"
        )
          output = `Job gestartet: ${jobId}`;
        const auditError = await audit({
          ts: new Date().toISOString(),
          tool: definition.name,
          argsDigest: digest(params),
          outcome,
          exit,
          durationMs: Date.now() - started,
          ...(jobId ? { jobId } : {}),
        });
        return {
          content: [
            {
              type: "text",
              text: [output || "(keine Ausgabe)", auditError]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: { outcome, exit, jobId, auditError },
          ...(outcome === "error" ? { isError: true } : {}),
        };
      } catch (error) {
        outcome = "error";
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : undefined;
        exit =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "number"
            ? error.code
            : code === "75"
              ? 75
              : null;
        const processOutput =
          typeof error === "object" && error !== null
            ? ["stdout", "stderr"]
                .map((key) =>
                  key in error
                    ? String((error as Record<string, unknown>)[key] ?? "")
                    : "",
                )
                .filter(Boolean)
                .join("\n")
            : "";
        const message = redact(
          code === "75"
            ? "busy: nixos-agent meldet bereits laufenden Auftrag."
            : [
                error instanceof Error ? error.message : String(error),
                processOutput,
              ]
                .filter(Boolean)
                .join("\n"),
        );
        const auditError = await audit({
          ts: new Date().toISOString(),
          tool: definition.name,
          argsDigest: digest(params),
          outcome,
          exit,
          durationMs: Date.now() - started,
          ...(jobId ? { jobId } : {}),
        });
        return {
          content: [
            {
              type: "text",
              text: [message, auditError].filter(Boolean).join("\n"),
            },
          ],
          details: { outcome, exit, auditError },
          isError: true,
        };
      }
    },
  });
}

export function registerSystemControl(
  pi: ExtensionAPI,
  options: { profile?: () => "project" | "system"; exec?: Exec } = {},
): void {
  const profile = (options.profile ?? getPiLaunchProfile)();
  const run = options.exec ?? defaultExec;
  const defs = [
    {
      name: SYSTEM_CONTROL_TOOL.systemUnitStatus,
      label: "Unit-Status",
      description: "Liest den Status einer systemd-Unit.",
      parameters: UnitParams,
      run: async (p: Record<string, unknown>) => ({
        file: "systemctl",
        args: ["status", "--no-pager", "--lines=20", "--", String(p.unit)],
      }),
    },
    {
      name: SYSTEM_CONTROL_TOOL.systemJournal,
      label: "Journal",
      description: "Liest begrenzte Journalzeilen einer Unit.",
      parameters: JournalParams,
      run: async (p: Record<string, unknown>) => ({
        file: "journalctl",
        args: [
          "-u",
          String(p.unit),
          "-n",
          String(p.lines ?? 30),
          "--no-pager",
          ...(p.priority ? ["-p", String(p.priority)] : []),
        ],
      }),
    },
    {
      name: SYSTEM_CONTROL_TOOL.nixosStatus,
      label: "NixOS-Status",
      description: "Liest den Status des NixOS-Agenten.",
      parameters: Empty,
      run: async () => ({ file: "nixos-agent-status", args: [] }),
    },
    {
      name: SYSTEM_CONTROL_TOOL.desktopState,
      label: "Desktopstatus",
      description:
        "Liest Arbeitsflächen, Monitore, Fenster oder das aktive Fenster; Fenstertitel werden nicht ausgegeben.",
      parameters: DesktopParams,
      run: async (p: Record<string, unknown>) => {
        const missing = desktopRequired();
        if (missing) throw new Error(missing);
        const what = String(p.what);
        return {
          file: "hyprctl",
          args: ["-j", what === "active" ? "activewindow" : what],
          transform: (text: string) => {
            try {
              const v = JSON.parse(text);
              if (what === "active") {
                if (!v || typeof v !== "object" || Array.isArray(v))
                  throw new Error("Invalid active window structure");
                return JSON.stringify({
                  class: v.class,
                  workspace: v.workspace,
                  address: v.address,
                });
              }
              if (
                !Array.isArray(v) ||
                v.some(
                  (entry) =>
                    !entry || typeof entry !== "object" || Array.isArray(entry),
                )
              )
                throw new Error("Invalid desktop list structure");
              const fields =
                what === "clients"
                  ? ["address", "class", "workspace"]
                  : what === "workspaces"
                    ? ["id", "name", "monitor", "windows", "hasfullscreen"]
                    : [
                        "id",
                        "name",
                        "width",
                        "height",
                        "refreshRate",
                        "activeWorkspace",
                        "focused",
                      ];
              if (v.some((entry) => fields.some((field) => !(field in entry))))
                throw new Error("Incomplete desktop list structure");
              return JSON.stringify(
                v.map((entry) =>
                  Object.fromEntries(
                    fields
                      .filter((field) => field in entry)
                      .map((field) => [field, entry[field]]),
                  ),
                ),
              );
            } catch {
              return "Ungültige Hyprland-Antwort: unerwartete Struktur.";
            }
          },
        };
      },
    },
    {
      name: SYSTEM_CONTROL_TOOL.audioStatus,
      label: "Audiostatus",
      description: "Liest den PipeWire-Status.",
      parameters: Empty,
      run: async () => ({ file: "wpctl", args: ["status"] }),
    },
    {
      name: SYSTEM_CONTROL_TOOL.desktopSwitchWorkspace,
      label: "Arbeitsfläche wechseln",
      description: "Wechselt die Arbeitsfläche.",
      parameters: WorkspaceParams,
      run: async (p: Record<string, unknown>) => {
        const missing = desktopRequired();
        if (missing) throw new Error(missing);
        return {
          file: "hyprctl",
          args: ["dispatch", `hl.dsp.focus({workspace="${String(p.n)}"})`],
        };
      },
    },
    {
      name: SYSTEM_CONTROL_TOOL.desktopFocusWindow,
      label: "Fenster fokussieren",
      description: "Fokussiert ein Fenster anhand seiner Adresse.",
      parameters: AddressParams,
      run: async (p: Record<string, unknown>) => {
        const missing = desktopRequired();
        if (missing) throw new Error(missing);
        return {
          file: "hyprctl",
          args: [
            "dispatch",
            `hl.dsp.focus({window="address:${String(p.address)}"})`,
          ],
        };
      },
    },
    {
      name: SYSTEM_CONTROL_TOOL.audioSetVolume,
      label: "Lautstärke setzen",
      description: "Setzt die Lautstärke eines Standardgeräts.",
      parameters: VolumeParams,
      run: async (p: Record<string, unknown>) => ({
        file: "wpctl",
        args: [
          "set-volume",
          p.target === "sink"
            ? "@DEFAULT_AUDIO_SINK@"
            : "@DEFAULT_AUDIO_SOURCE@",
          String(p.volume),
        ],
      }),
    },
    {
      name: SYSTEM_CONTROL_TOOL.notify,
      label: "Benachrichtigung",
      description: "Sendet eine Desktop-Benachrichtigung.",
      parameters: NotifyParams,
      run: async (p: Record<string, unknown>) => ({
        file: "notify-send",
        args: ["--", String(p.title), String(p.text)],
      }),
    },
    {
      name: SYSTEM_CONTROL_TOOL.userService,
      label: "Benutzerdienst",
      description:
        "Startet, stoppt oder startet einen erlaubten Benutzerdienst neu.",
      parameters: ServiceParams,
      run: async (p: Record<string, unknown>) => ({
        file: "systemctl",
        args: ["--user", String(p.action), "--", String(p.unit)],
      }),
    },
    ...(
      [SYSTEM_CONTROL_TOOL.nixosBuild, SYSTEM_CONTROL_TOOL.nixosApply] as const
    ).map((name) => ({
      name,
      label:
        name === SYSTEM_CONTROL_TOOL.nixosBuild
          ? "NixOS bauen"
          : "NixOS anwenden",
      description:
        name === SYSTEM_CONTROL_TOOL.nixosBuild
          ? "Startet einen NixOS-Build in einer transienten User-Unit."
          : "Startet die freizugebende NixOS-Apply-Aktion in einer transienten User-Unit.",
      parameters:
        name === SYSTEM_CONTROL_TOOL.nixosApply
          ? strictObject({
              expectedSystem: Type.Optional(
                Type.String({
                  pattern:
                    "^/nix/store/[a-z0-9]{32}-nixos-system-[A-Za-z0-9+._-]+$",
                }),
              ),
            })
          : Empty,
      run: async () => {
        const id = `pi-job-${randomUUID()}`;
        return {
          file: "systemd-run",
          args: [
            "--user",
            ...(name === SYSTEM_CONTROL_TOOL.nixosApply
              ? ["--property=RemainAfterExit=yes"]
              : ["--collect"]),
            "--quiet",
            `--unit=${id}`,
            "--",
            name === SYSTEM_CONTROL_TOOL.nixosBuild
              ? "nixos-agent-build"
              : "nixos-agent-apply",
          ],
          jobId: id,
        };
      },
    })),
    {
      name: SYSTEM_CONTROL_TOOL.systemJob,
      label: "Systemauftrag",
      description: "Liest Status oder Ausgabe eines Auftrags oder stoppt ihn.",
      parameters: JobParams,
      run: async (p: Record<string, unknown>) =>
        p.action === "output"
          ? {
              file: "journalctl",
              args: [
                "--user",
                "-u",
                `${String(p.id)}.service`,
                "-n",
                "200",
                "--no-pager",
              ],
            }
          : p.action === "stop"
            ? {
                file: "systemctl",
                args: ["--user", "stop", "--", `${String(p.id)}.service`],
              }
            : {
                file: "systemctl",
                args: [
                  "--user",
                  "show",
                  "-p",
                  "ActiveState,SubState,Result,ExecMainStatus,InvocationID",
                  "--",
                  `${String(p.id)}.service`,
                ],
              },
    },
  ];
  for (const definition of defs) makeTool(pi, run, definition);
  if (profile !== "system") activateOnSystemRequest(pi);
}

/**
 * Project profile (`pi`): the typed tools exist, but stay out of the active
 * tool list (and so out of the model context) until the person's own prompt
 * asks for system work. Only the prompt decides, never file or tool output, so
 * repository content cannot switch them on. Authorization is unchanged: the
 * permission policy classifies the tools by name and level in every profile.
 * Once activated they stay active for the session to avoid flapping.
 */
function activateOnSystemRequest(pi: ExtensionAPI): void {
  const names = [...SYSTEM_CONTROL_TOOL_NAME_SET];
  let active = false;
  const without = (list: string[]) =>
    list.filter((name) => !SYSTEM_CONTROL_TOOL_NAME_SET.has(name));
  pi.on("session_start", () => {
    active = false;
    pi.setActiveTools(without(pi.getActiveTools()));
  });
  pi.on("before_agent_start", (event) => {
    if (active || event.messageType === "custom") return;
    if (strictCategoriesForRequest(event.prompt).length === 0) return;
    active = true;
    const current = pi.getActiveTools();
    pi.setActiveTools([
      ...current,
      ...names.filter((name) => !current.includes(name)),
    ]);
  });
}

export default function systemControlExtension(pi: ExtensionAPI): void {
  registerSystemControl(pi);
  if (getPiLaunchProfile() === "system")
    pi.registerTool({
      name: "system_state_verify",
      label: "Systemziel unabhängig prüfen",
      description:
        "Independently read the requested user-service state, focused Hyprland window, active workspace, or running NixOS store path. Use after the matching typed mutation. A restart additionally requires a changed invocation observed by the host. Supply expectedSystem to nixos_apply to bind its exact generation goal. Arbitrary shell actions are not covered. Derive expectations from the user's goal, never from the observed state.",
      parameters: Type.Union([
        strictObject({
          kind: Type.Literal("user-service"),
          unit: Type.String({ pattern: UNIT.source }),
          operation: Type.Union([
            Type.Literal("start"),
            Type.Literal("stop"),
            Type.Literal("restart"),
          ]),
        }),
        strictObject({
          kind: Type.Literal("focused-window"),
          address: Type.String({ pattern: ADDRESS.source }),
        }),
        strictObject({
          kind: Type.Literal("workspace"),
          workspace: Type.Integer({ minimum: 1, maximum: 99 }),
        }),
        strictObject({
          kind: Type.Literal("nixos-generation"),
          expectedSystem: Type.String({
            pattern: "^/nix/store/[a-z0-9]{32}-nixos-system-[A-Za-z0-9+._-]+$",
          }),
        }),
      ]),
      async execute(_id, params) {
        const check = readSystemGoal(params);
        return {
          content: [
            {
              type: "text",
              text: check.passed
                ? "Requested system state observed"
                : "Requested system state not observed",
            },
          ],
          details: { stateGoalCheck: params },
          isError: params.kind !== "nixos-generation" && !check.passed,
        };
      },
    });
  if (getPiLaunchProfile() === "system")
    pi.registerTool({
      name: "system_file_verify",
      label: "Dateiziel unabhängig prüfen",
      description:
        "Read back a regular file (max 16 MiB, no symlinks) and compare SHA-256 with the expected goal contents. Use after file mutations; derive the expected digest from the requested target, not from the current file. Use system_state_verify for supported system-state goals. No shell is executed.",
      parameters: Type.Object(
        {
          filePath: Type.String({ minLength: 1 }),
          expectedSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id, params) {
        const goalCheck = readFileGoal(params.filePath, params.expectedSha256);
        return {
          content: [
            {
              type: "text",
              text: goalCheck.passed
                ? "File goal verified by readback"
                : "File goal differs from expected contents",
            },
          ],
          details: { goalCheck },
          isError: !goalCheck.passed,
        };
      },
    });
}
