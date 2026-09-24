import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

function model(overrides = {}) {
  return {
    provider: "opinion-provider",
    id: "opinion-model-v1",
    family: "opinion-family",
    api: "openai-completions",
    name: "Opinion model",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 700,
    ...overrides,
  };
}

function request() {
  return {
    requestId: "request-1",
    decisionId: "decision-1",
    triggerSource: "main_agent",
    question:
      "Welche der beiden lokalen Varianten hält die Zustandsgrenze kleiner?",
    reason:
      "Die beiden Varianten haben widersprüchliche Auswirkungen auf die Zustandsverwaltung.",
    expectedBenefit:
      "Ein zusätzliches Risiko der gewählten Architektur erkennen.",
    reasonCategory: "ARCHITECTURE_FORK",
    constraints: ["Keine neue Agentenplattform einführen"],
    options: ["Variante A", "Variante B"],
    contextRefs: [
      {
        kind: "code_range",
        path: "src/example.ts",
        startLine: 1,
        endLine: 2,
        label: "relevante Implementierung",
      },
    ],
  };
}

function config() {
  return {
    enabled: true,
    providerId: "opinion-provider",
    modelId: "opinion-model-v1",
    mainModelFamily: "main-family",
    opinionModelFamily: "opinion-family",
    requireDifferentFamily: true,
    preferDifferentBackend: true,
    maxInputTokens: 8_000,
    maxOutputTokens: 700,
    timeoutMs: 45_000,
    maxCallsPerDecision: 1,
    allowContextFollowup: false,
  };
}

function deps(root, calls, options = {}) {
  const selected = model(options.opinionModel);
  return {
    cwd: root,
    currentModel: Object.hasOwn(options, "currentModel")
      ? options.currentModel
      : { provider: "main-provider", id: "main-model", family: "main-family" },
    sessionId: options.sessionId ?? "session-1",
    sessionGeneration: options.sessionGeneration ?? 1,
    modelRegistry: {
      find: () => selected,
      getApiKeyAndHeaders:
        options.getApiKeyAndHeaders ??
        (async () => ({ ok: true, apiKey: "fake-key" })),
      complete: async (_selected, context, options) => {
        calls.push({ context, options });
        return {
          role: "assistant",
          api: selected.api,
          provider: selected.provider,
          model: selected.id,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "completed",
                assessment: "Variante A ist im gegebenen Ausschnitt kleiner.",
                main_reason: "Sie benötigt weniger dauerhaften Zustand.",
                main_risk: "Der Ausschnitt zeigt den Fehlerpfad nicht.",
                strongest_counterargument:
                  "Variante B könnte später leichter erweiterbar sein.",
                missing_evidence: ["Fehlerpfad"],
                confidence: "medium",
              }),
            },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
          usage: { input: 100, output: 80 },
        };
      },
    },
  };
}

const sectionsUnderTest = {
  "second opinion core": async ({ section, secondOpinion }) => {
    await section("second opinion core", async () => {
      if (!secondOpinion) return;
      const root = mkdtempSync(path.join(tmpdir(), "pi-second-opinion-"));
      mkdirSync(path.join(root, "src"));
      writeFileSync(
        path.join(root, "src/example.ts"),
        "export const answer = 1;\nexport const other = 2;\n",
      );
      try {
        const calls = [];
        const service = new secondOpinion.SecondOpinionService(config());
        const prepared = await service.prepare(request(), deps(root, calls));
        assert(prepared.ok, "valid request builds an approval snapshot");
        eq(calls.length, 0, "preview does not call the provider");
        assert(
          secondOpinion
            .approvalMessage(prepared.prepared)
            .includes("Backend/Gateway:"),
          "approval preview names the actual backend route",
        );
        assert(
          !Object.hasOwn(prepared.prepared.context, "tools"),
          "opinion context has no tools field",
        );
        const result = await service.executeApproved(
          prepared.prepared,
          { approved: true, approvalId: prepared.prepared.snapshot.approvalId },
          deps(root, calls),
        );
        eq(
          result.status,
          "completed",
          "approved request returns a completed opinion",
        );
        eq(calls.length, 1, "approved request makes exactly one provider call");

        const invalidService = new secondOpinion.SecondOpinionService(config());
        const invalidPrepared = await invalidService.prepare(
          {
            ...request(),
            requestId: "request-invalid",
            decisionId: "decision-invalid",
          },
          deps(root, calls),
        );
        assert(invalidPrepared.ok, "invalid approval test starts prepared");
        const invalidApproval = await invalidService.executeApproved(
          invalidPrepared.prepared,
          { approved: true, approvalId: "not-the-preview-token" },
          deps(root, calls),
        );
        eq(
          invalidApproval.status,
          "denied",
          "approval without the preview token is denied",
        );
        const invalidReplay = await invalidService.executeApproved(
          invalidPrepared.prepared,
          {
            approved: true,
            approvalId: invalidPrepared.prepared.snapshot.approvalId,
          },
          deps(root, calls),
        );
        eq(
          invalidReplay.status,
          "denied",
          "invalid approval consumes the decision",
        );
        eq(calls.length, 1, "invalid approval cannot call the provider");

        const duplicate = await service.executeApproved(
          prepared.prepared,
          { approved: true, approvalId: prepared.prepared.snapshot.approvalId },
          deps(root, calls),
        );
        eq(duplicate.status, "denied", "duplicate approval is denied");
        eq(calls.length, 1, "duplicate approval cannot make a second call");
        const duplicateRequest = await service.prepare(
          { ...request(), decisionId: "decision-2" },
          deps(root, calls),
        );
        eq(duplicateRequest.ok, false, "request_id cannot be prepared twice");
        eq(calls.length, 1, "duplicate request_id cannot call the provider");
        const sameModel = await new secondOpinion.SecondOpinionService(
          config(),
        ).prepare(
          {
            ...request(),
            requestId: "request-same-model",
            decisionId: "decision-same-model",
          },
          deps(root, calls, {
            currentModel: {
              provider: "opinion-provider",
              id: "opinion-model-v1",
            },
          }),
        );
        eq(
          sameModel.ok,
          false,
          "effective identical provider/model is rejected despite different config labels",
        );
        eq(calls.length, 1, "same effective model never reaches the provider");

        const sameBackendDifferentModel =
          await new secondOpinion.SecondOpinionService(config()).prepare(
            {
              ...request(),
              requestId: "request-same-backend",
              decisionId: "decision-same-backend",
            },
            deps(root, calls, {
              currentModel: {
                provider: "opinion-provider",
                id: "main-other-model",
              },
            }),
          );
        eq(
          sameBackendDifferentModel.ok,
          false,
          "unknown family is rejected when independent family is required",
        );

        const sameFamily = await new secondOpinion.SecondOpinionService(
          config(),
        ).prepare(
          {
            ...request(),
            requestId: "request-same-family",
            decisionId: "decision-same-family",
          },
          deps(root, calls, {
            currentModel: {
              provider: "main-provider",
              id: "main-model",
              family: "family-a",
            },
            opinionModel: { family: "family-a" },
          }),
        );
        eq(
          sameFamily.ok,
          false,
          "explicitly matching effective families are rejected",
        );
        eq(calls.length, 1, "same-family route cannot call the provider");

        const unknownIdentity = await new secondOpinion.SecondOpinionService(
          config(),
        ).prepare(
          {
            ...request(),
            requestId: "request-unknown-identity",
            decisionId: "decision-unknown-identity",
          },
          deps(root, calls, { currentModel: undefined }),
        );
        eq(
          unknownIdentity.ok,
          false,
          "unknown main identity fails closed when family separation cannot be proven",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },

  "second opinion safety gates": async ({ section, secondOpinion, load }) => {
    await section("second opinion safety gates", async () => {
      if (!secondOpinion) return;
      const root = mkdtempSync(path.join(tmpdir(), "pi-second-opinion-safe-"));
      mkdirSync(path.join(root, "src"));
      writeFileSync(
        path.join(root, "src/secret.env"),
        "API_KEY=super-secret-value-1234\n",
      );
      writeFileSync(
        path.join(root, "src/example.ts"),
        "export const answer = 1;\n",
      );
      try {
        const calls = [];
        const unsafeRequest = request();
        unsafeRequest.contextRefs = [
          {
            kind: "code_range",
            path: "src/secret.env",
            startLine: 1,
            endLine: 1,
            label: "secret",
          },
        ];
        const service = new secondOpinion.SecondOpinionService(config());
        const blocked = await service.prepare(unsafeRequest, deps(root, calls));
        assert(!blocked.ok, "sensitive content is blocked before approval");
        eq(
          blocked.result.status,
          "blocked_sensitive_content",
          "sensitive content gets the fail-closed status",
        );
        eq(calls.length, 0, "sensitive content never reaches the provider");

        symlinkSync("example.ts", path.join(root, "src/link.ts"));
        const symlinkRequest = request();
        symlinkRequest.requestId = "request-link";
        symlinkRequest.decisionId = "decision-link";
        symlinkRequest.contextRefs[0].path = "src/link.ts";
        const symlinkBlocked = await service.prepare(
          symlinkRequest,
          deps(root, calls),
        );
        eq(symlinkBlocked.ok, false, "workspace symlinks are blocked");
        eq(calls.length, 0, "symlinks never reach the provider");

        writeFileSync(path.join(root, "src/large.ts"), "x".repeat(17_000));
        const largeRequest = request();
        largeRequest.requestId = "request-large";
        largeRequest.decisionId = "decision-large";
        largeRequest.contextRefs[0].path = "src/large.ts";
        const largeBlocked = await service.prepare(
          largeRequest,
          deps(root, calls),
        );
        eq(largeBlocked.ok, false, "large ranges are blocked");
        eq(calls.length, 0, "large ranges never reach the provider");

        const stale = request();
        stale.requestId = "request-stale";
        stale.decisionId = "decision-stale";
        const prepared = await service.prepare(stale, deps(root, calls));
        assert(prepared.ok, "stale test starts with a valid preview");
        writeFileSync(
          path.join(root, "src/example.ts"),
          "export const answer = 99;\n",
        );
        const staleResult = await service.executeApproved(
          prepared.prepared,
          { approved: true, approvalId: prepared.prepared.snapshot.approvalId },
          deps(root, calls),
        );
        eq(
          staleResult.status,
          "stale_context",
          "changed context invalidates approval",
        );
        eq(calls.length, 0, "stale approval never reaches the provider");

        const changedModelRequest = {
          ...request(),
          requestId: "request-model-swap",
          decisionId: "decision-model-swap",
        };
        const changedModelPreview = await service.prepare(
          changedModelRequest,
          deps(root, calls),
        );
        assert(
          changedModelPreview.ok,
          "model-swap test reaches approval preview",
        );
        const changedModelResult = await service.executeApproved(
          changedModelPreview.prepared,
          {
            approved: true,
            approvalId: changedModelPreview.prepared.snapshot.approvalId,
          },
          deps(root, calls, {
            currentModel: { provider: "other-provider", id: "other-model" },
          }),
        );
        eq(
          changedModelResult.status,
          "stale_context",
          "main model change after preview invalidates approval",
        );
        eq(calls.length, 0, "changed main model never reaches the provider");

        const changedSessionRequest = {
          ...request(),
          requestId: "request-session-swap",
          decisionId: "decision-session-swap",
        };
        const changedSessionPreview = await service.prepare(
          changedSessionRequest,
          deps(root, calls),
        );
        assert(
          changedSessionPreview.ok,
          "session-swap test reaches approval preview",
        );
        const changedSessionResult = await service.executeApproved(
          changedSessionPreview.prepared,
          {
            approved: true,
            approvalId: changedSessionPreview.prepared.snapshot.approvalId,
          },
          deps(root, calls, { sessionId: "session-2", sessionGeneration: 2 }),
        );
        eq(
          changedSessionResult.status,
          "stale_context",
          "session change after preview invalidates approval",
        );
        eq(calls.length, 0, "changed session never reaches the provider");

        const staleReplay = await service.prepare(
          { ...stale, requestId: "request-stale-replay" },
          deps(root, calls),
        );
        eq(staleReplay.ok, false, "stale decision_id remains consumed");
        eq(calls.length, 0, "stale replay cannot call the provider");

        const concurrentService = new secondOpinion.SecondOpinionService(
          config(),
        );
        let resolveAuth;
        const authPending = new Promise((resolve) => {
          resolveAuth = resolve;
        });
        const concurrentRequest = {
          ...request(),
          requestId: "request-concurrent-1",
          decisionId: "decision-concurrent",
        };
        const firstPrepare = concurrentService.prepare(
          concurrentRequest,
          deps(root, calls, { getApiKeyAndHeaders: () => authPending }),
        );
        const secondPrepare = await concurrentService.prepare(
          { ...concurrentRequest, requestId: "request-concurrent-2" },
          deps(root, calls),
        );
        eq(
          secondPrepare.ok,
          false,
          "a parallel prepare sees the synchronous decision reservation",
        );
        resolveAuth({ ok: true, apiKey: "fake-key" });
        const firstPrepared = await firstPrepare;
        assert(
          firstPrepared.ok,
          "exactly one concurrent request reaches prepared state",
        );

        const retryService = new secondOpinion.SecondOpinionService(config());
        const retryRequest = {
          ...request(),
          requestId: "request-retry-auth",
          decisionId: "decision-retry-auth",
        };
        const authFailed = await retryService.prepare(
          retryRequest,
          deps(root, calls, {
            getApiKeyAndHeaders: async () => ({ ok: false }),
          }),
        );
        eq(authFailed.ok, false, "failed preparation returns before approval");
        const authRetry = await retryService.prepare(
          retryRequest,
          deps(root, calls),
        );
        assert(
          authRetry.ok,
          "failed preparation releases the reservation for a fresh attempt",
        );

        writeFileSync(
          path.join(root, "src/conversation.json"),
          '{"messages":[{"role":"user","content":"small dump"}]}',
        );
        const dumpRequest = request();
        dumpRequest.requestId = "request-dump";
        dumpRequest.decisionId = "decision-dump";
        dumpRequest.contextRefs[0].path = "src/conversation.json";
        const dumpBlocked = await service.prepare(
          dumpRequest,
          deps(root, calls),
        );
        eq(dumpBlocked.ok, false, "conversation dumps are blocked");
        eq(calls.length, 0, "conversation dumps never reach the provider");

        const secondOpinionExtension = await load(
          "extensions/second-opinion/index.ts",
        );
        assert(
          secondOpinionExtension,
          "second-opinion tool extension loads for lifecycle coverage",
        );
        if (secondOpinionExtension) {
          const lifecycleRoot = mkdtempSync(
            path.join(tmpdir(), "pi-second-opinion-session-"),
          );
          mkdirSync(path.join(lifecycleRoot, ".pi"), { recursive: true });
          mkdirSync(path.join(lifecycleRoot, "src"));
          writeFileSync(
            path.join(lifecycleRoot, "src/example.ts"),
            "export const sessionEvidence = true;\n",
          );
          writeFileSync(
            path.join(lifecycleRoot, ".pi/setup.json"),
            JSON.stringify({
              secondOpinion: {
                enabled: true,
                providerId: "opinion-provider",
                modelId: "opinion-model-v1",
              },
            }),
          );
          try {
            const selectedModel = model();
            let currentCtx;
            let switchDuringApproval = false;
            let providerCalls = 0;
            const attachProvider = (ctx) => {
              ctx.modelRegistry.complete = async () => {
                providerCalls += 1;
                return {
                  role: "assistant",
                  api: selectedModel.api,
                  provider: selectedModel.provider,
                  model: selectedModel.id,
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        status: "completed",
                        assessment: "session-bound response",
                        main_reason: "mocked",
                        main_risk: "mocked",
                        strongest_counterargument: "mocked",
                        missing_evidence: [],
                        confidence: "medium",
                      }),
                    },
                  ],
                  stopReason: "stop",
                };
              };
            };
            const lifecycleHarness = createHarness({
              modelRegistryFind: () => selectedModel,
              confirm: async () => {
                if (switchDuringApproval) {
                  switchDuringApproval = false;
                  await lifecycleHarness.runHooks(
                    "session_shutdown",
                    {},
                    currentCtx,
                  );
                  currentCtx = lifecycleHarness.makeContext({
                    cwd: lifecycleRoot,
                    sessionId: "session-c",
                    model: {
                      provider: "main-provider",
                      id: "main-model",
                      family: "main-family",
                    },
                  });
                  attachProvider(currentCtx);
                  await lifecycleHarness.runHooks(
                    "session_start",
                    {},
                    currentCtx,
                  );
                }
                return true;
              },
            });
            secondOpinionExtension.default(lifecycleHarness.api);
            currentCtx = lifecycleHarness.makeContext({
              cwd: lifecycleRoot,
              sessionId: "session-a",
              model: {
                provider: "main-provider",
                id: "main-model",
                family: "main-family",
              },
            });
            attachProvider(currentCtx);
            const params = {
              request_id: "reused-request",
              decision_id: "reused-decision",
              question: "Welche lokale Variante ist stabiler?",
              reason: "Die Zustandsgrenzen unterscheiden sich wesentlich.",
              expected_benefit: "Ein verstecktes Lifecycle-Risiko finden.",
              reason_category: "ARCHITECTURE_FORK",
              constraints: ["Keine Live-Änderungen"],
              context_refs: [
                {
                  kind: "code_range",
                  path: "src/example.ts",
                  start_line: 1,
                  end_line: 1,
                  label: "Session-Testbeleg",
                },
              ],
            };
            const executeTool = () =>
              lifecycleHarness.tools
                .get("second_opinion")
                .execute(
                  "session-test",
                  params,
                  undefined,
                  undefined,
                  currentCtx,
                );
            const sessionA = await executeTool();
            eq(
              sessionA.details.status,
              "completed",
              "session A can use its decision once",
            );
            await lifecycleHarness.runHooks("session_shutdown", {}, currentCtx);
            currentCtx = lifecycleHarness.makeContext({
              cwd: lifecycleRoot,
              sessionId: "session-b",
              model: {
                provider: "main-provider",
                id: "main-model",
                family: "main-family",
              },
            });
            attachProvider(currentCtx);
            await lifecycleHarness.runHooks("session_start", {}, currentCtx);
            const sessionB = await executeTool();
            eq(
              sessionB.details.status,
              "completed",
              "session B may reuse the same decision id",
            );
            eq(
              providerCalls,
              2,
              "both independent sessions reach only the mocked provider",
            );

            switchDuringApproval = true;
            const staleApproval = await lifecycleHarness.tools
              .get("second_opinion")
              .execute(
                "session-switch-test",
                {
                  ...params,
                  request_id: "approval-request",
                  decision_id: "approval-decision",
                },
                undefined,
                undefined,
                currentCtx,
              );
            eq(
              staleApproval.details.status,
              "stale_context",
              "session change inside approval dialog invalidates the prepared request",
            );
            eq(
              providerCalls,
              2,
              "session change after approval preview starts no provider call",
            );
            await lifecycleHarness.runHooks("session_shutdown", {}, currentCtx);
          } finally {
            rmSync(lifecycleRoot, { recursive: true, force: true });
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },

  "second opinion abort handling (OPINION-002)": async ({
    section,
    secondOpinion,
  }) => {
    await section("second opinion abort handling (OPINION-002)", async () => {
      if (!secondOpinion) return;
      const root = mkdtempSync(path.join(tmpdir(), "pi-second-opinion-abort-"));
      mkdirSync(path.join(root, "src"));
      writeFileSync(
        path.join(root, "src/example.ts"),
        "export const answer = 1;\nexport const other = 2;\n",
      );
      try {
        // 1. Signal already aborted before executeApproved is even called
        // (the caller's approval dialog can await arbitrarily long, and the
        // caller's signal may fire during that wait). No provider call, and
        // the approval is NOT burned — a caller that retries the exact same
        // still-valid approval afterward can still succeed.
        const calls = [];
        const service = new secondOpinion.SecondOpinionService(config());
        const preAbortRequest = request();
        const prepared = await service.prepare(
          preAbortRequest,
          deps(root, calls),
        );
        assert(prepared.ok, "valid request builds an approval snapshot");
        const abortedController = new AbortController();
        abortedController.abort();
        const cancelled = await service.executeApproved(
          prepared.prepared,
          {
            approved: true,
            approvalId: prepared.prepared.snapshot.approvalId,
          },
          { ...deps(root, calls), signal: abortedController.signal },
        );
        eq(
          cancelled.status,
          "cancelled",
          "an already-aborted signal is reported as cancelled",
        );
        eq(
          calls.length,
          0,
          "an already-aborted signal never reaches the provider",
        );

        const retried = await service.executeApproved(
          prepared.prepared,
          {
            approved: true,
            approvalId: prepared.prepared.snapshot.approvalId,
          },
          deps(root, calls),
        );
        eq(
          retried.status,
          "completed",
          "the same approval can still be spent after a cancelled attempt — it was never consumed",
        );
        eq(
          calls.length,
          1,
          "the retried, non-aborted attempt makes exactly one provider call",
        );

        // 2. Abort during the dialog: prepare() succeeds with a live signal,
        // the signal fires while the (simulated) approval dialog is
        // pending, and only then is executeApproved called — mirroring the
        // real caller flow in index.ts (`await ctx.ui.confirm(...)` sits
        // between prepare() and executeApproved()).
        const dialogController = new AbortController();
        const dialogRequest = {
          ...request(),
          requestId: "request-dialog-abort",
          decisionId: "decision-dialog-abort",
        };
        const dialogPrepared = await service.prepare(dialogRequest, {
          ...deps(root, calls),
          signal: dialogController.signal,
        });
        assert(dialogPrepared.ok, "dialog-abort test starts prepared");
        dialogController.abort(); // the dialog is cancelled here
        const dialogResult = await service.executeApproved(
          dialogPrepared.prepared,
          {
            approved: true,
            approvalId: dialogPrepared.prepared.snapshot.approvalId,
          },
          { ...deps(root, calls), signal: dialogController.signal },
        );
        eq(
          dialogResult.status,
          "cancelled",
          "an abort that fires during the approval dialog is cancelled",
        );
        eq(
          calls.length,
          1,
          "an abort during the dialog never reaches the provider (call count unchanged from step 1)",
        );

        // 3. A normal, never-aborted request still makes exactly one call —
        // the abort guard must not affect the happy path.
        const cleanRequest = {
          ...request(),
          requestId: "request-clean",
          decisionId: "decision-clean",
        };
        const cleanPrepared = await service.prepare(
          cleanRequest,
          deps(root, calls),
        );
        assert(cleanPrepared.ok, "clean request starts prepared");
        const cleanResult = await service.executeApproved(
          cleanPrepared.prepared,
          {
            approved: true,
            approvalId: cleanPrepared.prepared.snapshot.approvalId,
          },
          deps(root, calls),
        );
        eq(
          cleanResult.status,
          "completed",
          "a normal, non-aborted request still completes",
        );
        eq(
          calls.length,
          2,
          "a normal request makes exactly one additional provider call",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },
};

// The tool records each request in the shared run history. Point it at a
// throwaway agent dir so the suite never appends to the user's real history.
export const secondOpinionSections = Object.fromEntries(
  Object.entries(sectionsUnderTest).map(([name, run]) => [
    name,
    async (context) => {
      const previous = process.env.PI_CODING_AGENT_DIR;
      const isolated = mkdtempSync(path.join(tmpdir(), "pi-so-history-"));
      process.env.PI_CODING_AGENT_DIR = isolated;
      try {
        return await run(context);
      } finally {
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previous;
        rmSync(isolated, { recursive: true, force: true });
      }
    },
  ]),
);
