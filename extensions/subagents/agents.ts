import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  PermissionLevel,
  WriteOverride,
} from "../shared/workflow-status.ts";

export type AgentScope = "user" | "project" | "both";
export type ThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SandboxMode = "none" | "git-worktree";
/** #58/#59: "inherit" (default when model/thinking is absent) takes the
 * main agent's current model/thinking level at spawn time. "override"
 * (default when the field is set) keeps the profile's own fixed value. */
export type ModelMode = "inherit" | "override";
export type ThinkingMode = "inherit" | "override";

export interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  /** Tool names from frontmatter that are not known pi tools (#50). Kept for
   * /subagent-doctor reporting; not passed to the child process. */
  invalidTools: string[];
  model?: string;
  modelMode: ModelMode;
  /** Set when a declared modelMode value was invalid; reported by
   * /subagent-doctor instead of failing silently. */
  modelModeWarning?: string;
  /** #54: fallback models tried after provider/model failures only. */
  fallbackModels: string[];
  thinking?: ThinkingLevel;
  thinkingMode: ThinkingMode;
  thinkingModeWarning?: string;
  permission: PermissionLevel;
  /** Original frontmatter value before normalization – used for elevated-permission detection (#36). */
  rawPermission: string | undefined;
  writeOverride: WriteOverride;
  timeoutMs: number;
  /** #51: set when the declared timeoutMs was invalid or clamped to
   * MAX_TIMEOUT_MS; reported by /subagent-doctor. */
  timeoutMsWarning?: string;
  /** #46: project-relative or absolute paths the agent may write to. Empty
   * means unrestricted (subject to parent-side confirmation). */
  allowedPaths: string[];
  /** #53: required output sections (Markdown heading or "Section:" label). */
  requiredSections: string[];
  /** #52: requested sandbox mode. git-worktree is parsed but blocked until
   * full worktree isolation is implemented. */
  sandboxMode: SandboxMode;
  sandboxModeWarning?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface SkippedAgentFile {
  filePath: string;
  reason: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  skipped: SkippedAgentFile[];
  userAgentsDir: string;
  projectAgentsDir: string | null;
}

const DEFAULT_TOOLS = ["read", "grep", "find", "ls"];
// #50: Tool names an agent may declare. These are the built-in pi tools a
// subagent child can be allowed to use via `--tools`. "subagent" is excluded
// on purpose (recursion guard) and extension-only tools are not accepted in
// agent frontmatter.
const ALLOWED_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
]);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// #51: hard upper bound for an agent's declared timeoutMs. Larger declared
// values are clamped down (and reported by /subagent-doctor) so a misconfigured
// agent cannot hold a slot open indefinitely.
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const CONFIG_DIR_NAME = ".pi";
// #36: Subagent permissions are limited to safe levels. full-access and yolo
// require explicit TUI confirmation via confirmElevatedPermission().
const VALID_PERMISSIONS = new Set<PermissionLevel>([
  "read-only",
  "read-bash",
  "test-bash",
  "read-write",
]);
const ELEVATED_PERMISSIONS = new Set<PermissionLevel>(["full-access", "yolo"]);
const VALID_WRITE_OVERRIDES = new Set<WriteOverride>([
  "inherit",
  "block",
  "plan-file-only",
]);
const VALID_THINKING = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const VALID_SANDBOX_MODES = new Set<SandboxMode>(["none", "git-worktree"]);
const VALID_MODEL_MODES = new Set<ModelMode>(["inherit", "override"]);
const VALID_THINKING_MODES = new Set<ThinkingMode>(["inherit", "override"]);

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? path.resolve(process.env.PI_CODING_AGENT_DIR)
    : path.join(os.homedir(), ".pi", "agent");
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const open = /^---\r?\n/.exec(content);
  if (!open) {
    return { frontmatter: {}, body: content };
  }
  const rest = content.slice(open[0].length);
  const close = /\r?\n---(?:\r?\n|$)/.exec(rest);
  if (!close) return { frontmatter: {}, body: content };
  const raw = rest.slice(0, close.index).trim();
  const body = rest.slice(close.index + close[0].length);
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) frontmatter[match[1]] = match[2].trim();
  }
  return { frontmatter, body };
}

function splitCsv(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

function permissionFromTools(tools: string[]): PermissionLevel {
  if (tools.includes("write") || tools.includes("edit")) return "read-write";
  if (tools.includes("bash")) return "read-bash";
  return "read-only";
}

function normalizePermission(
  raw: string | undefined,
  tools: string[],
): PermissionLevel {
  if (raw && VALID_PERMISSIONS.has(raw as PermissionLevel)) {
    return raw as PermissionLevel;
  }
  // #36: Elevated permissions (full-access, yolo) are degraded to read-write.
  // The caller (index.ts) must obtain explicit TUI confirmation before spawning.
  if (raw && ELEVATED_PERMISSIONS.has(raw as PermissionLevel)) {
    return "read-write";
  }
  return permissionFromTools(tools);
}

/** Returns true if the raw permission would need elevated confirmation. */
export function isElevatedPermission(raw: string | undefined): boolean {
  return raw != null && ELEVATED_PERMISSIONS.has(raw as PermissionLevel);
}

/** #46: an agent that can write files (write/edit tool) needs write-scoping. */
export function isWriteCapable(agent: AgentConfig): boolean {
  return agent.tools.some((t) => t === "write" || t === "edit");
}

function normalizeWriteOverride(raw: string | undefined): WriteOverride {
  if (raw && VALID_WRITE_OVERRIDES.has(raw as WriteOverride)) {
    return raw as WriteOverride;
  }
  return "block";
}

function normalizeThinking(raw: string | undefined): ThinkingLevel | undefined {
  return raw && VALID_THINKING.has(raw as ThinkingLevel)
    ? (raw as ThinkingLevel)
    : undefined;
}

function normalizeSandboxMode(raw: string | undefined): {
  sandboxMode: SandboxMode;
  sandboxModeWarning?: string;
} {
  if (!raw) return { sandboxMode: "none" };
  if (VALID_SANDBOX_MODES.has(raw as SandboxMode)) {
    return { sandboxMode: raw as SandboxMode };
  }
  return {
    sandboxMode: "none",
    sandboxModeWarning: `invalid sandboxMode "${raw}", using none`,
  };
}

/** #58/#59: derive modelMode/thinkingMode. An explicit frontmatter value
 * wins; otherwise the presence of model/thinking decides the default. */
function normalizeModelMode(
  raw: string | undefined,
  hasModel: boolean,
): { modelMode: ModelMode; modelModeWarning?: string } {
  if (!raw) return { modelMode: hasModel ? "override" : "inherit" };
  if (VALID_MODEL_MODES.has(raw as ModelMode)) {
    return { modelMode: raw as ModelMode };
  }
  const fallback: ModelMode = hasModel ? "override" : "inherit";
  return {
    modelMode: fallback,
    modelModeWarning: `invalid modelMode "${raw}", using ${fallback}`,
  };
}

function normalizeThinkingMode(
  raw: string | undefined,
  hasThinking: boolean,
): { thinkingMode: ThinkingMode; thinkingModeWarning?: string } {
  if (!raw) return { thinkingMode: hasThinking ? "override" : "inherit" };
  if (VALID_THINKING_MODES.has(raw as ThinkingMode)) {
    return { thinkingMode: raw as ThinkingMode };
  }
  const fallback: ThinkingMode = hasThinking ? "override" : "inherit";
  return {
    thinkingMode: fallback,
    thinkingModeWarning: `invalid thinkingMode "${raw}", using ${fallback}`,
  };
}

function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
): { agents: AgentConfig[]; skipped: SkippedAgentFile[] } {
  const agents: AgentConfig[] = [];
  const skipped: SkippedAgentFile[] = [];
  if (!fs.existsSync(dir)) return { agents, skipped };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { agents, skipped };
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      skipped.push({ filePath, reason: "file is not readable" });
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) {
      const missing = [
        frontmatter.name ? undefined : "name",
        frontmatter.description ? undefined : "description",
      ]
        .filter(Boolean)
        .join(" and ");
      skipped.push({
        filePath,
        reason: `frontmatter is missing ${missing}`,
      });
      continue;
    }

    // Subagenten dürfen keine weiteren Subagenten spawnen (Rekursionsbremse);
    // ein in der Frontmatter deklariertes "subagent"-Tool wird entfernt.
    // #50: unbekannte Tool-Namen werden verworfen und für /subagent-doctor
    // notiert (invalidTools), statt sie ungefiltert an den Child-Prozess
    // weiterzureichen.
    const declaredTools = splitCsv(frontmatter.tools) ?? DEFAULT_TOOLS;
    const tools: string[] = [];
    const invalidTools: string[] = [];
    for (const tool of declaredTools) {
      if (tool === "subagent") continue;
      if (ALLOWED_TOOLS.has(tool)) {
        tools.push(tool);
      } else {
        invalidTools.push(tool);
      }
    }
    if (tools.length === 0) tools.push(...DEFAULT_TOOLS);
    // #51: clamp the declared timeout and record a warning for invalid/clamped
    // values so /subagent-doctor can surface them.
    const declaredTimeoutMs = Number.parseInt(frontmatter.timeoutMs ?? "", 10);
    let timeoutMs: number;
    let timeoutMsWarning: string | undefined;
    if (!Number.isFinite(declaredTimeoutMs) || declaredTimeoutMs <= 0) {
      timeoutMs = DEFAULT_TIMEOUT_MS;
      if (frontmatter.timeoutMs) {
        timeoutMsWarning = `invalid timeoutMs "${frontmatter.timeoutMs}", using default ${DEFAULT_TIMEOUT_MS}ms`;
      }
    } else if (declaredTimeoutMs > MAX_TIMEOUT_MS) {
      timeoutMs = MAX_TIMEOUT_MS;
      timeoutMsWarning = `timeoutMs ${declaredTimeoutMs}ms capped to ${MAX_TIMEOUT_MS}ms`;
    } else {
      timeoutMs = declaredTimeoutMs;
    }
    const { sandboxMode, sandboxModeWarning } = normalizeSandboxMode(
      frontmatter.sandboxMode,
    );
    const thinking = normalizeThinking(frontmatter.thinking);
    const { modelMode, modelModeWarning } = normalizeModelMode(
      frontmatter.modelMode,
      frontmatter.model !== undefined,
    );
    const { thinkingMode, thinkingModeWarning } = normalizeThinkingMode(
      frontmatter.thinkingMode,
      thinking !== undefined,
    );
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools,
      invalidTools,
      model: frontmatter.model,
      modelMode,
      modelModeWarning,
      fallbackModels: splitCsv(frontmatter.fallbackModels) ?? [],
      thinking,
      thinkingMode,
      thinkingModeWarning,
      permission: normalizePermission(frontmatter.permission, tools),
      rawPermission: frontmatter.permission,
      writeOverride: normalizeWriteOverride(frontmatter.writeOverride),
      timeoutMs,
      timeoutMsWarning,
      allowedPaths: splitCsv(frontmatter.allowedPaths) ?? [],
      requiredSections: splitCsv(frontmatter.requiredSections) ?? [],
      sandboxMode,
      sandboxModeWarning,
      systemPrompt: body.trim(),
      source,
      filePath,
    });
  }
  return { agents, skipped };
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
    if (isDirectory(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function discoverAgents(
  cwd: string,
  scope: AgentScope = "user",
): AgentDiscoveryResult {
  const userAgentsDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const empty: { agents: AgentConfig[]; skipped: SkippedAgentFile[] } = {
    agents: [],
    skipped: [],
  };
  const userLoad =
    scope === "project" ? empty : loadAgentsFromDir(userAgentsDir, "user");
  const projectLoad =
    scope === "user" || !projectAgentsDir
      ? empty
      : loadAgentsFromDir(projectAgentsDir, "project");

  const byName = new Map<string, AgentConfig>();
  if (scope === "project") {
    for (const agent of projectLoad.agents) byName.set(agent.name, agent);
  } else {
    for (const agent of userLoad.agents) byName.set(agent.name, agent);
    if (scope === "both") {
      for (const agent of projectLoad.agents) byName.set(agent.name, agent);
    }
  }

  return {
    agents: Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    skipped: [...userLoad.skipped, ...projectLoad.skipped],
    userAgentsDir,
    projectAgentsDir,
  };
}

export function formatAgentList(agents: AgentConfig[]): string {
  return agents.length === 0
    ? "none"
    : agents
        .map(
          (agent) =>
            `${agent.name} (${agent.source}, ${agent.permission}): ${agent.description}`,
        )
        .join("\n");
}
