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

function model() {
  return {
    provider: "opinion-provider",
    id: "opinion-model-v1",
    api: "openai-completions",
    name: "Opinion model",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 700,
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

function deps(root, calls) {
  const selected = model();
  return {
    cwd: root,
    currentModel: { provider: "main-provider", id: "main-model" },
    modelRegistry: {
      find: () => selected,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fake-key" }),
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

export const secondOpinionSections = {
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
        const sameFamilyService = new secondOpinion.SecondOpinionService({
          ...config(),
          mainModelFamily: "opinion-family",
        });
        const sameFamily = await sameFamilyService.prepare(
          {
            ...request(),
            requestId: "request-same-family",
            decisionId: "decision-same-family",
          },
          deps(root, calls),
        );
        eq(sameFamily.ok, false, "same model families are rejected");
        eq(calls.length, 1, "same-family route cannot call the provider");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },

  "second opinion safety gates": async ({ section, secondOpinion }) => {
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
        const staleReplay = await service.prepare(
          { ...stale, requestId: "request-stale-replay" },
          deps(root, calls),
        );
        eq(staleReplay.ok, false, "stale decision_id remains consumed");
        eq(calls.length, 0, "stale replay cannot call the provider");

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
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },
};
