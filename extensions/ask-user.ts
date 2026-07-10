/**
 * Ask-User Tool - Decision card with 2–4 options (effort/risk/recommendation)
 * Full custom UI: options list + inline editor for "Freitext eingeben..."
 * Escape in editor returns to options, Escape in options cancels
 *
 * Registered as `ask_user` because extensions/plan-mode/index.ts already
 * references this exact tool name in PLAN_MODE_TOOLS and its system prompts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  clampRecommendedIndex,
  digitSelection,
  hasValidQuestionOptionCount,
  isValidRecommendedIndex,
  LEVELS,
  MAX_QUESTION_OPTIONS,
  MIN_QUESTION_OPTIONS,
  type Level,
} from "./shared/ask-user-policy.ts";
import { glyphsFor, resolveRenderProfile } from "./shared/render-profile.ts";

interface QuestionOption {
  label: string;
  description: string;
  effort: Level;
  risk: Level;
  pro?: string;
  contra?: string;
}

type DisplayOption =
  | (QuestionOption & { isOther?: false })
  | { label: string; isOther: true };

interface QuestionDetails {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom?: boolean;
  /** 1-based index into the original options array; unset for cancelled/custom answers. */
  selectedIndex?: number;
}

function levelColor(level: Level): "warning" | "success" | "text" {
  if (level === "hoch") return "warning";
  if (level === "niedrig") return "success";
  return "text";
}

function levelMarker(level: Level): string {
  if (level === "hoch") return "[HOCH !]";
  if (level === "mittel") return "[MITTEL ~]";
  return "[NIEDRIG .]";
}

// Options with label, description, effort/risk, and optional pro/contra
const OptionSchema = Type.Object({
  label: Type.String({ description: "Kurzer Titel der Option" }),
  description: Type.String({
    description: "Kurzbeschreibung: was diese Option konkret bedeutet",
  }),
  effort: StringEnum(LEVELS, {
    description: "Geschätzter Umsetzungsaufwand dieser Option",
  }),
  risk: StringEnum(LEVELS, {
    description: "Geschätztes Risiko dieser Option",
  }),
  pro: Type.Optional(
    Type.String({ description: "Wichtigster Vorteil dieser Option" }),
  ),
  contra: Type.Optional(
    Type.String({ description: "Wichtigster Nachteil dieser Option" }),
  ),
});

const QuestionParams = Type.Object({
  question: Type.String({ description: "Die konkrete Entscheidungsfrage" }),
  why: Type.Optional(
    Type.String({
      description:
        "1–2 kurze Sätze: warum diese Entscheidung jetzt wichtig ist",
    }),
  ),
  options: Type.Array(OptionSchema, {
    description:
      "2–4 Optionen zur Auswahl. Genau eine davon ist über recommendedIndex als Empfehlung markiert.",
    minItems: MIN_QUESTION_OPTIONS,
    maxItems: MAX_QUESTION_OPTIONS,
  }),
  recommendedIndex: Type.Integer({
    minimum: 1,
    maximum: MAX_QUESTION_OPTIONS,
    description:
      "1-basierter Index (Position in `options`, gezählt ab 1) der empfohlenen Option.",
  }),
  recommendationReason: Type.String({
    description:
      "Kurze Begründung, warum die durch recommendedIndex markierte Option empfohlen wird",
  }),
});

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Stellt dem Nutzer eine fokussierte Entscheidungsfrage mit 2–4 Optionen. Jede Option braucht Titel, Kurzbeschreibung, Aufwand und Risiko; genau eine Option wird über recommendedIndex als Empfehlung markiert und über recommendationReason begründet. Nutzen, wenn eine echte Nutzerentscheidung nötig ist, um fortzufahren.",
    parameters: QuestionParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        return {
          content: [
            {
              type: "text",
              text: `Error: ask_user benötigt den interaktiven TUI-Modus (aktueller Modus: "${ctx.mode}"). Diese Entscheidung kann hier nicht eingeholt werden.`,
            },
          ],
          details: {
            question: params.question,
            options: params.options.map((o) => o.label),
            answer: null,
          } as QuestionDetails,
        };
      }

      if (!hasValidQuestionOptionCount(params.options.length)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Expected ${MIN_QUESTION_OPTIONS}–${MAX_QUESTION_OPTIONS} options`,
            },
          ],
          details: {
            question: params.question,
            options: params.options.map((o) => o.label),
            answer: null,
          } as QuestionDetails,
        };
      }

      const recommendedIndex = clampRecommendedIndex(
        params.recommendedIndex,
        params.options.length,
      );

      const allOptions: DisplayOption[] = [
        ...params.options,
        { label: "Freitext eingeben.", isOther: true },
      ];

      const result = await ctx.ui.custom<{
        answer: string;
        wasCustom: boolean;
        index?: number;
      } | null>((tui, theme, _kb, done) => {
        const recommendedDisplayIndex = recommendedIndex - 1;
        let optionIndex = recommendedDisplayIndex;
        let editMode = false;
        let cachedLines: string[] | undefined;

        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        editor.onSubmit = (value) => {
          const trimmed = value.trim();
          if (trimmed) {
            done({ answer: trimmed, wasCustom: true });
          } else {
            editMode = false;
            editor.setText("");
            refresh();
          }
        };

        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function handleInput(data: string) {
          if (editMode) {
            if (matchesKey(data, Key.escape)) {
              editMode = false;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          // Zahlentasten 1..N wählen eine echte Option direkt. Die
          // Freitext-Zeile bleibt über Pfeil + Enter erreichbar.
          const directPick = digitSelection(data, params.options.length);
          if (directPick !== undefined) {
            const selected = params.options[directPick - 1];
            done({
              answer: selected.label,
              wasCustom: false,
              index: directPick,
            });
            return;
          }

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          if (matchesKey(data, Key.enter)) {
            const selected = allOptions[optionIndex];
            if (selected.isOther) {
              editMode = true;
              refresh();
            } else {
              done({
                answer: selected.label,
                wasCustom: false,
                index: optionIndex + 1,
              });
            }
            return;
          }

          if (matchesKey(data, Key.escape)) {
            done(null);
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const renderWidth = Math.max(1, width);
          const profile = resolveRenderProfile({ width, mode: ctx.mode });
          const glyphs = glyphsFor(profile);
          const optionIndent = renderWidth < 48 ? "  " : "     ";

          function addWrapped(text: string) {
            lines.push(...wrapTextWithAnsi(text, renderWidth));
          }

          function addWrappedWithPrefix(prefix: string, text: string) {
            const prefixWidth = visibleWidth(prefix);
            if (prefixWidth >= renderWidth) {
              addWrapped(prefix + text);
              return;
            }
            const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
            const continuationPrefix = " ".repeat(prefixWidth);
            for (let i = 0; i < wrapped.length; i++) {
              lines.push(
                `${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`,
              );
            }
          }

          lines.push(theme.fg("accent", "─".repeat(renderWidth)));
          addWrappedWithPrefix(
            " ",
            theme.fg("text", `ENTSCHEIDUNG: ${params.question}`),
          );
          if (params.why) {
            lines.push("");
            addWrappedWithPrefix(
              " ",
              theme.fg("muted", "Warum das wichtig ist: ") +
                theme.fg("text", params.why),
            );
          }
          lines.push("");

          for (let i = 0; i < allOptions.length; i++) {
            const opt = allOptions[i];
            const selected = i === optionIndex;
            const prefix = selected ? theme.fg("accent", "> ") : "  ";

            if (opt.isOther === true) {
              const label = `${i + 1}. ${opt.label}${editMode ? ` ${glyphs.edit}` : ""}`;
              const color = selected || editMode ? "accent" : "text";
              addWrappedWithPrefix(prefix, theme.fg(color, label));
              lines.push("");
              continue;
            }

            const isRecommended = i === recommendedDisplayIndex;
            const color = selected ? "accent" : "text";
            const tag = isRecommended
              ? theme.fg("success", "  EMPFOHLEN")
              : "";
            addWrappedWithPrefix(
              prefix,
              theme.fg(color, `${i + 1}. ${opt.label}`) + tag,
            );
            addWrappedWithPrefix(
              optionIndent,
              theme.fg("muted", opt.description),
            );
            addWrappedWithPrefix(
              optionIndent,
              theme.fg("muted", "Aufwand: ") +
                theme.fg(
                  levelColor(opt.effort),
                  `${levelMarker(opt.effort)} ${opt.effort}`,
                ) +
                theme.fg("muted", " · Risiko: ") +
                theme.fg(
                  levelColor(opt.risk),
                  `${levelMarker(opt.risk)} ${opt.risk}`,
                ),
            );
            if (opt.pro) {
              addWrappedWithPrefix(
                optionIndent,
                theme.fg("muted", `Vorteil: ${opt.pro}`),
              );
            }
            if (opt.contra) {
              addWrappedWithPrefix(
                optionIndent,
                theme.fg("muted", `Nachteil: ${opt.contra}`),
              );
            }
            lines.push("");
          }

          if (editMode) {
            addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
            for (const line of editor.render(Math.max(1, renderWidth - 2))) {
              lines.push(` ${line}`);
            }
            lines.push("");
          } else {
            const recommended = params.options[recommendedIndex - 1];
            addWrappedWithPrefix(
              " ",
              theme.fg("success", "Empfehlung: ") +
                theme.fg(
                  "text",
                  `${recommendedIndex}. ${recommended.label} — ${params.recommendationReason}`,
                ),
            );
            lines.push("");
          }

          if (editMode) {
            addWrappedWithPrefix(
              " ",
              theme.fg("dim", "Enter to submit • Esc to go back"),
            );
          } else {
            addWrappedWithPrefix(
              " ",
              theme.fg(
                "dim",
                `↑↓ navigate • 1–${params.options.length} direct • Enter = Empfehlung (${recommendedIndex}) • Esc cancel`,
              ),
            );
          }
          lines.push(theme.fg("accent", "─".repeat(renderWidth)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      // Build simple options list for details
      const simpleOptions = params.options.map((o) => o.label);

      if (!result) {
        return {
          content: [{ type: "text", text: "User cancelled the selection" }],
          details: {
            question: params.question,
            options: simpleOptions,
            answer: null,
          } as QuestionDetails,
        };
      }

      if (result.wasCustom) {
        return {
          content: [{ type: "text", text: `User wrote: ${result.answer}` }],
          details: {
            question: params.question,
            options: simpleOptions,
            answer: result.answer,
            wasCustom: true,
          } as QuestionDetails,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `User selected: ${result.index}. ${result.answer}`,
          },
        ],
        details: {
          question: params.question,
          options: simpleOptions,
          answer: result.answer,
          wasCustom: false,
          selectedIndex: result.index,
        } as QuestionDetails,
      };
    },

    renderCall(args, theme, _context) {
      let text =
        theme.fg("toolTitle", theme.bold("ask_user ")) +
        theme.fg("muted", args.question);
      const opts = Array.isArray(args.options) ? args.options : [];
      if (opts.length) {
        const recommendedIndex = isValidRecommendedIndex(
          args.recommendedIndex,
          opts.length,
        )
          ? args.recommendedIndex
          : undefined;
        const labels = [
          ...opts.map((o: QuestionOption) => o.label),
          "Freitext eingeben.",
        ];
        const parts = labels.map((label, i) => {
          const numbered = theme.fg("dim", `${i + 1}. ${label}`);
          return i + 1 === recommendedIndex
            ? numbered + theme.fg("success", " EMPFOHLEN")
            : numbered;
        });
        text += `\n${theme.fg("dim", "  Options: ")}${parts.join(theme.fg("dim", ", "))}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, context) {
      const details = result.details as QuestionDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.answer === null) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(wrote) ") +
            theme.fg("accent", details.answer),
          0,
          0,
        );
      }

      const idx =
        details.selectedIndex ?? details.options.indexOf(details.answer) + 1;
      const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
      let text = theme.fg("success", "✓ ") + theme.fg("accent", display);

      const args = context.args as { options?: QuestionOption[] } | undefined;
      const chosen = idx > 0 ? args?.options?.[idx - 1] : undefined;
      if (chosen?.description) {
        text += `\n  ${theme.fg("muted", chosen.description)}`;
      }

      return new Text(text, 0, 0);
    },
  });
}
