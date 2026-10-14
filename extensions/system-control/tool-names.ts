export const SYSTEM_CONTROL_TOOL = {
  systemUnitStatus: "system_unit_status",
  systemJournal: "system_journal",
  nixosStatus: "nixos_status",
  desktopState: "desktop_state",
  audioStatus: "audio_status",
  desktopSwitchWorkspace: "desktop_switch_workspace",
  desktopFocusWindow: "desktop_focus_window",
  audioSetVolume: "audio_set_volume",
  notify: "notify",
  userService: "user_service",
  nixosBuild: "nixos_build",
  nixosApply: "nixos_apply",
  systemJob: "system_job",
} as const;

export const SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS = {
  read: [
    SYSTEM_CONTROL_TOOL.systemUnitStatus,
    SYSTEM_CONTROL_TOOL.systemJournal,
    SYSTEM_CONTROL_TOOL.nixosStatus,
    SYSTEM_CONTROL_TOOL.desktopState,
    SYSTEM_CONTROL_TOOL.audioStatus,
  ],
  userMutation: [
    SYSTEM_CONTROL_TOOL.desktopSwitchWorkspace,
    SYSTEM_CONTROL_TOOL.desktopFocusWindow,
    SYSTEM_CONTROL_TOOL.audioSetVolume,
    SYSTEM_CONTROL_TOOL.notify,
    SYSTEM_CONTROL_TOOL.userService,
    SYSTEM_CONTROL_TOOL.nixosBuild,
  ],
  privileged: [SYSTEM_CONTROL_TOOL.nixosApply],
  job: [SYSTEM_CONTROL_TOOL.systemJob],
} as const;

export const SYSTEM_CONTROL_READ_TOOLS = new Set<string>(
  SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.read,
);
export const SYSTEM_CONTROL_USER_MUTATION_TOOLS = new Set<string>(
  SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.userMutation,
);
export const SYSTEM_CONTROL_PRIVILEGED_TOOLS = new Set<string>(
  SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.privileged,
);
export const SYSTEM_CONTROL_JOB_TOOLS = new Set<string>(
  SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.job,
);

export const SYSTEM_CONTROL_TOOL_NAME_SET = new Set<string>([
  ...SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.read,
  ...SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.userMutation,
  ...SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.privileged,
  ...SYSTEM_CONTROL_TOOL_NAMES_BY_CLASS.job,
]);
