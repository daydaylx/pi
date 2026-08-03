/**
 * Reading real subagent-run metadata out of a finished session directory.
 *
 * pi-subagents writes `{runId}_{agent}_meta.json` under
 * `{sessionDir}/subagent-artifacts/` for every subagent task, sync or async
 * (README: "Metadata records timing, usage, exit code, final model,
 * attempted models, and fallback attempt outcomes."). This is the only
 * documented, always-present machine-readable source for which model a role
 * actually ran with, so P4 uses it instead of scraping session.jsonl.
 *
 * Known limitation: the metadata format documents the final *model*, not an
 * independently confirmed thinking level. The same-model P4 manifest pins
 * every active role to the session's own model/thinking, and pi-subagents'
 * builtin agents inherit that pair when their frontmatter sets neither
 * (true for agents/investigator.md, agents/debugger.md, agents/verifier.md).
 * `thinking` below is therefore the level P4 configured the session with,
 * not a value read back out of the artifact — recorded via
 * `configuredThinking` on each result.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function metaFileRole(fileName, runId) {
  const prefix = `${runId}_`;
  const suffix = "_meta.json";
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix))
    return undefined;
  return fileName.slice(prefix.length, -suffix.length);
}

/**
 * @param {string} sessionDir the P4 run directory passed as --session-dir
 * @param {string} runId the P4 run id, matching the subagent tool's runId
 * @param {string[]} roles active non-main manifest role names to look for
 * @param {string} configuredThinking the thinking level the session was
 *   launched with, inherited by builtin agents with no frontmatter override
 */
export function readSubagentRoleResults(
  sessionDir,
  runId,
  roles,
  configuredThinking,
) {
  const artifactsDir = join(sessionDir, "subagent-artifacts");
  const resolvedRoles = {};
  const roleHistory = [];
  if (!existsSync(artifactsDir)) return { resolvedRoles, roleHistory };
  const roleSet = new Set(roles);
  for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const role = metaFileRole(entry.name, runId);
    if (!role || !roleSet.has(role)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(join(artifactsDir, entry.name), "utf8"));
    } catch {
      continue; // Malformed metadata is treated as unavailable, not guessed.
    }
    if (typeof meta.model !== "string") continue;
    const resolved = { model: meta.model, thinking: configuredThinking };
    // First artifact for a role wins; a role invoked more than once still
    // reports one pinned identity, matching pinRuntimeRoles' one-entry shape.
    if (!resolvedRoles[role]) resolvedRoles[role] = resolved;
    roleHistory.push({
      role,
      model: meta.model,
      thinking: configuredThinking,
      parentRunId: runId,
      ...(typeof meta.durationMs === "number"
        ? { durationMs: meta.durationMs }
        : {}),
      ...(meta.usage?.totalTokens !== undefined
        ? { tokens: meta.usage.totalTokens }
        : {}),
    });
  }
  return { resolvedRoles, roleHistory };
}
