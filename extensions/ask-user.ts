/**
 * Ask-User Tool - Decision card with 2–4 options (effort/risk/recommendation)
 * Full custom UI: options list + inline editor for "Freitext eingeben..."
 * Escape in editor returns to options, Escape in options cancels
 *
 * Registered under ASK_USER_TOOL_NAME (shared/ask-user-policy.ts), which the
 * permission-policy layers and extensions/plan-mode/prompts.ts also import —
 * see that constant's doc comment for why it's centralized.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  ASK_USER_TOOL_NAME,
  clampRecommendedIndex,
  digitSelection,
  hasValidQuestionOptionCount,
  isValidRecommendedIndex,
  LEVELS,
  MAX_QUESTION_OPTIONS,
  MIN_QUESTION_OPTIONS,
  type Level,
} from "./shared/ask-user-policy.ts";
import { overlayMargin } from "./shared/layout.ts";
import { calculateMenuViewport } from "./shared/menu-ui.ts";

interface QuestionOption {
  label: string;
  description: string;
  effort: Level;
  risk: Level;
  pro?: string;
  contra?: string;
}

type DisplayOption =
  (QuestionOption & { isOther?: false }) | { label: string; isOther: true };

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
  label: Type.String({
    minLength: 1,
    description: "Kurzer Titel der Option, in einfacher Sprache",
  }),
  description: Type.String({
    minLength: 1,
    description:
      "Kurzbeschreibung in einfacher, allgemeinverständlicher Sprache ohne Fachjargon: was diese Option konkret bedeutet und welche Konsequenz sie hat",
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
  question: Type.String({
    minLength: 1,
    description:
      "Die konkrete Entscheidungsfrage, in einfacher Sprache formuliert",
  }),
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
    minLength: 1,
    description:
      "Kurze, in einfacher Sprache gehaltene Begründung, warum die durch recommendedIndex markierte Option empfohlen wird. Pflichtfeld — jede Frage braucht eine erkennbare Empfehlung, keine reine Optionsliste.",
  }),
});

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: ASK_USER_TOOL_NAME,
    label: "Nutzer fragen",
    description:
      "Stellt dem Nutzer eine fokussierte Entscheidungsfrage mit 2–4 Optionen. Jede Option braucht Titel, eine in einfacher, allgemeinverständlicher Sprache gehaltene Kurzbeschreibung ohne Fachjargon, Aufwand und Risiko; genau eine Option wird über recommendedIndex als klare Empfehlung markiert und über recommendationReason nachvollziehbar begründet — eine Empfehlung ist Pflicht, keine optionale Ergänzung. Nutzen (nicht nur erwägen), wenn eine echte Nutzerentscheidung nötig ist, um fortzufahren.",
    parameters: QuestionParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        return {
          content: [
            {
              type: "text",
              text: `Fehler: ask_user benötigt den interaktiven TUI-Modus (aktueller Modus: "${ctx.mode}"). Diese Entscheidung kann hier nicht eingeholt werden.`,
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
              text: `Fehler: ${MIN_QUESTION_OPTIONS}–${MAX_QUESTION_OPTIONS} Optionen erwartet`,
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

      let terminal = () => ({
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      });
      const result = await ctx.ui.custom<{
        answer: string;
        wasCustom: boolean;
        index?: number;
      } | null>(
        (tui, theme, _kb, done) => {
          terminal = () => ({
            columns: tui.terminal.columns,
            rows: tui.terminal.rows,
          });
          const recommendedDisplayIndex = recommendedIndex - 1;
          let optionIndex = recommendedDisplayIndex;
          let editMode = false;
          let cachedLines: string[] | undefined;
          let cachedWidth: number | undefined;
          let cachedRows: number | undefined;
          let viewportStart = 0;
          let visibleEntries = allOptions.length;

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
            if (matchesKey(data, Key.ctrl("c"))) {
              done(null);
              return;
            }
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
            if (matchesKey(data, Key.home)) {
              optionIndex = 0;
              viewportStart = 0;
              refresh();
              return;
            }
            if (matchesKey(data, Key.end)) {
              optionIndex = allOptions.length - 1;
              viewportStart = optionIndex;
              refresh();
              return;
            }
            if (matchesKey(data, Key.pageUp)) {
              optionIndex = Math.max(0, optionIndex - visibleEntries);
              viewportStart = optionIndex;
              refresh();
              return;
            }
            if (matchesKey(data, Key.pageDown)) {
              optionIndex = Math.min(
                allOptions.length - 1,
                optionIndex + visibleEntries,
              );
              viewportStart = optionIndex;
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
            const renderWidth = Math.max(1, width);
            const rows = tui.terminal.rows;
            if (
              cachedLines &&
              cachedWidth === renderWidth &&
              cachedRows === rows
            ) {
              return cachedLines;
            }

            const optionIndent = renderWidth < 48 ? "  " : "     ";

            function addWrapped(text: string, target: string[]) {
              target.push(...wrapTextWithAnsi(text, renderWidth));
            }

            function addWrappedWithPrefix(
              prefix: string,
              text: string,
              target: string[],
            ) {
              const prefixWidth = visibleWidth(prefix);
              if (prefixWidth >= renderWidth) {
                addWrapped(prefix + text, target);
                return;
              }
              const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
              const continuationPrefix = " ".repeat(prefixWidth);
              for (let i = 0; i < wrapped.length; i++) {
                target.push(
                  `${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`,
                );
              }
            }

            // Kopf (Frage/Warum) bleibt immer sichtbar, unabhängig vom Scroll-Fenster.
            const lines: string[] = [];
            lines.push(theme.fg("accent", "─".repeat(renderWidth)));
            addWrappedWithPrefix(
              " ",
              theme.fg("text", `ENTSCHEIDUNG: ${params.question}`),
              lines,
            );
            if (params.why) {
              lines.push("");
              addWrappedWithPrefix(
                " ",
                theme.fg("muted", "Warum das wichtig ist: ") +
                  theme.fg("text", params.why),
                lines,
              );
            }
            lines.push("");

            // Fuß (Empfehlung/Editor + Hilfezeile + Rahmenzeile) bleibt ebenfalls
            // immer sichtbar; seine Länge muss vor dem Scroll-Budget feststehen.
            const footerLines: string[] = [];
            if (editMode) {
              addWrappedWithPrefix(
                " ",
                theme.fg("muted", "Deine Antwort:"),
                footerLines,
              );
              for (const line of editor.render(Math.max(1, renderWidth - 2))) {
                footerLines.push(` ${line}`);
              }
              footerLines.push("");
              addWrappedWithPrefix(
                " ",
                theme.fg("dim", "Enter senden · Esc zurück · Ctrl+C abbrechen"),
                footerLines,
              );
            } else {
              const recommended = params.options[recommendedIndex - 1];
              addWrappedWithPrefix(
                " ",
                theme.fg("success", "Empfehlung: ") +
                  theme.fg(
                    "text",
                    `${recommendedIndex}. ${recommended.label} — ${params.recommendationReason}`,
                  ),
                footerLines,
              );
              footerLines.push("");
              addWrappedWithPrefix(
                " ",
                theme.fg(
                  "dim",
                  `[1–${params.options.length}] Ziffer · [↑/↓] Auswahl · [Enter] Auswählen · [Esc] Abbrechen`,
                ),
                footerLines,
              );
            }
            footerLines.push(theme.fg("accent", "─".repeat(renderWidth)));

            function buildOptionBlock(opt: DisplayOption, i: number): string[] {
              const block: string[] = [];
              const selected = i === optionIndex;
              const prefix = selected ? theme.fg("accent", "> ") : "  ";

              if (opt.isOther === true) {
                const label = `${i + 1}. ${opt.label}${editMode ? " ✎" : ""}`;
                const color = selected || editMode ? "accent" : "text";
                addWrappedWithPrefix(prefix, theme.fg(color, label), block);
                block.push("");
                return block;
              }

              const isRecommended = i === recommendedDisplayIndex;
              const color = selected ? "accent" : "text";
              const tag = isRecommended
                ? theme.fg("success", "  EMPFOHLEN")
                : "";
              addWrappedWithPrefix(
                prefix,
                theme.fg(color, `${i + 1}. ${opt.label}`) + tag,
                block,
              );
              addWrappedWithPrefix(
                optionIndent,
                theme.fg("muted", opt.description),
                block,
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
                block,
              );
              if (opt.pro) {
                addWrappedWithPrefix(
                  optionIndent,
                  theme.fg("muted", `Vorteil: ${opt.pro}`),
                  block,
                );
              }
              if (opt.contra) {
                addWrappedWithPrefix(
                  optionIndent,
                  theme.fg("muted", `Nachteil: ${opt.contra}`),
                  block,
                );
              }
              block.push("");
              return block;
            }

            // Jede Option ist ein Block mit variabler Höhe (Label + Beschreibung +
            // Aufwand/Risiko + optional Vor-/Nachteil). calculateMenuViewport hält
            // die aktuelle Auswahl im sichtbaren Fenster, unabhängig davon, wie
            // hoch die einzelnen Blöcke sind.
            const optionBlocks = allOptions.map((opt, i) =>
              buildOptionBlock(opt, i),
            );
            const lineCounts = optionBlocks.map((block) => block.length);

            const margin = overlayMargin(tui.terminal.columns, rows);
            const maxHeight = Math.max(1, rows - margin * 2);
            const fixed = lines.length + footerLines.length;
            const budget = Math.max(1, maxHeight - fixed);
            const view = calculateMenuViewport(
              lineCounts,
              optionIndex,
              viewportStart,
              budget,
            );
            viewportStart = view.start;
            visibleEntries = Math.max(1, view.end - view.start);

            if (view.showAbove) {
              addWrappedWithPrefix(
                " ",
                theme.fg("dim", `↑ ${view.start} weitere Optionen`),
                lines,
              );
            }
            let remaining = view.contentLineBudget;
            for (
              let index = view.start;
              index < view.end && remaining > 0;
              index++
            ) {
              const block = optionBlocks[index]!;
              const fitted =
                block.length <= remaining ? block : block.slice(0, remaining);
              lines.push(...fitted);
              remaining -= fitted.length;
            }
            if (view.showBelow) {
              addWrappedWithPrefix(
                " ",
                theme.fg(
                  "dim",
                  `↓ ${allOptions.length - view.end} weitere Optionen`,
                ),
                lines,
              );
            }

            lines.push(...footerLines);

            if (renderWidth < 4) {
              cachedLines = lines;
              cachedWidth = renderWidth;
              cachedRows = rows;
              return lines;
            }
            const innerWidth = renderWidth - 2;
            const border = theme.fg("border", "│");
            const framed = [
              theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
              ...lines
                .slice(1, -1)
                .map(
                  (entry) =>
                    `${border}${truncateToWidth(entry, innerWidth, "…", true)}${border}`,
                ),
              theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
            ];
            cachedLines = framed;
            cachedWidth = renderWidth;
            cachedRows = rows;
            return framed;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        },
        {
          overlay: true,
          overlayOptions: () => {
            const size = terminal();
            const margin = overlayMargin(size.columns, size.rows);
            return {
              anchor: "center",
              width: "90%",
              maxHeight: Math.max(1, size.rows - margin * 2),
              margin,
            };
          },
        },
      );

      // Build simple options list for details
      const simpleOptions = params.options.map((o) => o.label);

      if (!result) {
        return {
          content: [{ type: "text", text: "Auswahl abgebrochen" }],
          details: {
            question: params.question,
            options: simpleOptions,
            answer: null,
          } as QuestionDetails,
        };
      }

      if (result.wasCustom) {
        return {
          content: [{ type: "text", text: `Eigene Eingabe: ${result.answer}` }],
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
            text: `Ausgewählt: ${result.index}. ${result.answer}`,
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
        text += `\n${theme.fg("dim", "  Optionen: ")}${parts.join(theme.fg("dim", ", "))}`;
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
        return new Text(theme.fg("warning", "Abgebrochen"), 0, 0);
      }

      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(eigene Eingabe) ") +
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
