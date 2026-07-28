/**
 * Completion-Pipeline: Marker, Scope, Secret-Grenze, Diff-Stabilität, Reviewer-RPC.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const store = await load("extensions/plan-mode/store/index.ts");
const completion = await load("extensions/plan-mode/completion/index.ts");
const reviewerRpc = await load("extensions/plan-mode/reviewer-rpc.ts");

await test("completion marker is exact and pipeline rechecks stable diff", async () => {
  equal(
    completion.parseCompletionReviewerResult(
      "Keine Befunde.\n[COMPLETION-REVIEW:PASS]",
    ).verdict,
    "PASS",
    "final exact marker passes",
  );
  equal(
    completion.parseCompletionReviewerResult(
      "[COMPLETION-REVIEW:PASS]\nNachtrag",
    ).verdict,
    "UNVERIFIABLE",
    "marker must be the final nonempty line",
  );
  const finalized = snapshotMod.finalizePlanDocument(
    quickPlan(),
    "simple_plan",
  );
  const state = {
    ...store.createWorkflowState(finalized.snapshot),
    status: "reviewing",
    steps: finalized.snapshot.steps.map((step) => ({
      id: step.id,
      status: "completed",
      evidence: "passed",
    })),
  };
  const projectRoot = mkdtempSync(path.join(tmpdir(), "pi-v3-completion-"));
  try {
    mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });
    writeFileSync(
      path.join(projectRoot, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "npm",
            args: ["run", "typecheck"],
            classification: "required",
          },
        },
      }),
    );
    const exec = async (_program, args) => {
      const joined = args.join(" ");
      if (joined.startsWith("status "))
        return {
          code: 0,
          stdout: " M extensions/plan-mode/a.ts\n",
          stderr: "",
          killed: false,
        };
      if (joined === "diff --stat HEAD")
        return {
          code: 0,
          stdout: " 1 file changed\n",
          stderr: "",
          killed: false,
        };
      if (joined === "diff --binary HEAD")
        return {
          code: 0,
          stdout: "diff --git a/a b/a\n+ok\n",
          stderr: "",
          killed: false,
        };
      return { code: 0, stdout: "", stderr: "", killed: false };
    };
    const result = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: finalized.snapshot,
      state,
      runLsp: async (files) =>
        files.map((file) => ({ path: file, status: "pass", summary: "clean" })),
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(result.status, "pass", "required completion checks pass");
    assert(Boolean(result.report), "passing completion creates report");
    assert(
      result.checks.some(
        (check) => check.name === "diff-stability" && check.status === "pass",
      ),
      "pipeline rechecks diff stability after reviewer",
    );
    const uncovered = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: {
        ...finalized.snapshot,
        verification: ["missing-profile"],
      },
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      uncovered.status,
      "blocked",
      "declared verification without an executable profile blocks completion",
    );
    const outOfScope = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: {
        ...finalized.snapshot,
        technicalScope: ["src/**"],
      },
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(outOfScope.status, "fail", "out-of-scope changes block completion");
    const renameExec = async (program, args) => {
      if (program === "git" && args.join(" ").startsWith("status ")) {
        return {
          code: 0,
          stdout: "R  outside/old.ts -> extensions/plan-mode/a.ts\n",
          stderr: "",
          killed: false,
        };
      }
      return exec(program, args);
    };
    const renamedFromOutside = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: renameExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      renamedFromOutside.status,
      "fail",
      "rename source and destination are both scope-checked",
    );
    let secretPatchRead = false;
    let secretReviewerInput;
    const secretExec = async (program, args) => {
      const joined = args.join(" ");
      if (program === "git" && joined.startsWith("status ")) {
        return {
          code: 0,
          stdout: "?? .npmrc\n",
          stderr: "",
          killed: false,
        };
      }
      if (program === "git" && joined === "diff --binary HEAD") {
        secretPatchRead = true;
      }
      return exec(program, args);
    };
    const secretBoundary = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: secretExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async (input) => {
        secretReviewerInput = input;
        return { verdict: "PASS", summary: "Keine Befunde." };
      },
    });
    assert(
      secretBoundary.status === "fail" &&
        !secretPatchRead &&
        secretReviewerInput.changedFiles.length === 0 &&
        secretReviewerInput.diff.includes("nicht an den Reviewer"),
      "secret paths block completion without reading or forwarding their diff",
    );
    // Der Override ist kein Pipeline-Modus mehr, sondern eine eigene
    // begründete Entscheidung auf genau diesem Ergebnis. Die harte Grenze
    // muss dort genauso greifen: completionOverrideReport wirft.
    let secretOverrideError;
    try {
      completion.completionOverrideReport(
        secretBoundary,
        { plan: finalized.snapshot },
        "must not bypass secrets",
      );
    } catch (error) {
      secretOverrideError = error;
    }
    assert(
      secretOverrideError instanceof Error &&
        secretOverrideError.message.includes("Secret"),
      "hard secret findings cannot produce an override report",
    );
    const reviewFailure = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: finalized.snapshot,
      state,
      runLsp: async (files) =>
        files.map((file) => ({
          path: file,
          status: "fail",
          summary: "diagnostic",
        })),
      runReviewer: async () => ({
        verdict: "REWORK",
        summary: "Regression gefunden.",
      }),
    });
    equal(
      reviewFailure.status,
      "fail",
      "LSP or reviewer findings prevent done",
    );

    const profileExec = async (program, args) => {
      if (program === "missing-tool") throw new Error("spawn ENOENT");
      return exec(program, args);
    };
    writeFileSync(
      path.join(projectRoot, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "true",
            args: [],
            classification: "required",
          },
          optional: {
            program: "missing-tool",
            args: [],
            classification: "recommended",
          },
        },
      }),
    );
    const recommendedMissing = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: profileExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    assert(
      recommendedMissing.status === "pass" &&
        recommendedMissing.residualRisks.some((risk) =>
          risk.includes("project/optional"),
        ),
      "missing recommended tools remain visible residual risks",
    );
    writeFileSync(
      path.join(projectRoot, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "missing-tool",
            args: [],
            classification: "required",
          },
        },
      }),
    );
    const requiredMissing = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: profileExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      requiredMissing.status,
      "blocked",
      "missing required tools block completion",
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

await test("reviewer RPC uses async reviewer and exact result", async () => {
  const handlers = new Map();
  const api = {
    events: {
      on(name, handler) {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
      emit(name, request) {
        if (name !== "subagents:rpc:v1:request") return;
        const reply = handlers.get(
          `subagents:rpc:v1:reply:${request.requestId}`,
        );
        if (request.method === "spawn") {
          queueMicrotask(() =>
            reply?.({ success: true, data: { runId: "review-1" } }),
          );
        } else {
          queueMicrotask(() =>
            reply?.({
              success: true,
              data: {
                state: "completed",
                output: "Go.\n[COMPLETION-REVIEW:PASS]",
              },
            }),
          );
        }
      },
    },
  };
  const result = await reviewerRpc.runCompletionReviewerViaRpc(
    api,
    {
      changedFiles: [],
      diff: "",
      diffHash: "b".repeat(64),
      checks: [],
      scopeFindings: [],
    },
    { pollMs: 10, timeoutMs: 5_000 },
  );
  equal(result.verdict, "PASS", "RPC reviewer PASS is parsed");
});
