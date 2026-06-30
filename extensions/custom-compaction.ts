/**
 * Full-context compaction with a validated continuation summary.
 */

import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";

export const REQUIRED_COMPACTION_SECTIONS = [
  "Ziele",
  "Entscheidungen",
  "Betroffene Dateien",
  "Offene Todos",
  "Risiken",
  "Letzter Zustand",
  "Nächste Schritte",
] as const;

export function getMissingCompactionSections(summary: string): string[] {
  const headings = new Set(
    [...summary.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) =>
      match[1].trim().toLocaleLowerCase("de-DE"),
    ),
  );
  return REQUIRED_COMPACTION_SECTIONS.filter(
    (section) => !headings.has(section.toLocaleLowerCase("de-DE")),
  );
}

function responseText(response: Awaited<ReturnType<typeof complete>>): string {
  return response.content
    .filter((content): content is { type: "text"; text: string } =>
      content.type === "text",
    )
    .map((content) => content.text)
    .join("\n")
    .trim();
}

export default function customCompaction(pi: ExtensionAPI): void {
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal, customInstructions } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      tokensBefore,
      firstKeptEntryId,
      previousSummary,
    } = preparation;

    const settings =
      (
        pi as unknown as { getSettings?: () => Record<string, unknown> }
      ).getSettings?.() ?? {};
    const configuredModelId =
      (settings["custom-compaction"] as { model?: string } | undefined)
        ?.model ?? "google/gemini-2.5-flash";
    const model = ctx.modelRegistry.find("openrouter", configuredModelId);

    if (!model) {
      ctx.ui.notify(
        `Kompaktierungs-Modell nicht gefunden: ${configuredModelId}. Kompaktierung wurde zum Schutz des Kontexts abgebrochen.`,
        "error",
      );
      return { cancel: true };
    }

    let auth: Awaited<ReturnType<typeof ctx.modelRegistry.getApiKeyAndHeaders>>;
    try {
      auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Compaction-Authentifizierung fehlgeschlagen: ${message}. Der bestehende Kontext bleibt erhalten.`,
        "error",
      );
      return { cancel: true };
    }
    if (!auth.ok || !auth.apiKey) {
      const reason = auth.ok ? "Kein API-Key verfügbar." : auth.error;
      ctx.ui.notify(
        `Compaction-Authentifizierung fehlgeschlagen: ${reason} Der bestehende Kontext bleibt erhalten.`,
        "error",
      );
      return { cancel: true };
    }

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    let conversationText: string;
    try {
      conversationText = serializeConversation(convertToLlm(allMessages));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Compaction-Kontext konnte nicht serialisiert werden: ${message}. Der bestehende Kontext bleibt erhalten.`,
        "error",
      );
      return { cancel: true };
    }
    const requiredHeadings = REQUIRED_COMPACTION_SECTIONS.map(
      (section) => `## ${section}`,
    ).join("\n");
    const previousContext = previousSummary?.trim()
      ? `\n\nVorherige Zusammenfassung:\n${previousSummary}`
      : "";
    const additionalInstructions = customInstructions?.trim()
      ? `\n\nZusätzliche Anweisung des Nutzers:\n${customInstructions}`
      : "";

    const initialPrompt = `Erstelle eine belastbare Fortsetzungszusammenfassung der gesamten Unterhaltung.
Die Zusammenfassung ersetzt den alten Kontext. Fakten dürfen nicht erfunden werden.
Verwende exakt diese sieben Markdown-Überschriften und fülle jede aus. Schreibe "Keine", wenn nichts vorliegt:

${requiredHeadings}

Unter "Letzter Zustand" müssen der zuletzt bekannte Arbeitszustand und bereits ausgeführte Checks stehen.
Unter "Offene Todos" und "Nächste Schritte" müssen verbleibende Arbeiten eindeutig erkennbar sein.${previousContext}${additionalInstructions}

<conversation>
${conversationText}
</conversation>`;

    const summaryMessages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: initialPrompt }],
        timestamp: Date.now(),
      },
    ];

    try {
      ctx.ui.notify(
        `Custom Compaction: ${allMessages.length} Nachrichten (${tokensBefore.toLocaleString()} Tokens) mit ${model.id}.`,
        "info",
      );

      const firstResponse = await complete(
        model,
        { messages: summaryMessages },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 8192,
          signal,
        },
      );
      let summary = responseText(firstResponse);
      let missing = getMissingCompactionSections(summary);

      if (!summary || missing.length > 0) {
        ctx.ui.notify(
          `Compaction-Summary unvollständig; ein Reparaturversuch wird ausgeführt. Fehlend: ${missing.join(", ") || "gesamte Summary"}`,
          "warning",
        );
        summaryMessages.push(
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: summary || "(Leere Zusammenfassung)",
              },
            ],
            timestamp: Date.now(),
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Überarbeite die Zusammenfassung vollständig. Nutze exakt alle folgenden Überschriften und keine Ersatzbezeichnungen:\n\n${requiredHeadings}`,
              },
            ],
            timestamp: Date.now(),
          },
        );

        const repairResponse = await complete(
          model,
          { messages: summaryMessages },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            maxTokens: 8192,
            signal,
          },
        );
        summary = responseText(repairResponse);
        missing = getMissingCompactionSections(summary);
      }

      if (signal.aborted) return { cancel: true };
      if (!summary || missing.length > 0) {
        ctx.ui.notify(
          `Compaction abgebrochen: Pflichtsektionen fehlen weiterhin (${missing.join(", ") || "leere Summary"}). Der bestehende Kontext bleibt erhalten.`,
          "error",
        );
        return { cancel: true };
      }

      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
          details: {
            format: "daydaylx-required-sections-v1",
            sections: [...REQUIRED_COMPACTION_SECTIONS],
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Compaction fehlgeschlagen: ${message}. Der bestehende Kontext bleibt erhalten.`,
        "error",
      );
      return { cancel: true };
    }
  });
}
