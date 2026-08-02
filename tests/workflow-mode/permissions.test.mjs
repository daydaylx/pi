import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test } from "../shared/assertions.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";
import { createHarness } from "../shared/harness.mjs";

const grantsMod = await load("extensions/permissions/grants.ts");
const workflowPolicy = await load("extensions/permissions/workflow-policy.ts");
const permissionDialog = await load("extensions/shared/permission-dialog.ts");

await test("workflow classifier keeps safe reads automatic and identifies mutations", () => {
  if (!workflowPolicy) return;
  eq(workflowPolicy.assessBash("git status", process.cwd()).classification, "safe-read", "git status is safe-read");
  eq(workflowPolicy.assessBash("npm install zod", process.cwd()).classification, "known-mutation", "package installation is a known mutation");
  eq(workflowPolicy.assessBash("node script.js", process.cwd()).classification, "unknown-risk", "opaque interpreter execution is not safe-read");
  eq(workflowPolicy.assessBash("printf changed > x", process.cwd()).classification, "known-mutation", "redirection is evaluated as a mutation");
  eq(workflowPolicy.assessBash("sudo rm -rf /", process.cwd()).classification, "hard-block", "root deletion remains a hard block");
});

await test("permission grants are exact, scoped and safe on malformed storage", () => {
  if (!grantsMod) return;
  const agentDir = mkdtempSync(join(tmpdir(), "pi-grants-"));
  const projectA = join(agentDir, "a");
  const projectB = join(agentDir, "b");
  try {
    const store = new grantsMod.PermissionGrantStore(agentDir);
    const descriptor = {
      tool: "bash", action: "execute", commandPattern: "npm run typecheck",
      persistable: true, label: "npm run typecheck",
    };
    assert(store.add("project", descriptor, projectA), "project grant is stored");
    assert(store.matches(descriptor, projectA), "project grant matches its project");
    assert(!store.matches(descriptor, projectB), "project grant does not cross project roots");
    assert(!store.matches({ ...descriptor, commandPattern: "npm run typecheck && rm -rf src" }, projectA), "exact grant does not allow command chaining");
    assert(store.add("global", descriptor, projectA), "global grant is stored");
    assert(store.matches(descriptor, projectB), "global grant crosses project roots");
    assert(store.add("session", { ...descriptor, commandPattern: "npm run test" }, projectA), "session grant is accepted");
    assert(store.matches({ ...descriptor, commandPattern: "npm run test" }, projectA), "session grant matches during the session");
    assert(!new grantsMod.PermissionGrantStore(agentDir).matches({ ...descriptor, commandPattern: "npm run test" }, projectA), "session grant expires with the session");
    store.clearProject(projectA);
    assert(store.matches(descriptor, projectA), "global grant remains after project reset");
    const dynamic = { ...descriptor, commandPattern: undefined, persistable: false };
    assert(!store.add("project", dynamic, projectA), "dynamic commands are never persisted");
    assert(!grantsMod.normalizeGrantCommand("npm run typecheck && rm -rf src"), "compound commands have no durable pattern");
    assert(!grantsMod.normalizeGrantCommand("npm run $SCRIPT"), "dynamic commands have no durable pattern");
    const globalRules = store.list("global", projectA);
    assert(store.remove(globalRules[0].id), "stored rules can be deleted");
    writeFileSync(join(agentDir, "permission-grants.json"), "{not-json");
    eq(new grantsMod.PermissionGrantStore(agentDir).list("global", projectA).length, 0, "corrupt grants fall back to an empty set");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

await test("global grant asks for a second confirmation", async () => {
  if (!permissionDialog) return;
  const harness = createHarness({
    select: () => "Global immer zulassen",
    confirm: false,
  });
  const choice = await permissionDialog.requestGrant(harness.makeContext(), {
    subject: "npm run typecheck",
    toolName: "bash",
    reason: "Bekannte Aktion",
    impacts: [],
    persistable: true,
  });
  eq(choice, "deny", "declining the global confirmation stores no rule");
  eq(harness.lifecycleCalls.filter((entry) => entry.kind === "confirm").length, 1, "global choice requires a second confirmation");
});
