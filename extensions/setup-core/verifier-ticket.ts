import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkspaceSnapshot } from "../../shared/workspace-snapshot.d.mts";
import type { VerificationTicketSnapshot } from "../shared/verification-capabilities.ts";

export interface VerifierTicket extends VerificationTicketSnapshot {
  /** Lexical cwd used for the preflight snapshot; never supplied by the child. */
  readonly requestCwd: string;
}

export function isVerifierSingleCall(event: ToolCallEvent): boolean {
  if (event.toolName !== "subagent") return false;
  const input = event.input as Record<string, unknown>;
  const action =
    typeof input.action === "string" ? input.action.toLowerCase() : undefined;
  const directVerifier = input.agent === "verifier";
  const taskVerifier = Array.isArray(input.tasks)
    ? input.tasks.some(
        (task) =>
          Boolean(task) &&
          typeof task === "object" &&
          (task as Record<string, unknown>).agent === "verifier",
      )
    : false;
  const chainVerifier = Array.isArray(input.chain)
    ? input.chain.some(
        (step) =>
          Boolean(step) &&
          typeof step === "object" &&
          hasVerifierChainStep(step as Record<string, unknown>),
      )
    : false;
  const executionRequest =
    action === undefined ||
    (action === "single" && directVerifier) ||
    ((action === "parallel" || action === "tasks") && taskVerifier);
  return executionRequest && (directVerifier || taskVerifier || chainVerifier);
}

function hasVerifierChainStep(step: Record<string, unknown>): boolean {
  if (step.agent === "verifier") return true;
  const parallel = step.parallel;
  if (Array.isArray(parallel)) {
    return parallel.some(
      (task) =>
        Boolean(task) &&
        typeof task === "object" &&
        (task as Record<string, unknown>).agent === "verifier",
    );
  }
  return (
    Boolean(parallel) &&
    typeof parallel === "object" &&
    (parallel as Record<string, unknown>).agent === "verifier"
  );
}

/**
 * The verifier contract only binds one package child run. Parallel and chain
 * requests have several results, so accepting them here would bind the ticket
 * to an arbitrary first result.
 */
export function verifierSingleCallIssue(
  event: ToolCallEvent,
): string | undefined {
  if (!isVerifierSingleCall(event)) return undefined;
  const input = event.input as Record<string, unknown>;
  if (
    (Array.isArray(input.tasks) && input.tasks.length > 0) ||
    (Array.isArray(input.chain) && input.chain.length > 0)
  ) {
    return "Verifier-Delegation abgelehnt: Der Ticket-Vertrag unterstützt nur genau einen Single-Run; tasks/chain müssen separat geprüft werden.";
  }
  const action =
    typeof input.action === "string" ? input.action.toLowerCase() : undefined;
  if (action === "parallel" || action === "tasks") {
    return "Verifier-Delegation abgelehnt: Der Ticket-Vertrag unterstützt nur genau einen Single-Run; tasks/chain müssen separat geprüft werden.";
  }
  return undefined;
}

export function canonicalWorkspaceRoot(cwd: string): string | undefined {
  try {
    return realpathSync(cwd);
  } catch {
    return undefined;
  }
}

const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

interface AvailableModel {
  readonly provider?: unknown;
  readonly id?: unknown;
  readonly fullId?: unknown;
}

interface VerifierAgentConfig {
  model?: string;
  thinking?: string | false;
  defaultContext?: "fresh" | "fork";
  disabled?: boolean;
}

interface SubagentSettings {
  defaultModel?: string;
  override?: {
    model?: string | false;
    thinking?: string | false;
    defaultContext?: "fresh" | "fork" | false;
    disabled?: boolean;
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resolveExecutionAgentScope(
  value: unknown,
): "user" | "project" | "both" {
  return value === "user" || value === "project" || value === "both"
    ? value
    : "both";
}

function projectRoot(cwd: string): string | undefined {
  let current = canonicalWorkspaceRoot(cwd) ?? cwd;
  while (true) {
    if (
      isDirectory(join(current, CONFIG_DIR_NAME)) ||
      isDirectory(join(current, ".agents"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function projectAgentDirs(cwd: string): string[] {
  const root = projectRoot(cwd);
  if (!root) return [];
  return [join(root, ".agents"), join(root, CONFIG_DIR_NAME, "agents")].filter(
    isDirectory,
  );
}

function readFrontmatterAgent(path: string): VerifierAgentConfig | undefined {
  try {
    const source = readFileSync(path, "utf8");
    const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatter) return undefined;
    const fields = new Map<string, string>();
    for (const line of frontmatter[1]?.split("\n") ?? []) {
      const match = /^(\w+):\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const value = match[2]!;
      fields.set(
        match[1]!,
        (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value,
      );
    }
    if (fields.get("name") !== "verifier" || !fields.get("description")) {
      return undefined;
    }
    const model = fields.get("model");
    const thinking = fields.get("thinking");
    const defaultContext = fields.get("defaultContext");
    return {
      ...(model ? { model } : {}),
      ...(thinking === "false"
        ? { thinking: false as const }
        : thinking
          ? { thinking }
          : {}),
      ...(defaultContext === "fresh" || defaultContext === "fork"
        ? { defaultContext }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function findVerifierAgentInDir(dir: string): VerifierAgentConfig | undefined {
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>;
  try {
    entries = readdirSync(dir, {
      withFileTypes: true,
      encoding: "utf8",
    }) as typeof entries;
  } catch {
    return undefined;
  }
  let found: VerifierAgentConfig | undefined;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found = findVerifierAgentInDir(path) ?? found;
      continue;
    }
    if (
      (!entry.isFile() && !entry.isSymbolicLink()) ||
      !entry.name.endsWith(".md") ||
      entry.name.endsWith(".chain.md")
    ) {
      continue;
    }
    found = readFrontmatterAgent(path) ?? found;
  }
  return found;
}

function readSubagentSettings(path: string | undefined): SubagentSettings {
  if (!path || !existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const subagents = parsed.subagents;
    if (
      !subagents ||
      typeof subagents !== "object" ||
      Array.isArray(subagents)
    ) {
      return {};
    }
    const value = subagents as Record<string, unknown>;
    const defaultModel =
      typeof value.defaultModel === "string" && value.defaultModel.trim()
        ? value.defaultModel.trim()
        : undefined;
    const overrides = value.agentOverrides;
    const raw =
      overrides && typeof overrides === "object" && !Array.isArray(overrides)
        ? (overrides as Record<string, unknown>).verifier
        : undefined;
    const entry =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    return {
      ...(defaultModel ? { defaultModel } : {}),
      ...(entry
        ? {
            override: {
              ...(typeof entry.model === "string" || entry.model === false
                ? { model: entry.model }
                : {}),
              ...(typeof entry.thinking === "string" || entry.thinking === false
                ? { thinking: entry.thinking }
                : {}),
              ...(entry.defaultContext === "fresh" ||
              entry.defaultContext === "fork" ||
              entry.defaultContext === false
                ? { defaultContext: entry.defaultContext }
                : {}),
              ...(typeof entry.disabled === "boolean"
                ? { disabled: entry.disabled }
                : {}),
            },
          }
        : {}),
    };
  } catch {
    return {};
  }
}

function readVerifierAgent(
  cwd: string,
  scope: unknown,
): VerifierAgentConfig | undefined {
  const resolvedScope = resolveExecutionAgentScope(scope);
  const userPaths = [
    join(getAgentDir(), "agents", "verifier.md"),
    join(homedir(), ".agents", "verifier.md"),
  ];
  const userAgent =
    resolvedScope === "project"
      ? undefined
      : userPaths.reduce<VerifierAgentConfig | undefined>(
          (agent, path) => findVerifierAgentInDir(dirname(path)) ?? agent,
          undefined,
        );
  const projectAgent =
    resolvedScope === "user"
      ? undefined
      : projectAgentDirs(cwd).reduce<VerifierAgentConfig | undefined>(
          (agent, dir) => findVerifierAgentInDir(dir) ?? agent,
          undefined,
        );
  const base = projectAgent ?? userAgent;
  if (!base) return undefined;

  const userSettingsPath = join(getAgentDir(), "settings.json");
  const root = projectRoot(cwd);
  const projectSettingsPath = root
    ? join(root, CONFIG_DIR_NAME, "settings.json")
    : undefined;
  const userSettings =
    resolvedScope === "project" ? {} : readSubagentSettings(userSettingsPath);
  const projectSettings =
    resolvedScope === "user" ? {} : readSubagentSettings(projectSettingsPath);
  const settings = projectSettings.override ? projectSettings : userSettings;
  const result: VerifierAgentConfig = { ...base };
  if (result.model === undefined) {
    const overrideModel = settings.override?.model;
    result.model =
      overrideModel === false
        ? undefined
        : typeof overrideModel === "string"
          ? overrideModel
          : (projectSettings.defaultModel ?? userSettings.defaultModel);
  }
  if (result.thinking === undefined) {
    result.thinking =
      settings.override?.thinking === false
        ? undefined
        : settings.override?.thinking;
  }
  if (result.defaultContext === undefined) {
    const context = settings.override?.defaultContext;
    if (context === "fresh" || context === "fork")
      result.defaultContext = context;
  }
  if (
    settings.override?.disabled !== undefined &&
    result.disabled === undefined
  ) {
    result.disabled = settings.override.disabled;
  }
  return result.disabled ? undefined : result;
}

function normalizeModelSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[._]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripTrailingDateStamp(segment: string): string {
  const dashed = /^(.*)-(\d{4})-(\d{2})-(\d{2})$/.exec(segment);
  if (
    dashed &&
    Number(dashed[2]) >= 1900 &&
    Number(dashed[2]) <= 2099 &&
    Number(dashed[3]) >= 1 &&
    Number(dashed[3]) <= 12 &&
    Number(dashed[4]) >= 1 &&
    Number(dashed[4]) <= 31
  ) {
    return dashed[1];
  }
  const compact = /^(.*)-(\d{4})(\d{2})(\d{2})$/.exec(segment);
  if (
    compact &&
    Number(compact[2]) >= 1900 &&
    Number(compact[2]) <= 2099 &&
    Number(compact[3]) >= 1 &&
    Number(compact[3]) <= 12 &&
    Number(compact[4]) >= 1 &&
    Number(compact[4]) <= 31
  ) {
    return compact[1];
  }
  return segment;
}

function splitThinkingSuffix(model: string): {
  baseModel: string;
  thinkingSuffix: string;
} {
  const colon = model.lastIndexOf(":");
  if (colon === -1 || !THINKING_LEVELS.has(model.slice(colon + 1))) {
    return { baseModel: model, thinkingSuffix: "" };
  }
  return {
    baseModel: model.slice(0, colon),
    thinkingSuffix: model.slice(colon),
  };
}

function resolveModelCandidate(
  model: string,
  available: Array<AvailableModel & { provider: string; id: string }>,
  preferredProvider?: string,
): string {
  const { baseModel, thinkingSuffix } = splitThinkingSuffix(model);
  const exact = available.find(
    (entry) =>
      entry.fullId === baseModel ||
      `${entry.provider}/${entry.id}` === baseModel,
  );
  if (exact) return `${exact.provider}/${exact.id}${thinkingSuffix}`;
  const unqualified = available.filter((entry) => entry.id === baseModel);
  const preferred = unqualified.find(
    (entry) => entry.provider === preferredProvider,
  );
  const direct =
    preferred ?? (unqualified.length === 1 ? unqualified[0] : undefined);
  if (direct) return `${direct.provider}/${direct.id}${thinkingSuffix}`;

  let queryProvider: string | undefined;
  let queryId = baseModel;
  const slash = baseModel.indexOf("/");
  if (slash > 0) {
    queryProvider = normalizeModelSegment(baseModel.slice(0, slash));
    queryId = baseModel.slice(slash + 1);
  } else {
    for (const separator of [":", "."]) {
      const index = baseModel.indexOf(separator);
      if (index <= 0) continue;
      const candidateProvider = normalizeModelSegment(
        baseModel.slice(0, index),
      );
      if (
        available.some(
          (entry) =>
            normalizeModelSegment(entry.provider) === candidateProvider,
        )
      ) {
        queryProvider = candidateProvider;
        queryId = baseModel.slice(index + 1);
        break;
      }
    }
  }
  const normalized = normalizeModelSegment(queryId);
  const normalizedWithoutDate = stripTrailingDateStamp(normalized);
  const fuzzy = available.filter(
    (entry) =>
      (normalizeModelSegment(entry.id) === normalized ||
        stripTrailingDateStamp(normalizeModelSegment(entry.id)) ===
          normalizedWithoutDate) &&
      (queryProvider === undefined ||
        normalizeModelSegment(entry.provider) === queryProvider),
  );
  const fuzzyResolved =
    fuzzy.find((entry) => entry.provider === preferredProvider) ??
    (fuzzy.length === 1 ? fuzzy[0] : undefined);
  return fuzzyResolved
    ? `${fuzzyResolved.provider}/${fuzzyResolved.id}${thinkingSuffix}`
    : model;
}

function applyAgentThinking(
  model: string | undefined,
  thinking?: string | false,
): string | undefined {
  if (!model || !thinking) return model;
  const { thinkingSuffix } = splitThinkingSuffix(model);
  return thinkingSuffix ? model : `${model}:${thinking}`;
}

function modelLabel(
  input: Record<string, unknown>,
  ctx: ExtensionContext,
): string | undefined {
  const agent = readVerifierAgent(ctx.cwd, input.agentScope);
  if (!agent) return undefined;

  const requestedModel =
    typeof input.model === "string" || input.model === false
      ? input.model
      : undefined;
  const primaryModel =
    requestedModel === undefined ? agent.model : requestedModel;
  const inherited =
    typeof ctx.model?.provider === "string" && typeof ctx.model?.id === "string"
      ? `${ctx.model.provider}/${ctx.model.id}`
      : undefined;
  const trimmed = typeof primaryModel === "string" ? primaryModel.trim() : "";
  const explicit = trimmed && trimmed !== "inherit" ? trimmed : undefined;
  const available = ctx.modelRegistry
    .getAvailable()
    .map((model) => model as AvailableModel)
    .filter(
      (model): model is AvailableModel & { provider: string; id: string } =>
        typeof model.provider === "string" && typeof model.id === "string",
    );
  const model = explicit
    ? resolveModelCandidate(explicit, available, ctx.model?.provider)
    : inherited;
  return applyAgentThinking(model, agent.thinking);
}

export function createVerifierTicket(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  snapshot: WorkspaceSnapshot,
  generation: number,
): VerifierTicket | undefined {
  const input = event.input as Record<string, unknown>;
  const canonicalRoot = canonicalWorkspaceRoot(ctx.cwd) ?? ctx.cwd;
  const effectiveModel = modelLabel(input, ctx);
  if (!effectiveModel) return undefined;
  const scope = Object.freeze({
    kind: "workspace" as const,
    canonicalRoot,
    changedFiles: Object.freeze([...snapshot.changedFiles]),
  });
  const ticket = {
    schemaVersion: 1 as const,
    runId: event.toolCallId,
    canonicalRoot,
    scope,
    startFingerprint: snapshot.fingerprint,
    sessionId: ctx.sessionManager.getSessionId() ?? "",
    generation,
    profile: "verifier" as const,
    effectiveModel,
    requestCwd: ctx.cwd,
  };
  return Object.freeze(ticket) as VerifierTicket;
}

export function ticketSnapshot(
  ticket: VerifierTicket,
): VerificationTicketSnapshot {
  return {
    schemaVersion: ticket.schemaVersion,
    runId: ticket.runId,
    canonicalRoot: ticket.canonicalRoot,
    scope: {
      kind: ticket.scope.kind,
      canonicalRoot: ticket.scope.canonicalRoot,
      changedFiles: [...ticket.scope.changedFiles],
    },
    startFingerprint: ticket.startFingerprint,
    sessionId: ticket.sessionId,
    generation: ticket.generation,
    profile: ticket.profile,
    effectiveModel: ticket.effectiveModel,
  };
}
