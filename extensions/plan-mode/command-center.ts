import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  COMMAND_CATEGORIES,
  COMMAND_DEFINITIONS,
  normalizeAvailableCommands,
  type AvailableCommand,
  type CommandCategoryId,
  type CommandDefinition,
  type CommandEffect,
} from "../shared/command-catalog.ts";
import { resolveLspInteractiveCommand } from "../lsp/control-center.ts";
import { submitCanonicalCommand } from "../shared/command-runtime.ts";
import {
  choose,
  cleanInput,
  runMenu,
  type MenuEntry,
} from "../shared/menu-ui.ts";

export interface CommandCenterState {
  activeMode: "work" | "simple_plan" | "detailed_plan";
}

export interface CommandMenuAction {
  name: string;
  commandLine: string;
  effect: CommandEffect;
  guide?: CommandDefinition["guide"];
}

function disabledReason(
  name: string,
  state: CommandCenterState,
): string | undefined {
  if (name === "edit-plan" && state.activeMode === "work")
    return "Wechsle zuerst in einen Planmodus.";
  return undefined;
}

function commandEntry(
  definition: CommandDefinition,
  state: CommandCenterState,
): MenuEntry<CommandMenuAction> {
  const reason = disabledReason(definition.name, state);
  const aliases = definition.aliases?.length
    ? `Aliase: ${definition.aliases.map((alias) => `/${alias}`).join(", ")}.`
    : undefined;
  const shortcut = definition.shortcut
    ? `Shortcut: ${definition.shortcut}.`
    : undefined;
  // "run-agent" has no standalone slash command of its own — /run <agent>
  // is what guideCommand() actually submits, so the label reflects that
  // instead of implying a non-existent /<agent-name> command.
  const commandLine =
    definition.guide === "run-agent"
      ? `/run ${definition.name}`
      : `/${definition.name}`;
  return {
    id: `command-${definition.name}`,
    label: `${definition.label} · ${commandLine}`,
    description: [definition.description, shortcut].filter(Boolean).join(" "),
    details: aliases,
    disabled: Boolean(reason),
    disabledReason: reason,
    dangerous: definition.dangerous,
    tone: definition.dangerous ? "danger" : undefined,
    value: {
      name: definition.name,
      commandLine,
      effect: definition.effect ?? "preserve-draft",
      guide: definition.guide,
    },
  };
}

function dynamicEntry(command: AvailableCommand): MenuEntry<CommandMenuAction> {
  const startsTurn = command.source === "prompt" || command.source === "skill";
  return {
    id: `dynamic-command-${command.source}-${command.name}`,
    label: `${command.name} · /${command.name}`,
    description:
      command.description ??
      "Dynamisch registrierter Command ohne zusätzliche Beschreibung.",
    badge:
      command.source === "prompt"
        ? "PROMPT"
        : command.source === "skill"
          ? "SKILL"
          : "ERWEITERUNG",
    value: {
      name: command.name,
      commandLine: `/${command.name}`,
      effect: startsTurn ? "starts-turn" : "preserve-draft",
    },
  };
}

export function buildCommandCenterEntries(
  available: readonly AvailableCommand[],
  state: CommandCenterState,
): MenuEntry<CommandMenuAction>[] {
  const knownNames = new Set(
    COMMAND_DEFINITIONS.flatMap((definition) => [
      definition.name,
      ...(definition.aliases ?? []),
    ]),
  );
  const knownByCategory = new Map<
    CommandCategoryId,
    MenuEntry<CommandMenuAction>[]
  >();
  for (const category of COMMAND_CATEGORIES)
    knownByCategory.set(category.id, []);

  for (const definition of COMMAND_DEFINITIONS) {
    // "commands" ist der Einstiegspunkt selbst. Die übrigen drei ändern den
    // Workflow-Zustand: "workflow-set" ist ein programmatischer Direktsetzer
    // für Frontends/RPC, "plan-decide" und "plan-approve" entscheiden über
    // einen fertigen Plan und "plan-approve" startet dabei einen Work-Turn.
    // Sie werden bewusst nicht als alternative Workflow-Route im Command
    // Center angeboten — der Workflow-Wechsel und die Planentscheidung laufen
    // über das Shift+Tab-Menü (bzw. für Frontends über die dokumentierten
    // Slash-Commands). Reine Plan-Werkzeuge ohne Zustandswechsel
    // (`view-plan`, `edit-plan`, `save-plan`) bleiben hier verfügbar.
    if (
      definition.name === "commands" ||
      definition.name === "workflow-set" ||
      definition.name === "plan-decide" ||
      definition.name === "plan-approve"
    )
      continue;
    knownByCategory
      .get(definition.category)
      ?.push(commandEntry(definition, state));
  }

  const prompts = available
    .filter((command) => command.source === "prompt")
    .map(dynamicEntry);
  const skills = available
    .filter((command) => command.source === "skill")
    .map(dynamicEntry);
  const unknown = available
    .filter(
      (command) =>
        command.source !== "prompt" &&
        command.source !== "skill" &&
        !knownNames.has(command.name),
    )
    .map(dynamicEntry);

  const resources = knownByCategory.get("resources") ?? [];
  if (prompts.length > 0) {
    resources.push({
      id: "resource-prompts",
      label: "Prompt-Vorlagen",
      description: "Geladene Prompt-Commands",
      children: prompts,
    });
  }
  if (skills.length > 0) {
    resources.push({
      id: "resource-skills",
      label: "Skills",
      description: "Aktivierte native Skill-Commands",
      children: skills,
    });
  }
  if (resources.length === 0) {
    resources.push({
      id: "resource-empty",
      label: "Keine Vorlagen oder Skills geladen",
      disabled: true,
      disabledReason: "Die aktuelle Runtime meldet keine aktiven Ressourcen.",
    });
  }
  if (unknown.length > 0) {
    knownByCategory.get("system")?.push({
      id: "system-other-commands",
      label: "Weitere Commands",
      description: "Dynamisch registrierte, noch nicht katalogisierte Commands",
      children: unknown,
    });
  }

  return COMMAND_CATEGORIES.map((category) => ({
    id: `command-category-${category.id}`,
    label: category.label,
    shortcut: category.shortcut,
    description: `Mit ${category.shortcut} direkt öffnen`,
    children: knownByCategory.get(category.id) ?? [],
  }));
}

function quotePathArgument(value: string): string | undefined {
  if (!/\s/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return undefined;
}

async function guideCommand(
  ctx: ExtensionContext,
  action: CommandMenuAction,
): Promise<string | undefined> {
  switch (action.guide) {
    case undefined:
      return action.commandLine;
    case "route": {
      const level = await choose(ctx, "Aufgaben-Routing · /route", [
        { label: "Aktuelle Entscheidung anzeigen · /route", value: "" },
        { label: "LOW erzwingen · /route low", value: "low" },
        { label: "STANDARD erzwingen · /route standard", value: "standard" },
        { label: "HIGH erzwingen · /route high", value: "high" },
      ]);
      return level === undefined
        ? undefined
        : `/route${level ? ` ${level}` : ""}`;
    }
    case "lsp": {
      const resolved = await resolveLspInteractiveCommand(ctx);
      return resolved ? `/lsp ${resolved}` : undefined;
    }
    case "run-agent": {
      const task = cleanInput(
        await ctx.ui.input(
          `${action.name} · Aufgabe`,
          "Konkrete, klar abgegrenzte Aufgabe für diesen Subagenten",
        ),
      );
      return task ? `/run ${action.name} ${task}` : undefined;
    }
    case "name": {
      const name = cleanInput(
        await ctx.ui.input("Sitzung benennen · /name", "Neuer Sitzungsname"),
      );
      return name ? `/name ${name}` : undefined;
    }
    case "import": {
      const path = cleanInput(
        await ctx.ui.input(
          "Sitzung importieren · /import",
          "Pfad zur JSONL-Datei",
        ),
      );
      if (!path) return undefined;
      const quoted = quotePathArgument(path);
      if (!quoted) {
        ctx.ui.notify(
          "Der Pfad enthält nicht sicher darstellbare Anführungszeichen.",
          "error",
        );
        return undefined;
      }
      return `/import ${quoted}`;
    }
    case "export": {
      const mode = await choose(ctx, "Sitzung exportieren · /export", [
        { label: "HTML mit Standardpfad · /export", value: "default" },
        { label: "Zielpfad angeben", value: "path" },
      ]);
      if (!mode) return undefined;
      if (mode === "default") return "/export";
      const path = cleanInput(
        await ctx.ui.input("Export-Ziel", "Pfad mit .html oder .jsonl"),
      );
      if (!path) return undefined;
      const quoted = quotePathArgument(path);
      if (!quoted) {
        ctx.ui.notify(
          "Der Pfad enthält nicht sicher darstellbare Anführungszeichen.",
          "error",
        );
        return undefined;
      }
      return `/export ${quoted}`;
    }
    case "compact": {
      const mode = await choose(ctx, "Kontext kompaktieren · /compact", [
        { label: "Standard-Kompaktierung · /compact", value: "default" },
        { label: "Eigene Anweisung ergänzen", value: "custom" },
      ]);
      if (!mode) return undefined;
      if (mode === "default") return "/compact";
      const instructions = cleanInput(
        await ctx.ui.input(
          "Kompaktierungsanweisung",
          "Was muss im Kontext erhalten bleiben?",
        ),
      );
      return instructions ? `/compact ${instructions}` : undefined;
    }
  }
}

export async function openCommandCenter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: CommandCenterState,
): Promise<void> {
  const available =
    typeof pi.getCommands === "function"
      ? normalizeAvailableCommands(pi.getCommands())
      : [];
  const selected = await runMenu(
    ctx,
    "Command Center",
    buildCommandCenterEntries(available, state),
    {
      nonInteractiveHint: "Das Command Center benötigt den TUI-Modus.",
      headerShortcut: "Super+Q",
      appearance: "command-center",
    },
  );
  if (!selected) return;
  const commandLine = await guideCommand(ctx, selected);
  if (!commandLine) return;
  await submitCanonicalCommand(ctx, commandLine, selected.effect);
}
