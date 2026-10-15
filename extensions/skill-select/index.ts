/**
 * Skill-Auswahl (Shift+Tab, `/skill`).
 *
 * Eine reine Bedienoberfläche für die nativen Pi-Skills: Die Liste kommt aus
 * `pi.getCommands()` (die Skills, die die Runtime für diese Sitzung samt
 * Projektvertrauen tatsächlich geladen hat), geladen wird ein Skill von der
 * Runtime selbst. Die Auswahl merkt genau einen Namen für die nächste
 * Nutzernachricht vor und stellt ihr beim Absenden `/skill:<name> ` voran; die
 * native Expansion liest dann die SKILL.md. Hier gibt es deshalb weder eine
 * Skill-Registry noch eine eigene Ladepipeline, kein Pinning und keinen
 * Modellaufruf durch die Auswahl.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { runMenu, type MenuEntry } from "../shared/menu-ui.ts";

const STATUS_KEY = "skill";
const SKILL_COMMAND_PREFIX = "skill:";
const CLEAR_ARGUMENT = "--clear";

type Origin = "Projekt" | "Projekt-Paket" | "Global" | "Paket" | "Temporär";
const ORIGIN_ORDER: readonly Origin[] = [
  "Projekt",
  "Projekt-Paket",
  "Global",
  "Paket",
  "Temporär",
];

interface SkillChoice {
  name: string;
  description: string;
  origin: Origin;
}

function originOf(info: SlashCommandInfo["sourceInfo"]): Origin {
  if (info.scope === "temporary") return "Temporär";
  if (info.origin === "package")
    return info.scope === "project" ? "Projekt-Paket" : "Paket";
  return info.scope === "project" ? "Projekt" : "Global";
}

function loadedSkills(pi: ExtensionAPI): SkillChoice[] {
  return pi
    .getCommands()
    .filter(
      (command) =>
        command.source === "skill" &&
        command.name.startsWith(SKILL_COMMAND_PREFIX),
    )
    .map((command) => ({
      name: command.name.slice(SKILL_COMMAND_PREFIX.length),
      description: command.description ?? "",
      origin: originOf(command.sourceInfo),
    }))
    .sort(
      (a, b) =>
        ORIGIN_ORDER.indexOf(a.origin) - ORIGIN_ORDER.indexOf(b.origin) ||
        a.name.localeCompare(b.name),
    );
}

export default function skillSelectExtension(pi: ExtensionAPI): void {
  /** Name des für die nächste Nachricht vorgemerkten Skills. */
  let pending: string | undefined;

  const show = (ctx: Pick<ExtensionContext, "hasUI" | "ui">): void => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, pending ? `Skill: ${pending}` : undefined);
  };
  const setPending = (
    ctx: Pick<ExtensionContext, "hasUI" | "ui">,
    name: string | undefined,
  ): void => {
    pending = name;
    show(ctx);
  };

  pi.registerCommand("skill", {
    description: catalogDescription("skill"),
    handler: async (args, ctx) => {
      const skills = loadedSkills(pi);
      const requested = args.trim();

      if (requested === CLEAR_ARGUMENT) {
        setPending(ctx, undefined);
        if (ctx.hasUI) ctx.ui.notify("Skill-Vormerkung entfernt.", "info");
        return;
      }
      if (requested) {
        const match = skills.find((skill) => skill.name === requested);
        if (!match) {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Skill „${requested}“ ist in dieser Sitzung nicht verfügbar.`,
              "error",
            );
          return;
        }
        setPending(ctx, match.name);
        if (ctx.hasUI)
          ctx.ui.notify(
            `Skill „${match.name}“ gilt für die nächste Nachricht.`,
            "info",
          );
        return;
      }

      if (skills.length === 0) {
        if (ctx.hasUI)
          ctx.ui.notify("Keine Skills in dieser Sitzung verfügbar.", "info");
        return;
      }
      const entries: MenuEntry<string>[] = skills.map((skill) => {
        const isPending = skill.name === pending;
        return {
          id: `skill-${skill.name}`,
          label: skill.name,
          description: isPending
            ? `${skill.description} — Enter entfernt die Vormerkung.`
            : skill.description,
          section: skill.origin,
          current: isPending,
          badge: isPending ? "● VORGEMERKT" : undefined,
          value: skill.name,
        };
      });
      const chosen = await runMenu(
        ctx,
        "Skill für nächste Nachricht",
        entries,
        {
          headerShortcut: "Shift+Tab",
          typeToSearch: true,
        },
      );
      if (chosen === undefined) return;
      // Erneute Wahl des vorgemerkten Skills nimmt die Vormerkung zurück.
      setPending(ctx, chosen === pending ? undefined : chosen);
    },
  });

  pi.on("input", (event, ctx) => {
    if (!pending || event.source === "extension")
      return { action: "continue" as const };
    const text = event.text;
    // Commands, Prompt-Templates und ausdrückliche /skill:-Aufrufe bleiben
    // unberührt und lassen die Vormerkung stehen.
    if (!text.trim() || text.trimStart().startsWith("/"))
      return { action: "continue" as const };

    const name = pending;
    setPending(ctx, undefined);
    if (!loadedSkills(pi).some((skill) => skill.name === name)) {
      if (ctx.hasUI)
        ctx.ui.notify(
          `Vorgemerkter Skill „${name}“ ist nicht mehr verfügbar und wurde nicht geladen.`,
          "warning",
        );
      return { action: "continue" as const };
    }
    return {
      action: "transform" as const,
      text: `/${SKILL_COMMAND_PREFIX}${name} ${text}`,
    };
  });

  // Neue Sitzung, Wechsel, Fork und /reload beginnen ohne Vormerkung.
  pi.on("session_start", (_event, ctx) => {
    setPending(ctx, undefined);
  });
}
