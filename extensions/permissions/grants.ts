import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join, resolve } from "node:path";

export type GrantScope = "project" | "global";
export type GrantChoice = "once" | "session" | "project" | "global" | "deny";

export interface PermissionGrant {
  id: string;
  scope: GrantScope;
  projectRoot?: string;
  tool: string;
  action: string;
  commandPattern?: string;
  pathPattern?: string;
  decision: "allow";
  createdAt: string;
}

export interface GrantDescriptor {
  tool: string;
  action: string;
  commandPattern?: string;
  pathPattern?: string;
  /** False for dynamic or compound operations that must not be persisted. */
  persistable: boolean;
  label: string;
}

const FILE_NAME = "permission-grants.json";

function validString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_000;
}

function isValidGrant(value: unknown): value is PermissionGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Partial<PermissionGrant>;
  if (
    !validString(grant.id) ||
    (grant.scope !== "project" && grant.scope !== "global") ||
    !validString(grant.tool) ||
    !validString(grant.action) ||
    grant.decision !== "allow" ||
    !validString(grant.createdAt)
  ) return false;
  if (grant.scope === "project" && !validString(grant.projectRoot)) return false;
  if (grant.commandPattern !== undefined && (!validString(grant.commandPattern) || /[*$`]/.test(grant.commandPattern))) return false;
  if (grant.pathPattern !== undefined && (!validString(grant.pathPattern) || grant.pathPattern.includes("..") || grant.pathPattern.includes("*"))) return false;
  return Boolean(grant.commandPattern || grant.pathPattern);
}

function sameDescriptor(grant: PermissionGrant, descriptor: GrantDescriptor): boolean {
  return grant.tool === descriptor.tool &&
    grant.action === descriptor.action &&
    grant.commandPattern === descriptor.commandPattern &&
    grant.pathPattern === descriptor.pathPattern;
}

export function canonicalProjectRoot(cwd: string): string {
  return resolve(cwd);
}

export function normalizeGrantCommand(command: string): string | undefined {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || /(?:&&|\|\||[;|<>]|[`'"|]|\$\(|\$\{|\$[A-Za-z_])/.test(normalized)) return undefined;
  return normalized;
}

export class PermissionGrantStore {
  private persistent: PermissionGrant[] = [];
  private session: PermissionGrant[] = [];
  readonly path: string;

  constructor(agentDir = getAgentDir()) {
    this.path = join(agentDir, FILE_NAME);
    this.reload();
  }

  reload(): void {
    if (!existsSync(this.path)) {
      this.persistent = [];
      return;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      this.persistent = Array.isArray(parsed) ? parsed.filter(isValidGrant) : [];
    } catch {
      this.persistent = [];
    }
  }

  matches(descriptor: GrantDescriptor, cwd: string): boolean {
    const root = canonicalProjectRoot(cwd);
    return [...this.session, ...this.persistent].some((grant) =>
      sameDescriptor(grant, descriptor) &&
      (grant.scope === "global" || grant.projectRoot === root),
    );
  }

  add(choice: Exclude<GrantChoice, "once" | "deny">, descriptor: GrantDescriptor, cwd: string): boolean {
    if (!descriptor.persistable) return false;
    const scope: GrantScope = choice === "global" ? "global" : "project";
    const grant: PermissionGrant = {
      id: randomUUID(),
      scope,
      ...(scope === "project" ? { projectRoot: canonicalProjectRoot(cwd) } : {}),
      tool: descriptor.tool,
      action: descriptor.action,
      ...(descriptor.commandPattern ? { commandPattern: descriptor.commandPattern } : {}),
      ...(descriptor.pathPattern ? { pathPattern: descriptor.pathPattern } : {}),
      decision: "allow",
      createdAt: new Date().toISOString(),
    };
    if (choice === "session") {
      this.session.push(grant);
      return true;
    }
    this.persistent = [...this.persistent, grant];
    this.save();
    return true;
  }

  list(scope?: GrantScope, cwd?: string): PermissionGrant[] {
    const root = cwd ? canonicalProjectRoot(cwd) : undefined;
    return this.persistent.filter((grant) =>
      (!scope || grant.scope === scope) &&
      (!root || grant.scope === "global" || grant.projectRoot === root),
    );
  }

  remove(id: string): boolean {
    const next = this.persistent.filter((grant) => grant.id !== id);
    if (next.length === this.persistent.length) return false;
    this.persistent = next;
    this.save();
    return true;
  }

  clearProject(cwd: string): void {
    const root = canonicalProjectRoot(cwd);
    this.persistent = this.persistent.filter(
      (grant) => grant.scope !== "project" || grant.projectRoot !== root,
    );
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.persistent, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
