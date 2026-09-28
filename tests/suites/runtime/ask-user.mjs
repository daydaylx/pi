import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import {
  assertNoGlobalChrome,
  createHarness,
  stripAnsi,
} from "../../shared/harness.mjs";

export const askUserSections = {
  "ask-user temporary dialog": async (context) => {
    const { section, askUser, askUserPolicy } = context;

    await section("ask-user temporary dialog", async () => {
      if (!askUser || !askUserPolicy) return;
      eq(
        askUserPolicy.hasValidQuestionOptionCount(2),
        true,
        "ask_user accepts two options",
      );
      eq(
        askUserPolicy.hasValidQuestionOptionCount(4),
        true,
        "ask_user accepts four options",
      );
      eq(
        askUserPolicy.hasValidQuestionOptionCount(5),
        false,
        "ask_user rejects five options",
      );
      eq(
        askUserPolicy.digitSelection("2", 2),
        2,
        "direct digit selection works",
      );
      eq(
        askUserPolicy.digitSelection("3", 2),
        undefined,
        "digits never select the custom-input row",
      );
      eq(
        askUserPolicy.clampRecommendedIndex(4, 2),
        2,
        "clampRecommendedIndex caps a schema-valid but out-of-range index to the last real option",
      );
      eq(
        askUserPolicy.clampRecommendedIndex(0, 2),
        1,
        "clampRecommendedIndex floors a zero index to the first option",
      );
      eq(
        askUserPolicy.clampRecommendedIndex(-3, 2),
        1,
        "clampRecommendedIndex floors a negative index to the first option",
      );
      eq(
        askUserPolicy.clampRecommendedIndex(1.5, 2),
        1,
        "clampRecommendedIndex falls back to 1 for a non-integer index",
      );
      eq(
        askUserPolicy.clampRecommendedIndex(2, 0),
        1,
        "clampRecommendedIndex never returns below 1 even with zero options",
      );
      eq(
        askUserPolicy.isValidRecommendedIndex(4, 2),
        false,
        "isValidRecommendedIndex rejects an index beyond the actual option count",
      );
      eq(
        askUserPolicy.isValidRecommendedIndex(0, 2),
        false,
        "isValidRecommendedIndex rejects a zero index",
      );
      eq(
        askUserPolicy.isValidRecommendedIndex(1.5, 2),
        false,
        "isValidRecommendedIndex rejects a non-integer index",
      );
      eq(
        askUserPolicy.isValidRecommendedIndex(2, 2),
        true,
        "isValidRecommendedIndex accepts an index equal to the option count",
      );

      const harness = createHarness({ columns: 24 });
      askUser.default(harness.api);
      const tool = harness.tools.get("ask_user");
      assert(Boolean(tool), "ask_user is registered");
      if (!tool) return;
      const context = harness.makeContext();
      const params = {
        question:
          "Welche sichere Option soll bei schmalem Terminal gewählt werden?",
        why: "Die Auswahl muss ohne globale UI funktionieren.",
        options: [
          {
            label: "Lesen",
            description: "Nur prüfen.",
            effort: "niedrig",
            risk: "niedrig",
          },
          {
            label: "Planen",
            description: "Einen strukturierten Plan vorbereiten.",
            effort: "mittel",
            risk: "niedrig",
          },
        ],
        recommendedIndex: 2,
        recommendationReason: "Eine klare nächste Entscheidung.",
      };
      const pending = tool.execute(
        "ask-user-test",
        params,
        undefined,
        undefined,
        context,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const component = harness.customComponents.at(-1);
      assert(Boolean(component), "ask_user opens a temporary native dialog");
      if (!component) return;
      assert(
        component.render(24).every((line) => stripAnsi(line).length <= 24),
        "ask_user renders within a narrow 24-column terminal",
      );
      component.handleInput("2");
      const result = await pending;
      eq(
        result.details.answer,
        "Planen",
        "keyboard selection returns the choice",
      );
      eq(result.details.selectedIndex, 2, "selected index remains one-based");
      assertNoGlobalChrome(harness, "ask_user uses no global editor or widget");

      const nonTui = createHarness();
      askUser.default(nonTui.api);
      const nonTuiTool = nonTui.tools.get("ask_user");
      for (const mode of ["json", "print", "rpc"]) {
        const resultForMode = await nonTuiTool.execute(
          "ask-user-non-tui",
          params,
          undefined,
          undefined,
          nonTui.makeContext({ mode, hasUI: false }),
        );
        assert(
          resultForMode.content[0].text.includes(
            "benötigt den interaktiven TUI-Modus",
          ),
          "ask_user returns a structured error in " + mode + " mode",
        );
        eq(
          resultForMode.terminate,
          true,
          "ask_user terminates the non-interactive batch instead of inviting a retry",
        );
      }
      eq(
        nonTui.customComponents.length,
        0,
        "ask_user opens no dialog outside TUI",
      );

      // Keyboard navigation and the free-text path. Digit selection above is
      // the shortcut; these are the routes a user takes when the option they
      // want is not one of the first nine, or is not offered at all.
      const ESC = String.fromCharCode(27);
      const KEYS = {
        up: ESC + "[A",
        down: ESC + "[B",
        home: ESC + "[H",
        end: ESC + "[F",
        pageUp: ESC + "[5~",
        pageDown: ESC + "[6~",
        enter: "\r",
        escape: ESC,
        ctrlC: String.fromCharCode(3),
      };

      async function openDialog(id) {
        const dialogHarness = createHarness({ columns: 80 });
        askUser.default(dialogHarness.api);
        const pendingResult = dialogHarness.tools
          .get("ask_user")
          .execute(
            id,
            params,
            undefined,
            undefined,
            dialogHarness.makeContext(),
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          harness: dialogHarness,
          pending: pendingResult,
          dialog: dialogHarness.customComponents.at(-1),
        };
      }

      {
        // End jumps past the real options onto the free-text entry, Enter opens
        // it, and Escape leaves edit mode without ending the dialog.
        const { pending, dialog } = await openDialog("ask-user-freetext");
        dialog.handleInput(KEYS.end);
        dialog.handleInput(KEYS.enter);
        const editing = stripAnsi(dialog.render(80).join("\n"));
        dialog.handleInput(KEYS.escape);
        assert(
          stripAnsi(dialog.render(80).join("\n")) !== editing,
          "Escape leaves the free-text editor instead of closing the dialog",
        );
        dialog.handleInput(KEYS.home);
        dialog.handleInput(KEYS.enter);
        const result = await pending;
        eq(
          result.details.answer,
          "Lesen",
          "Home returns to the first option and Enter selects it",
        );
      }

      {
        // Down/up/pageDown/pageUp all move within bounds; the dialog must not
        // run off either end.
        const { pending, dialog } = await openDialog("ask-user-navigation");
        dialog.handleInput(KEYS.pageUp);
        dialog.handleInput(KEYS.up);
        dialog.handleInput(KEYS.down);
        dialog.handleInput(KEYS.pageDown);
        dialog.handleInput(KEYS.pageDown);
        dialog.handleInput(KEYS.up);
        dialog.handleInput(KEYS.enter);
        const result = await pending;
        eq(
          result.details.answer,
          "Planen",
          "navigation stays inside the option list and selects the second entry",
        );
      }

      for (const [key, label] of [
        [KEYS.escape, "Escape"],
        [KEYS.ctrlC, "Ctrl+C"],
      ]) {
        const { pending, dialog } = await openDialog("ask-user-cancel");
        dialog.handleInput(key);
        const result = await pending;
        assert(
          result.isError === true ||
            /abgebrochen|cancel/i.test(result.content[0].text),
          `${label} cancels the dialog instead of answering it`,
        );
      }

      {
        // A short terminal with several verbose options must window itself
        // instead of overflowing, and moving the selection must scroll
        // previously hidden options into view.
        const overflowRows = 18;
        const overflowHarness = createHarness({
          columns: 80,
          rows: overflowRows,
        });
        askUser.default(overflowHarness.api);
        const overflowParams = {
          question: "Welchen Ansatz sollen wir für die Migration wählen?",
          why: "Die Entscheidung betrifft mehrere Teams und ist schwer rückgängig zu machen.",
          options: [
            {
              label: "Big Bang",
              description:
                "Alle Dienste in einem einzigen Wartungsfenster gleichzeitig migrieren, um Zwischenzustände zu vermeiden.",
              effort: "hoch",
              risk: "hoch",
              pro: "Kein Zwischenzustand mit zwei parallelen Systemen.",
              contra: "Ein Fehler betrifft sofort alle Nutzer gleichzeitig.",
            },
            {
              label: "Schrittweise",
              description:
                "Dienst für Dienst migrieren und zwischen den Schritten jeweils beobachten, ob alles stabil läuft.",
              effort: "mittel",
              risk: "mittel",
              pro: "Probleme lassen sich früh und isoliert erkennen.",
              contra: "Migration dauert insgesamt deutlich länger.",
            },
            {
              label: "Parallelbetrieb",
              description:
                "Altes und neues System für einen längeren Zeitraum parallel betreiben und schrittweise Traffic verschieben.",
              effort: "hoch",
              risk: "niedrig",
              pro: "Rollback ist jederzeit ohne Datenverlust möglich.",
              contra:
                "Erfordert doppelte Infrastruktur während der Übergangszeit.",
            },
            {
              label: "Verschieben",
              description:
                "Die Migration auf einen späteren Zeitpunkt verschieben und zunächst andere Prioritäten bearbeiten.",
              effort: "niedrig",
              risk: "niedrig",
              pro: "Kein Risiko für den laufenden Betrieb in dieser Phase.",
              contra: "Technische Schulden wachsen in der Zwischenzeit weiter.",
            },
          ],
          recommendedIndex: 2,
          recommendationReason:
            "Bietet die beste Balance aus Tempo und Sicherheit.",
        };
        const overflowPending = overflowHarness.tools
          .get("ask_user")
          .execute(
            "ask-user-overflow",
            overflowParams,
            undefined,
            undefined,
            overflowHarness.makeContext(),
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        const overflowDialog = overflowHarness.customComponents.at(-1);

        const initialLines = overflowDialog.render(80);
        assert(
          initialLines.length <= overflowRows - 2,
          `option list stays within the terminal height instead of overflowing (got ${initialLines.length} lines for ${overflowRows} rows)`,
        );
        const initial = stripAnsi(initialLines.join("\n"));
        assert(
          initial.includes("weitere Optionen"),
          "a scroll indicator appears when not all options fit",
        );
        assert(
          !initial.includes("Verschieben"),
          "the last option starts outside the initial viewport",
        );

        overflowDialog.handleInput(KEYS.down);
        overflowDialog.handleInput(KEYS.down);
        const afterDown = stripAnsi(overflowDialog.render(80).join("\n"));
        assert(
          afterDown.includes("Verschieben"),
          "moving down scrolls the fourth option into view",
        );
        assert(
          afterDown.includes("↑") && afterDown.includes("weitere Optionen"),
          "the indicator flips to point upward once scrolled past the first option",
        );

        overflowDialog.handleInput(KEYS.ctrlC);
        const overflowResult = await overflowPending;
        assert(
          overflowResult.isError === true ||
            /abgebrochen/i.test(overflowResult.content[0].text),
          "Ctrl+C still cancels the dialog after scrolling",
        );
      }

      {
        // The free-text editor's actual submit path: type real text and
        // press Enter, instead of only leaving the editor via Escape (the
        // navigation test above never exercises editor.onSubmit itself).
        const { pending, dialog } = await openDialog(
          "ask-user-freetext-submit",
        );
        dialog.handleInput(KEYS.end);
        dialog.handleInput(KEYS.enter);
        dialog.handleInput("h");
        dialog.handleInput("i");
        dialog.handleInput(KEYS.enter);
        const result = await pending;
        eq(
          result.details.wasCustom,
          true,
          "typed free text is submitted as a custom answer",
        );
        eq(result.details.answer, "hi", "the typed text is returned verbatim");
      }

      {
        // Submitting the free-text editor with no text (or only whitespace)
        // must return to the options view, not close the dialog.
        const { pending, dialog } = await openDialog("ask-user-freetext-empty");
        dialog.handleInput(KEYS.end);
        dialog.handleInput(KEYS.enter);
        const editingEmpty = stripAnsi(dialog.render(80).join("\n"));
        dialog.handleInput(KEYS.enter);
        const afterEmptySubmit = stripAnsi(dialog.render(80).join("\n"));
        assert(
          afterEmptySubmit !== editingEmpty,
          "submitting empty free text leaves the editor instead of closing the dialog",
        );
        dialog.handleInput(KEYS.home);
        dialog.handleInput(KEYS.enter);
        const result = await pending;
        eq(
          result.details.answer,
          "Lesen",
          "the dialog is still usable after an empty free-text submit",
        );
      }

      {
        // An extremely narrow render width (narrower than the option
        // indent/prefix itself) must fall back to un-indented wrapping
        // instead of throwing.
        const { dialog } = await openDialog("ask-user-tiny-width");
        const tinyLines = dialog.render(1);
        assert(
          Array.isArray(tinyLines) && tinyLines.length > 0,
          "rendering at width 1 falls back gracefully instead of throwing",
        );
        dialog.invalidate();
        const afterInvalidate = dialog.render(80);
        assert(
          Array.isArray(afterInvalidate) && afterInvalidate.length > 0,
          "invalidate() clears the line cache without breaking the next render",
        );
      }

      {
        // renderCall/renderResult are only exercised by the message renderer
        // in real usage, never by tool.execute() directly above.
        const theme = createHarness().makeContext().ui.theme;

        const callText = stripAnsi(
          tool.renderCall(params, theme, {}).render(200).join("\n"),
        );
        assert(
          callText.includes(params.question),
          "renderCall shows the question",
        );
        assert(
          callText.includes("2. Planen") && callText.includes("EMPFOHLEN"),
          "renderCall marks the recommended option",
        );

        const emptyOptionsCall = tool
          .renderCall({ question: "Ohne Optionen?", options: [] }, theme, {})
          .render(200)
          .join("\n")
          .trim();
        eq(
          stripAnsi(emptyOptionsCall),
          "ask_user Ohne Optionen?",
          "renderCall without options omits the options line",
        );

        const selectedText = stripAnsi(
          tool
            .renderResult(
              {
                content: [{ type: "text", text: "Ausgewählt: 2. Planen" }],
                details: {
                  question: params.question,
                  options: params.options.map((o) => o.label),
                  answer: "Planen",
                  wasCustom: false,
                  selectedIndex: 2,
                },
              },
              { expanded: false, isPartial: false },
              theme,
              { args: params },
            )
            .render(200)
            .join("\n"),
        );
        assert(
          selectedText.includes("2. Planen"),
          "renderResult shows the selected option",
        );
        assert(
          selectedText.includes("Einen strukturierten Plan"),
          "renderResult attaches the chosen option's description",
        );

        const customText = stripAnsi(
          tool
            .renderResult(
              {
                content: [{ type: "text", text: "Eigene Eingabe: irgendwas" }],
                details: {
                  question: params.question,
                  options: params.options.map((o) => o.label),
                  answer: "irgendwas",
                  wasCustom: true,
                },
              },
              { expanded: false, isPartial: false },
              theme,
              { args: params },
            )
            .render(200)
            .join("\n"),
        );
        assert(
          customText.includes("(eigene Eingabe)") &&
            customText.includes("irgendwas"),
          "renderResult marks a free-text answer",
        );

        const cancelledText = stripAnsi(
          tool
            .renderResult(
              {
                content: [{ type: "text", text: "Auswahl abgebrochen" }],
                details: {
                  question: params.question,
                  options: [],
                  answer: null,
                },
              },
              { expanded: false, isPartial: false },
              theme,
              { args: params },
            )
            .render(200)
            .join("\n"),
        );
        assert(
          /abgebrochen/i.test(cancelledText),
          "renderResult marks a cancelled dialog",
        );

        const noDetailsText = stripAnsi(
          tool
            .renderResult(
              { content: [{ type: "text", text: "raw text" }] },
              { expanded: false, isPartial: false },
              theme,
              { args: params },
            )
            .render(200)
            .join("\n"),
        ).trim();
        eq(
          noDetailsText,
          "raw text",
          "renderResult falls back to the raw content text when details are missing",
        );
      }

      {
        // The shared harness's ui.custom() mock does not forward the
        // {overlayOptions} config object ask_user passes for dialog
        // placement, so normal dialog-opening tests never run it. Capture
        // and invoke it directly instead.
        const overlayHarness = createHarness({ columns: 80 });
        askUser.default(overlayHarness.api);
        const overlayContext = overlayHarness.makeContext();
        let capturedOverlayOptions;
        const originalCustom = overlayContext.ui.custom;
        overlayContext.ui.custom = (factory, options) => {
          capturedOverlayOptions = options?.overlayOptions;
          return originalCustom(factory);
        };
        const overlayPending = overlayHarness.tools
          .get("ask_user")
          .execute(
            "ask-user-overlay-options",
            params,
            undefined,
            undefined,
            overlayContext,
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert(
          typeof capturedOverlayOptions === "function",
          "ask_user passes an overlayOptions callback for dialog placement",
        );
        const geometry = capturedOverlayOptions();
        assert(
          geometry.anchor === "center" &&
            typeof geometry.maxHeight === "number",
          "overlayOptions computes dialog placement from the terminal size",
        );
        overlayHarness.customComponents.at(-1).handleInput(KEYS.ctrlC);
        await overlayPending;
      }
    });
  },
};
