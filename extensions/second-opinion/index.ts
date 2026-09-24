import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { recordSecondOpinionRun } from "./run-history.ts";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import {
  loadSetupConfig,
  type SecondOpinionConfig,
} from "../setup-core/config.ts";
import {
  approvalMessage,
  formatOpinionResult,
  SecondOpinionService,
} from "./service.ts";
import {
  REASON_CATEGORIES,
  type ContextReference,
  type OpinionRequest,
} from "./types.ts";

const ContextReferenceSchema = Type.Object({
  kind: StringEnum([
    "code_range",
    "diff",
    "test_summary",
    "requirement",
  ] as const),
  path: Type.String({ minLength: 1, maxLength: 240 }),
  start_line: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  end_line: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  label: Type.String({ minLength: 1, maxLength: 120 }),
});

const OpinionParams = Type.Object({
  request_id: Type.String({ minLength: 1, maxLength: 128 }),
  decision_id: Type.String({ minLength: 1, maxLength: 128 }),
  question: Type.String({ minLength: 1, maxLength: 2_000 }),
  reason: Type.String({ minLength: 1, maxLength: 2_000 }),
  expected_benefit: Type.String({ minLength: 1, maxLength: 2_000 }),
  reason_category: StringEnum(REASON_CATEGORIES),
  constraints: Type.Array(Type.String({ minLength: 1, maxLength: 400 }), {
    minItems: 1,
    maxItems: 8,
  }),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 4 }),
  ),
  context_refs: Type.Array(ContextReferenceSchema, {
    minItems: 1,
    maxItems: 8,
  }),
});

type OpinionParams = {
  request_id: string;
  decision_id: string;
  question: string;
  reason: string;
  expected_benefit: string;
  reason_category: (typeof REASON_CATEGORIES)[number];
  constraints: string[];
  options?: string[];
  context_refs: Array<{
    kind: ContextReference["kind"];
    path: string;
    start_line?: number;
    end_line?: number;
    label: string;
  }>;
};

function mapRequest(params: OpinionParams): OpinionRequest {
  return {
    requestId: params.request_id,
    decisionId: params.decision_id,
    triggerSource: "main_agent",
    question: params.question,
    reason: params.reason,
    expectedBenefit: params.expected_benefit,
    reasonCategory: params.reason_category,
    constraints: params.constraints,
    options: params.options,
    contextRefs: params.context_refs.map((reference) => ({
      kind: reference.kind,
      path: reference.path,
      startLine: reference.start_line,
      endLine: reference.end_line,
      label: reference.label,
    })),
  };
}

function configKey(config: SecondOpinionConfig): string {
  return JSON.stringify(config);
}

export default function secondOpinion(pi: ExtensionAPI): void {
  let service: SecondOpinionService | undefined;
  let serviceConfigKey: string | undefined;
  let serviceSessionId: string | undefined;
  let sessionGeneration = 0;

  pi.on("session_start", (_event, ctx) => {
    sessionGeneration += 1;
    service = undefined;
    serviceConfigKey = undefined;
    serviceSessionId = ctx.sessionManager.getSessionId() ?? "unknown";
  });
  pi.on("session_shutdown", () => {
    sessionGeneration += 1;
    service = undefined;
    serviceConfigKey = undefined;
    serviceSessionId = undefined;
  });

  pi.registerTool({
    name: "second_opinion",
    label: "Zweitmeinung",
    description:
      "Beantragt nach konkreter Begründung eine kontrollierte, rein beratende Zweitmeinung. Das Opinion-Modell erhält nur ausdrücklich referenzierte, geprüfte Kontextbereiche und niemals Tools. Der Call erfolgt nur nach sichtbarer Benutzerfreigabe und nie automatisch.",
    parameters: OpinionParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const request = mapRequest(params);
      if (ctx.mode !== "tui") {
        return {
          content: [
            {
              type: "text",
              text: "Zweitmeinung nicht verfügbar: Phase 1 unterstützt ausschließlich die TUI; kein Modellcall wurde gestartet.",
            },
          ],
          details: { status: "unavailable", requestId: request.requestId },
        };
      }

      const currentSessionId = ctx.sessionManager.getSessionId() ?? "unknown";
      if (serviceSessionId !== currentSessionId) {
        sessionGeneration += 1;
        service = undefined;
        serviceConfigKey = undefined;
        serviceSessionId = currentSessionId;
      }
      const loaded = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
      const currentKey = configKey(loaded.config.secondOpinion);
      if (!service || serviceConfigKey !== currentKey) {
        service = new SecondOpinionService(loaded.config.secondOpinion);
        serviceConfigKey = currentKey;
      }
      const activeService = service;
      const preparedGeneration = sessionGeneration;
      const prepared = await activeService.prepare(request, {
        modelRegistry: ctx.modelRegistry,
        currentModel: ctx.model,
        sessionId: currentSessionId,
        sessionGeneration: preparedGeneration,
        cwd: ctx.cwd,
        signal,
        recordTelemetry: (telemetry) => {
          pi.appendEntry("second-opinion.telemetry", telemetry);
          recordSecondOpinionRun(telemetry, ctx.cwd);
        },
      });
      if (!prepared.ok) {
        return {
          content: [
            { type: "text", text: formatOpinionResult(prepared.result) },
          ],
          details: prepared.result,
        };
      }

      const approved = await ctx.ui.confirm(
        "Zweitmeinung anfordern?",
        approvalMessage(prepared.prepared),
      );
      const result = await activeService.executeApproved(
        prepared.prepared,
        { approved, approvalId: prepared.prepared.snapshot.approvalId },
        {
          modelRegistry: ctx.modelRegistry,
          currentModel: ctx.model,
          sessionId: ctx.sessionManager.getSessionId() ?? "unknown",
          sessionGeneration,
          cwd: ctx.cwd,
          signal,
          recordTelemetry: (telemetry) => {
            pi.appendEntry("second-opinion.telemetry", telemetry);
            recordSecondOpinionRun(telemetry, ctx.cwd);
          },
        },
      );
      return {
        content: [{ type: "text", text: formatOpinionResult(result) }],
        details: result,
      };
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("second_opinion ")) +
          theme.fg("muted", args.question ?? "Zweitmeinung"),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const status = (result.details as { status?: string } | undefined)
        ?.status;
      const text = result.content[0];
      const value = text?.type === "text" ? text.text : "";
      return new Text(
        status === "completed"
          ? theme.fg("success", value)
          : theme.fg("warning", value),
        0,
        0,
      );
    },
  });
}
