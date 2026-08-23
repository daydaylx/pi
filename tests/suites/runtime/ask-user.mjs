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
    });
  },
};
