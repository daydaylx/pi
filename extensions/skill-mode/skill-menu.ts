/**
 * Menu-Builders für den Skill-Launcher.
 *
 * Bietet Builder für:
 * 1. Skill-Auswahlmenü (Liste aller Skills)
 * 2. Ausführungsmodus-Menü (info / analysis / plan / work)
 * 3. Bestätigungsmenü für Schreibzugriffe
 */

import type { MenuEntry } from "../shared/menu-ui.ts";
import {
  SKILL_CATALOG,
  EXECUTION_MODE_LABEL,
  EXECUTION_MODE_DESCRIPTION,
  type SkillDefinition,
  type SkillExecutionMode,
} from "./skill-catalog.ts";

/** Welche Skills im Hauptmenü erscheinen sollen. */
export function buildSkillSelectionMenu(): MenuEntry<string>[] {
  const byCategory: Record<string, SkillDefinition[]> = {};
  for (const skill of SKILL_CATALOG) {
    const cat = skill.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(skill);
  }

  const categoryOrder: SkillDefinition["category"][] = [
    "analysis",
    "planning",
    "review",
    "docs",
    "work",
  ];

  const categoryLabels: Record<SkillDefinition["category"], string> = {
    analysis: "Analyse",
    planning: "Planung",
    review: "Review & Audit",
    docs: "Dokumentation",
    work: "Umsetzung",
  };

  const entries: MenuEntry<string>[] = [];

  for (const cat of categoryOrder) {
    const skills = byCategory[cat];
    if (!skills || skills.length === 0) continue;

    for (const skill of skills) {
      const modeHint = skill.readOnlyByDefault ? "read-only" : "write requires confirmation";
      entries.push({
        id: `skill-${skill.id}`,
        label: skill.title,
        description: `${skill.description} [${modeHint}]`,
        section: categoryLabels[cat],
        value: skill.id,
      });
    }
  }

  return entries;
}

/** Ausführungsmodus-Menü für einen ausgewählten Skill. */
export function buildExecutionModeMenu(
  skill: SkillDefinition,
): MenuEntry<SkillExecutionMode>[] {
  const modes: SkillExecutionMode[] = ["info", "analysis", "plan", "work"];

  return modes.map((mode) => {
    const isDefault = mode === skill.defaultMode;
    const isWork = mode === "work";
    return {
      id: `exec-mode-${mode}`,
      label: EXECUTION_MODE_LABEL[mode],
      description: EXECUTION_MODE_DESCRIPTION[mode] +
        (isDefault ? " (Standard)" : "") +
        (isWork ? " ⚠️ Freigabe erforderlich" : ""),
      current: isDefault,
      value: mode,
    };
  });
}

/** Bestätigungsmenü für den Work-Modus (Schreibzugriffe). */
export function buildWorkConfirmationMenu(
  skill: SkillDefinition,
): MenuEntry<"confirm" | "cancel">[] {
  return [
    {
      id: "skill-work-confirm",
      label: `Ausführen: ${skill.title}`,
      description:
        "Der Agent erhält Schreibzugriff und führt die Aufgabe aus. Änderungen können jederzeit kontrolliert werden.",
      value: "confirm",
    },
    {
      id: "skill-work-cancel",
      label: "Abbrechen",
      description: "Zurück zur Ausführungsmodus-Auswahl.",
      value: "cancel",
    },
  ];
}
