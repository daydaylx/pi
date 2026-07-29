/**
 * Planning and review turns.
 *
 * Owns the prompts AND the handlers that start, finish and review a plan.
 * Never writes project files: planning may only touch the plan itself
 * (Umbauvertrag §13.3).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowSession } from "./session.ts";
import { existsSync, readFileSync } from "node:fs";
import {
  PLAN_RELATIVE_PATH,
  finalizeObservedPlanCAS,
  loadDirectTask,
  workflowPath,
} from "./store/index.ts";
import {
  updateWorkflowPresentation,
  workflowWarning,
} from "./presentation.ts";

/** Read the plan file as written by the planning turn, if it exists. */
function planContent(cwd: string): string | undefined {
  const path = workflowPath(cwd, PLAN_RELATIVE_PATH);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}
import {
  finalizePlanDocument,
  type FinalizedPlanDocument,
  type PlanKind,
} from "./plan-snapshot.ts";

export const PLAN_FILE_INSTRUCTION = ".agent/plans/current-plan.md";

const REQUIRED_SECTIONS = `## Ziel
## Nicht-Ziele
## Gewählte Lösung
## Annahmen
## Umsetzungsschritte
## Betroffene Bereiche
## Technischer Scope
## Änderungsregeln
## Risiken
## Verifikation
## Abschlusskriterien`;

export function planningPrompt(kind: PlanKind): string {
const architecture =
    kind === "detailed_plan"
      ? `
Dies ist ein Architekturplan. Ergänze direkt nach „Annahmen“ den Abschnitt
„## Bewertete Optionen“ mit genau 2 bis 4 realistischen Optionen und einer
verständlichen Bewertung aus Erklärung, Schwäche, Auswirkung und Eignung.
Wenn die Richtungsentscheidung nicht bereits ausdrücklich vom Nutzer getroffen
wurde, hole sie mit ask_user ein, bevor du die finale Plan-Datei schreibst. Die
gewählte Option muss mit „Gewählte Lösung“ konsistent sein.`
      : `
Dies ist ein Quick Plan. Erfinde keine künstlichen Alternativen und erstelle
keinen Decision Brief.`;
  return `[PI WORKFLOW: PLANUNG]
Erstelle oder überarbeite ausschließlich ${PLAN_FILE_INSTRUCTION}. Implementiere
noch nichts. Der Plan ist der verbindliche fachliche Snapshot für die spätere
Ausführung. Schreibe präzise, projektbezogen und ohne Fortschrittsmarkierungen.

Verwende exakt diese H2-Abschnitte in dieser Reihenfolge:
${REQUIRED_SECTIONS}
${architecture}

Regeln:
- Automatisiere keine echte Richtungsentscheidung still. Nutze ask_user nur,
  wenn Alternativen Aufwand, Qualität, Wartbarkeit, Risiko oder Bedienung
  tatsächlich unterschiedlich beeinflussen.
- „Technischer Scope“ enthält ausschließlich sichere, projekt-relative Pfade
  oder Globs, je Eintrag eine Zeile.
- „Umsetzungsschritte“ ist eine nummerierte Liste konkreter, prüfbarer Schritte.
- „Verifikation“ nennt ausführbare .pi/verify.json-Profil-IDs; im Agent-Setup
  sind zusätzlich typecheck und test verfügbar.
- „Abschlusskriterien“ ist beobachtbar und prüfbar.
- Metadaten und unsichtbare Step-IDs werden nach dem Turn deterministisch ergänzt.
- Beende den Turn, sobald der Plan vollständig gespeichert ist.`;
}

export function finalizePlanningTurn(
  content: string,
  kind: PlanKind,
  previousContent?: string,
): FinalizedPlanDocument {
  return finalizePlanDocument(content, kind, previousContent);
}

export function reviewPrompt(content: string): string {
  return `[PI WORKFLOW: PLAN-REVIEW]
Prüfe den Plan ausschließlich inhaltlich und formal. Implementiere nichts.
Ändere bei notwendigen Korrekturen ausschließlich ${PLAN_FILE_INSTRUCTION}.
Achte besonders auf Scope, Annahmen, Risiken, Verifikation und messbare
Abschlusskriterien.

<plan>
${content}
</plan>`;
}

export async function choosePlanKind(
  args: string,
  ctx: ExtensionContext,
): Promise<PlanKind | undefined> {
  const normalized = args.trim().toLowerCase();
  if (["quick", "schnell", "simple"].includes(normalized))
    return "simple_plan";
  if (["architecture", "architektur", "detailed"].includes(normalized))
    return "detailed_plan";
  const choice = await ctx.ui.select("Planart", [
    "Schnellplan",
    "Architekturplan",
  ]);
  return choice === "Schnellplan"
    ? "simple_plan"
    : choice === "Architekturplan"
      ? "detailed_plan"
      : undefined;
}

export async function beginPlanning(
  session: WorkflowSession,
  kind: PlanKind,
  ctx: ExtensionContext,
): Promise<void> {
  if (!(await activatePlanningMode(session, kind, ctx))) return;
  session.pi.sendMessage(
    {
      customType: "pi-plan-request",
      content:
        kind === "detailed_plan"
          ? "Erstelle jetzt den Architekturplan."
          : "Erstelle jetzt den Schnellplan.",
      display: true,
    },
    { triggerTurn: true },
  );
  session.notify(ctx, "Planung gestartet; es wird noch nichts implementiert.");
}

/**
 * Select a planning mode without creating an agent turn.
 *
 * The next user prompt receives the planning context through before_agent_start.
 * Explicit launchers such as /plan call this first and then trigger their turn.
 */
export async function activatePlanningMode(
  session: WorkflowSession,
  kind: PlanKind,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Planung schreibt keine Artefakte in einem untrusted Projekt.",
      "error",
    );
    return false;
  }
  session.reload(ctx);
  if (loadDirectTask(ctx.cwd)) {
    session.notify(
      ctx,
      "Ein Direktauftrag ist aktiv; schließe ihn zuerst mit /task-done ab.",
      "warning",
    );
    return false;
  }
  if (session.current.migrationRequired) {
    session.notify(
      ctx,
      "Vor einer neuen Planung ist /migrate-plan erforderlich.",
      "warning",
    );
    return false;
  }
  if (session.current.planContent) {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      session.notify(
        ctx,
        "Ein Plan ist bereits aktiv; die Überschreibung erfordert eine Bestätigung im TUI-Modus. Nutze /discard-plan, um ihn zuerst zu verwerfen, oder starte /plan interaktiv.",
        "warning",
      );
      return false;
    }
    const confirmed = await ctx.ui.confirm(
      "Aktiven Plan überarbeiten?",
      "Die nächste Planrevision invalidiert bisherigen Fortschritt und Review.",
    );
    if (!confirmed) return false;
  }
  session.selectedMode = kind;
  session.planningKind = kind;
  session.planningBaseContent = session.current.planContent;
  session.planningIsReview = false;
  updateWorkflowPresentation(ctx, session.current.state, "planning", session.pi);
  session.publishWorkflowActivation(ctx);
  return true;
}

export async function beginReview(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Plan-Review ist im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  const loaded = session.reload(ctx);
  if (!loaded.snapshot || !loaded.planContent) {
    session.notify(ctx, "Kein gültiger PlanSnapshot v3 vorhanden.", "warning");
    return;
  }
  if (loaded.state?.status !== "planning") {
    session.notify(
      ctx,
      "/review-plan ist nur vor dem ersten /work verfügbar. Änderungen nach Ausführungsbeginn benötigen eine bestätigte Planrevision über /plan.",
      "warning",
    );
    return;
  }
  session.selectedMode = loaded.snapshot.planType;
  session.planningKind = loaded.snapshot.planType;
  session.planningBaseContent = loaded.planContent;
  session.planningIsReview = true;
  updateWorkflowPresentation(ctx, loaded.state, "reviewing", session.pi);
  session.publishWorkflowActivation(ctx);
  session.pi.sendMessage(
    {
      customType: "pi-plan-review",
      content: "Prüfe jetzt den aktuellen PlanSnapshot.",
      display: true,
    },
    { triggerTurn: true },
  );
}

export async function finalizePlanning(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const kind = session.planningKind;
  if (!kind) return;
  session.planningKind = undefined;
  const observed = planContent(ctx.cwd);
  if (!observed) {
    session.notify(ctx, `${PLAN_RELATIVE_PATH} wurde nicht erstellt.`, "warning");
    return;
  }
  try {
    const finalized = finalizePlanningTurn(
      observed,
      kind,
      session.planningBaseContent,
    );
    const saved = finalizeObservedPlanCAS(
      ctx.cwd,
      observed,
      finalized.snapshot,
      session.current.stateToken,
      session.current.state,
    );
    session.current = {
      planContent: finalized.content,
      snapshot: finalized.snapshot,
      state: saved.state,
      stateToken: saved.stateToken,
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    updateWorkflowPresentation(ctx, saved.state, undefined, session.pi);
    session.publishWorkflowActivation(ctx);
    session.notify(
      ctx,
      session.planningIsReview
        ? "Plan-Review abgeschlossen; die aktuelle Revision benötigt vor Arbeit erneut /work."
        : `PlanSnapshot v3 gespeichert. Starte die Umsetzung ausdrücklich mit /work.`,
    );
  } catch (error) {
    session.notify(
      ctx,
      `Plan ist noch nicht vertragskonform:\n${workflowWarning(error)}`,
      "error",
    );
  } finally {
    session.planningBaseContent = undefined;
    session.planningIsReview = false;
  }
}
