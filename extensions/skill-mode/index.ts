/**
 * Skill-Mode Extension
 *
 * Bietet einen menübasierten Skill-Launcher für den Pi Agent.
 *
 * Aufruf:
 *   Shift+Tab → "Skill-Modus" auswählen → Skill wählen → Ausführungsmodus
 *   wählen → Skill wird im nächsten Agent-Turn ausgeführt.
 *
 * Direkter Befehl:
 *   /skill <skill-id> [mode]
 *
 * Architektur:
 *   - Skill-Definitionen in skill-catalog.ts
 *   - Menu-Builder in skill-menu.ts
 *   - Diese Datei enthält die Extension-Logik (Menü-Flow, Kontext-Injektion)
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { runMenu } from "../shared/menu-ui.ts";
import {
  SKILL_CATALOG,
  findSkill,
  type SkillDefinition,
  type SkillExecutionMode,
} from "./skill-catalog.ts";
import {
  buildSkillSelectionMenu,
  buildExecutionModeMenu,
  buildWorkConfirmationMenu,
} from "./skill-menu.ts";
import {
  SKILL_LAUNCHER_REQUEST_EVENT,
  type SkillLauncherRequest,
} from "../shared/workflow-status.ts";

// Context-Marker (analog zu plan-mode/index.ts), damit der Skill-Kontext
// erkennbar und filterbar bleibt.
const SKILL_CONTEXT_MARKER = "[SKILL MODE ACTIVE]";

interface ActiveSkill {
  skill: SkillDefinition;
  mode: SkillExecutionMode;
}

export default function skillModeExtension(pi: ExtensionAPI): void {
  let activeSkill: ActiveSkill | null = null;

  // ---------------------------------------------------------------------------
  // Event-Handler: Skill-Launcher aus dem Modusmenü (Shift+Tab → Skill-Modus)
  // ---------------------------------------------------------------------------

  pi.events.on(
    SKILL_LAUNCHER_REQUEST_EVENT,
    (request: SkillLauncherRequest) => {
      void openSkillLauncher(request.ctx);
    },
  );

  // ---------------------------------------------------------------------------
  // Menü-Flow: Skill auswählen → Ausführungsmodus wählen → Kontext injizieren
  // ---------------------------------------------------------------------------

  async function openSkillLauncher(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify("Skill-Launcher benötigt den TUI-Modus.", "warning");
      return;
    }

    // Schritt 1: Skill auswählen
    const skillId = await runMenu<string>(
      ctx,
      "Skill auswählen",
      buildSkillSelectionMenu(),
      {
        fallbackPrompt: "Skill wählen",
        nonInteractiveHint:
          "Nutze /skill <id>, um einen Skill direkt zu starten.",
      },
    );

    if (!skillId) return;

    const skill = findSkill(skillId);
    if (!skill) {
      ctx.ui.notify(`Skill "${skillId}" nicht gefunden.`, "error");
      return;
    }

    // Schritt 2: Ausführungsmodus wählen
    const mode = await runMenu<SkillExecutionMode>(
      ctx,
      `Skill: ${skill.title}`,
      buildExecutionModeMenu(skill),
      {
        fallbackPrompt: "Ausführungsmodus wählen",
        nonInteractiveHint: `Nutze /skill ${skill.id} <mode> für direkten Start.`,
      },
    );

    if (!mode) return;

    // Schritt 3: Bei Work-Modus extra Bestätigung einholen
    if (mode === "work") {
      const confirmed = await runMenu<"confirm" | "cancel">(
        ctx,
        `Work-Modus bestätigen — ${skill.title}`,
        buildWorkConfirmationMenu(skill),
        {
          fallbackPrompt: "Work-Modus bestätigen",
        },
      );

      if (!confirmed || confirmed === "cancel") {
        ctx.ui.notify("Skill-Ausführung abgebrochen.", "info");
        return;
      }
    }

    // Schritt 4: Skill aktivieren und Kontext injizieren
    activeSkill = { skill, mode };
    injectSkillContext(ctx);
    ctx.ui.notify(
      `Skill "${skill.title}" aktiv (${mode}). Die nächste Nachricht startet die Ausführung.`,
      "info",
    );
  }

  // ---------------------------------------------------------------------------
  // Kontext-Injektion
  // ---------------------------------------------------------------------------

  function buildSkillPrompt(
    skill: SkillDefinition,
    mode: SkillExecutionMode,
  ): string {
    const basePrompt = skill.systemPrompt;

    const modeInstructions: Record<SkillExecutionMode, string> = {
      info: `
AUSFÜHRUNGSMODUS: Nur Informationen sammeln
- Du darfst ausschließlich lesen, suchen, vergleichen und analysieren.
- Keine Änderungen an Dateien, keine Pläne, keine Umsetzung.
- Keine neuen Dependencies, Commits oder Pushes.
- Nutze bei breiter Exploration über mehrere Dateien/Verzeichnisse aktiv das \`subagent\`-Tool (\`scout\`, siehe AGENTS.md → Subagenten-Delegation).
- Halte dich exakt an das Ausgabeformat des Skills.`,
      analysis: `
AUSFÜHRUNGSMODUS: Analyse mit Risiken
- Sammle Informationen und bewerte sie.
- Markiere Risiken, offene Fragen und unsichere Annahmen.
- Keine Änderungen an Dateien ohne explizite Nutzerfreigabe.
- Ziehe bei Architektur-/Risikofragen aktiv das \`subagent\`-Tool (\`architect\`) für eine Zweitmeinung hinzu (siehe AGENTS.md → Subagenten-Delegation).
- Gib konkrete, priorisierte Empfehlungen.
- Halte dich exakt an das Ausgabeformat des Skills.`,
      plan: `
AUSFÜHRUNGSMODUS: Plan erstellen
- Erstelle einen strukturierten Arbeitsplan.
- Führe die Aufgabe NICHT aus und ändere KEINE Projektdateien (außer der Plan-Datei).
- Der Plan muss alle im Skill definierten Abschnitte enthalten.
- Nutze bei Bedarf aktiv das \`subagent\`-Tool (\`scout\` für Kontext, \`planner\` für den Planentwurf, siehe AGENTS.md → Subagenten-Delegation), bevor der finale Plan geschrieben wird.
- Bei mehrdeutigen Entscheidungen: mit ask_user klären, bevor der Plan finalisiert wird.
- Schreibe den finalen Plan nach docs/plans/current-plan.md.`,
      work: `
AUSFÜHRUNGSMODUS: Umsetzung
- Führe die Aufgabe gemäß dem Skill-Workflow aus.
- Änderungen sind erlaubt, aber:
  - Keine neuen Dependencies ohne Rückfrage.
  - Keine Commits/Pushes ohne ausdrückliche Freigabe.
  - Keine großflächigen Refactorings oder Formatierungen außerhalb des Scopes.
  - Bei Unsicherheit: nachfragen, nicht raten.
- Nutze nach Änderungen bei Bedarf aktiv das \`subagent\`-Tool (\`reviewer\`/\`security-auditor\`/\`test-runner\`, siehe AGENTS.md → Subagenten-Delegation).
- Dokumentiere, was geändert wurde und warum.`,
    };

    return `${SKILL_CONTEXT_MARKER}
${basePrompt}

${modeInstructions[mode]}

Wichtig: Dieser Skill-Kontext gilt nur für diesen Turn. Danach kehrst du in den normalen Modus zurück.`;
  }

  function injectSkillContext(ctx: ExtensionContext): void {
    if (!activeSkill) return;

    const prompt = buildSkillPrompt(activeSkill.skill, activeSkill.mode);

    pi.sendMessage(
      {
        customType: "skill-context",
        content: prompt,
        display: false,
      },
      { triggerTurn: false },
    );
  }

  // ---------------------------------------------------------------------------
  // /skill-Befehl: direkter Skill-Start ohne Menü
  // ---------------------------------------------------------------------------

  pi.registerCommand("skill", {
    description: "Skill direkt starten: /skill <id> [info|analysis|plan|work]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        // Kein Argument → Menü öffnen
        await openSkillLauncher(ctx);
        return;
      }

      const skillId = parts[0];
      const skill = findSkill(skillId);
      if (!skill) {
        const available = SKILL_CATALOG.map((s) => s.id).join(", ");
        ctx.ui.notify(
          `Skill "${skillId}" nicht gefunden. Verfügbar: ${available}`,
          "error",
        );
        return;
      }

      let mode: SkillExecutionMode = skill.defaultMode;
      if (parts.length >= 2) {
        const requested = parts[1].toLowerCase();
        if (["info", "analysis", "plan", "work"].includes(requested)) {
          mode = requested as SkillExecutionMode;
        } else {
          ctx.ui.notify(
            `Unbekannter Modus "${requested}". Erwartet: info, analysis, plan, work.`,
            "warning",
          );
          return;
        }
      }

      if (mode === "work") {
        if (ctx.hasUI && ctx.mode === "tui") {
          const confirmed = await ctx.ui.confirm(
            `Work-Modus für "${skill.title}" starten?`,
            "Der Agent erhält Schreibzugriff und führt die Aufgabe aus.",
          );
          if (!confirmed) {
            ctx.ui.notify("Skill-Ausführung abgebrochen.", "info");
            return;
          }
        } else {
          ctx.ui.notify(
            `Work-Modus benötigt im TUI eine Bestätigung. Nutze /skill ${skill.id} info für Read-only.`,
            "warning",
          );
          return;
        }
      }

      activeSkill = { skill, mode };
      injectSkillContext(ctx);
      ctx.ui.notify(
        `Skill "${skill.title}" aktiv (${mode}). Beschreibe jetzt deine Aufgabe.`,
        "info",
      );
    },
  });

  // ---------------------------------------------------------------------------
  // Skill-Launcher über Shortcut
  // ---------------------------------------------------------------------------

  pi.registerShortcut("ctrl+alt+s", {
    description: "Skill-Launcher öffnen",
    handler: async (ctx) => {
      await openSkillLauncher(ctx);
    },
  });

  // ---------------------------------------------------------------------------
  // Context-Handler: Abgeschlossene Skill-Kontexte ausblenden.
  //
  // Solange `activeSkill` gesetzt ist, bleibt die injizierte Skill-Context-
  // Message sichtbar. Nach `agent_end` (Skill abgeschlossen) wird sie aus dem
  // Kontext gefiltert, damit der Skill die Folgeturns nicht mehr beeinflusst.
  // Die Message bleibt in der Session, wird aber nicht mehr berücksichtigt.
  // ---------------------------------------------------------------------------

  pi.on("context", async (event) => {
    if (activeSkill) return;

    return {
      messages: event.messages.filter((message) => {
        const candidate = message as { customType?: string };
        if (candidate.customType === "skill-context") return false;
        return true;
      }),
    };
  });

  // ---------------------------------------------------------------------------
  // Nach jedem Agent-Turn: Skill-Kontext zurücksetzen
  // (Skills gelten nur für einen Turn)
  // ---------------------------------------------------------------------------

  pi.on("agent_end", async (_event, ctx) => {
    if (!activeSkill) return;
    const skillTitle = activeSkill.skill.title;
    activeSkill = null;
    ctx.ui.notify(
      `Skill "${skillTitle}" abgeschlossen. Normaler Modus wieder aktiv.`,
      "info",
    );
  });
}
