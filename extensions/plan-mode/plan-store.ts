/**
 * Session-scoped plan storage.
 *
 * The old design kept exactly one plan per repository in
 * `.agent/plans/current-plan.md`. That made three things impossible to get
 * right: two Pi sessions in the same checkout silently overwrote each other's
 * plan, the rollback of a failed planning turn restored *someone else's* plan,
 * and every planning turn left an untracked file behind in a project that
 * never asked for one.
 *
 * Plans therefore live under the runtime's own state directory
 * (`~/.pi/agent/plans/<workspace key>/<session id>.md`, honouring
 * `PI_CODING_AGENT_DIR` through `getAgentDir()`), keyed by both the workspace
 * and the session. Nothing is written below the user's checkout unless they
 * explicitly ask for it with `/save-plan`.
 *
 * Every read returns the content together with its SHA-256 hash, and every
 * write is a compare-and-swap against the hash the caller last saw. That is
 * what binds a plan approval to an exact plan (see `session.ts`) and what stops
 * an external editor and the agent from clobbering one another.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isInside } from "../shared/path-utils.ts";

/**
 * The largest plan the store accepts, in bytes of UTF-8.
 *
 * A plan is reference material for one implementation run, not a document
 * store: 64 KiB is far more than any readable plan needs and still small
 * enough that injecting it cannot dominate a provider context. Exceeding it is
 * a hard rejection at write time rather than a silent truncation, so the plan
 * that gets approved is always the plan that was reviewed.
 */
export const MAX_PLAN_BYTES = 64 * 1024;

/** The pre-session-scoping location, kept readable for migration only. */
export const LEGACY_PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";

/** The opt-in workspace copy `/save-plan` writes. */
export const WORKSPACE_PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";

export interface StoredPlan {
  content: string;
  hash: string;
}

export interface PlanLocation {
  workspaceKey: string;
  sessionId: string;
}

/** Stable, collision-resistant, filesystem-safe key for a workspace path. */
export function workspaceKey(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
}

/** A session id reaches us from the runtime; keep it out of the path grammar. */
function sessionKey(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  // An id that is empty or reduces to a relative-path token would escape the
  // plans directory once joined, so fall back to a hash of the raw value.
  return safe.length > 0 && safe !== "." && safe !== ".."
    ? safe
    : createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

export function planRoot(): string {
  try {
    return join(getAgentDir(), "plans");
  } catch {
    // getAgentDir() reads the environment; a broken one must not take the
    // extension down, so fall back to the documented default location.
    return join(homedir(), ".pi", "agent", "plans");
  }
}

/** Absolute path of one session's plan, proven to stay inside the plan root. */
export function planPath(location: PlanLocation): string {
  const root = resolve(planRoot());
  const target = resolve(
    root,
    location.workspaceKey,
    `${sessionKey(location.sessionId)}.md`,
  );
  if (!isInside(root, target))
    throw new Error("Planpfad verlässt das Plan-Verzeichnis.");
  return target;
}

export function planLocation(cwd: string, sessionId: string): PlanLocation {
  return { workspaceKey: workspaceKey(cwd), sessionId };
}

export function hashPlan(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function readPlan(location: PlanLocation): StoredPlan | undefined {
  const path = planPath(location);
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf8");
  return { content, hash: hashPlan(content) };
}

export type PlanWriteResult =
  | { ok: true; stored: StoredPlan }
  | { ok: false; reason: "conflict"; current: StoredPlan | undefined }
  | { ok: false; reason: "too-large"; bytes: number };

/**
 * Compare-and-swap write.
 *
 * `expectedHash` is the hash the caller believes is stored — `undefined` means
 * "I expect no plan yet". A mismatch is reported, never resolved here: the
 * caller decides whether a concurrent change is an error or something to merge.
 */
export function writePlan(
  location: PlanLocation,
  content: string,
  expectedHash: string | undefined,
): PlanWriteResult {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_PLAN_BYTES) return { ok: false, reason: "too-large", bytes };
  const current = readPlan(location);
  if (current?.hash !== expectedHash)
    return { ok: false, reason: "conflict", current };
  const path = planPath(location);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return { ok: true, stored: { content, hash: hashPlan(content) } };
}

/**
 * Restore a known previous state after a failed planning turn.
 *
 * Only this session's own file is touched, so a rollback can never undo what
 * another session wrote — the defect the single shared plan file had.
 */
export function restorePlan(
  location: PlanLocation,
  previous: StoredPlan | undefined,
): void {
  const path = planPath(location);
  if (previous === undefined) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, previous.content, "utf8");
}

export function removePlan(location: PlanLocation): void {
  rmSync(planPath(location), { force: true });
}

/** Plans other sessions left behind for this workspace, newest file last. */
export function siblingSessionIds(location: PlanLocation): string[] {
  const dir = join(resolve(planRoot()), location.workspaceKey);
  if (!existsSync(dir)) return [];
  const own = `${sessionKey(location.sessionId)}.md`;
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== own)
    .map((name) => name.slice(0, -3));
}

/**
 * The pre-session-scoping plan file, if the project still carries one.
 *
 * It is only ever *shown* (`/view-plan`). It is deliberately not a source for
 * the handoff: a plan file of unknown age, possibly written by a different
 * session or checked into the repository, must never become executable work
 * just because it happens to exist.
 */
export function readLegacyWorkspacePlan(cwd: string): string | undefined {
  const root = resolve(cwd);
  const target = resolve(root, LEGACY_PLAN_RELATIVE_PATH);
  if (!isInside(root, target)) return undefined;
  return existsSync(target) ? readFileSync(target, "utf8") : undefined;
}

/** Absolute path of the opt-in workspace copy, refusing to leave the project. */
export function workspacePlanPath(cwd: string): string {
  const root = resolve(cwd);
  const target = resolve(root, WORKSPACE_PLAN_RELATIVE_PATH);
  if (!isInside(root, target))
    throw new Error("Planpfad verlässt das Projekt.");
  return target;
}

export function writeWorkspacePlan(cwd: string, content: string): string {
  const path = workspacePlanPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}
