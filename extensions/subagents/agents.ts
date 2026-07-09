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

export interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: ThinkingLevel;
  permission: PermissionLevel;
  /** Original frontmatter value before normalization – used for elevated-permission detection (#36). */
  rawPermission: string | undefined;
  writeOverride: WriteOverride;
  timeoutMs: number;
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
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
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
    const tools = (splitCsv(frontmatter.tools) ?? DEFAULT_TOOLS).filter(
      (tool) => tool !== "subagent",
    );
    if (tools.length === 0) tools.push(...DEFAULT_TOOLS);
    const timeoutMs = Number.parseInt(frontmatter.timeoutMs ?? "", 10);
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools,
      model: frontmatter.model,
      thinking: normalizeThinking(frontmatter.thinking),
      permission: normalizePermission(frontmatter.permission, tools),
      rawPermission: frontmatter.permission,
      writeOverride: normalizeWriteOverride(frontmatter.writeOverride),
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? timeoutMs
          : DEFAULT_TIMEOUT_MS,
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
