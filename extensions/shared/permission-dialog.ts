import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createInfoBoxComponent } from "./info-box.ts";
import { glyphsFor, resolveRenderProfile } from "./render-profile.ts";
import { projectLabel } from "./visual-system.ts";
import type { PolicyDecision } from "./permission-policy.ts";
import {
  decisionRisk,
  riskLabel,
  riskTone,
  type RiskLevel,
} from "./visual-system.ts";

// `@earendil-works/pi-tui` wird bewusst dynamisch innerhalb von
// confirmWithCustomUi() importiert, abgesichert durch eine
// ctx.ui.custom-Fähigkeitsprüfung – siehe die identische Begründung in
// menu-ui.ts: ein statischer Value-Import würde diese Datei (und alles was
// sie importiert, z. B. mode-permissions.ts) für die tests/run.mjs jiti-Harness
// unladbar machen.

const MAX_PREVIEW = 140;
const MAX_REASON_LINES = 3;

/** Ein-Zeilen-Kürzung für die Fallback-Nachricht; exportiert für Wiederverwendung. */
export function preview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_PREVIEW
    ? oneLine
    : `${oneLine.slice(0, MAX_PREVIEW - 1)}…`;
}

function riskToInfoBoxTone(risk: RiskLevel): "error" | "warning" | "neutral" {
  const tone = riskTone(risk);
  if (tone === "danger") return "error";
  if (tone === "warning") return "warning";
  return "neutral";
}

async function confirmWithCustomUi(
  ctx: ExtensionContext,
  decision: PolicyDecision,
  subject: string,
  toolName: string | undefined,
): Promise<boolean> {
  if (typeof ctx.ui.custom !== "function") {
    throw new Error("Custom UI overlay not supported in this context.");
  }
  const { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } =
    await import("@earendil-works/pi-tui");

  const risk = decisionRisk(decision);
  const boxTone = riskToInfoBoxTone(risk);
  const background = boxTone === "error" ? "toolErrorBg" : "toolPendingBg";

  return ctx.ui.custom<boolean>(
    (tui, theme, _keybindings, done) => {
      const profile = resolveRenderProfile({ mode: ctx.mode });
      const glyphs = glyphsFor(profile);
      const box = createInfoBoxComponent(
        {
          title: "Permission Request",
          status: {
            symbol: glyphs.status.warning,
            label: `${riskLabel(risk)} (${risk})`,
          },
          tone: boxTone,
          background,
          profile,
          tuiHelpers: { visibleWidth, truncateToWidth, wrapTextWithAnsi, matchesKey, Key },
        },
        theme,
      );

      return {
        render(width: number): string[] {
          const innerWidth = Math.max(1, width - 4);
          const subjectLabel = toolName === "bash" || !toolName
            ? "Command"
            : "Ziel";
          const subjectWrapped = wrapTextWithAnsi(subject, innerWidth)
            .slice(0, 4);
          const reasonWrapped = wrapTextWithAnsi(decision.reason, innerWidth)
            .slice(0, MAX_REASON_LINES);

          const sections = [
            {
              title: "Details",
              lines: [
                `Tool: ${toolName ?? "bash"}`,
                `Context: ${projectLabel(ctx.cwd)}`,
                `Risk: ${riskLabel(risk)} (${risk})`,
              ],
            },
            {
              title: subjectLabel,
              lines: subjectWrapped.length > 0
                ? subjectWrapped
                : ["(leer)"],
            },
            {
              title: "Reason",
              lines: reasonWrapped.length > 0
                ? reasonWrapped
                : ["(keine Begründung)"],
            },
            {
              title: "Aktion",
              lines: ["[a] ALLOW ONCE   [d] DENY"],
            },
          ];

          box.setSections!(sections);
          return box.render(width);
        },
        invalidate() {
          box.invalidate();
        },
        handleInput(data: string): void {
          if (data === "a" || data === "A" || matchesKey(data, Key.enter)) {
            done(true);
          } else if (
            data === "d" ||
            data === "D" ||
            matchesKey(data, Key.escape) ||
            matchesKey(data, Key.ctrl("c"))
          ) {
            done(false);
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "90%",
        maxHeight: "70%",
        margin: 2,
      },
    },
  );
}

/**
 * Zeigt eine strukturierte Permission-Bestätigung (Tool/Command/Risk/Reason
 * in einer risikofarbig umrandeten Box) wenn ctx.ui.custom verfügbar ist,
 * und fällt sonst auf das bestehende ctx.ui.confirm(title, message) zurück –
 * exakt im heutigen Format, damit keine bestehende Fake-ctx.ui-Testumgebung
 * (die kein `custom` implementiert) ihr Verhalten ändert.
 */
export async function confirmAction(
  ctx: ExtensionContext,
  decision: PolicyDecision,
  subject: string,
  toolName?: string,
): Promise<boolean> {
  if (typeof ctx.ui.custom === "function") {
    try {
      return await confirmWithCustomUi(ctx, decision, subject, toolName);
    } catch {
      // Fällt durch auf den Plain-Fallback unten (z. B. nicht-interaktive
      // Kontexte oder minimale Test-Mocks, deren ctx.ui.custom wirft).
    }
  }
  const title = decision.hard
    ? "HARTE WARNUNG — Aktion bestätigen?"
    : "Riskante Aktion bestätigen?";
  return ctx.ui.confirm(title, `${decision.reason}\n\n${preview(subject)}`);
}
