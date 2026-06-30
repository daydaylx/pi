import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

interface GitHubReference {
  number: number;
  title: string;
  state?: string;
}

const STATIC_ITEMS: AutocompleteItem[] = [
  {
    value: "$plan",
    label: "$plan",
    description: "Plan erstellen oder Plan Mode öffnen (/plan)",
  },
  {
    value: "$review",
    label: "$review",
    description: "Aktuellen Plan prüfen (/review-plan)",
  },
  {
    value: "$model",
    label: "$model",
    description: "Modell wechseln (/model)",
  },
  {
    value: "%risks",
    label: "%risks",
    description: "Planbereich: Risiken und Schwachstellen",
  },
  {
    value: "%todos",
    label: "%todos",
    description: "Planbereich: Umsetzungsschritte / Todos",
  },
];

const REFERENCE_TEMPLATES: AutocompleteItem[] = [
  {
    value: "#issue-",
    label: "#issue-<nummer>",
    description: "GitHub-Issue referenzieren",
  },
  {
    value: "#pr-",
    label: "#pr-<nummer>",
    description: "GitHub-Pull-Request referenzieren",
  },
];

export function extractWorkflowToken(
  textBeforeCursor: string,
): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])([#$%][^\s#$%]*)$/);
  return match?.[1];
}

export function parseGitHubReferences(
  output: string,
  kind: "issue" | "pr",
): AutocompleteItem[] {
  let parsed: GitHubReference[];
  try {
    parsed = JSON.parse(output) as GitHubReference[];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (entry) =>
        Number.isSafeInteger(entry?.number) &&
        entry.number > 0 &&
        typeof entry.title === "string",
    )
    .map((entry) => ({
      value: `#${kind}-${entry.number}`,
      label: `#${kind}-${entry.number}`,
      description: entry.state
        ? `[${entry.state.toLowerCase()}] ${entry.title}`
        : entry.title,
    }));
}

function matchingItems(
  token: string,
  remoteItems: readonly AutocompleteItem[],
): AutocompleteItem[] {
  const normalized = token.toLocaleLowerCase();
  const candidates = token.startsWith("#")
    ? [...remoteItems, ...REFERENCE_TEMPLATES]
    : STATIC_ITEMS;

  return candidates
    .filter((item) => {
      const value = item.value.toLocaleLowerCase();
      const label = item.label.toLocaleLowerCase();
      return value.startsWith(normalized) || label.startsWith(normalized);
    })
    .slice(0, 20);
}

export function createWorkflowAutocompleteProvider(
  current: AutocompleteProvider,
  getReferences: () => Promise<AutocompleteItem[]>,
): AutocompleteProvider {
  return {
    triggerCharacters: ["#", "$", "%"],

    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const token = extractWorkflowToken(currentLine.slice(0, cursorCol));
      if (!token) {
        return current.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
      }

      const remoteItems = token.startsWith("#")
        ? await getReferences()
        : [];
      if (options.signal.aborted) return null;

      const items = matchingItems(token, remoteItems);
      if (items.length === 0) {
        return current.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
      }
      return { prefix: token, items };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        prefix,
      );
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return (
        current.shouldTriggerFileCompletion?.(
          lines,
          cursorLine,
          cursorCol,
        ) ?? true
      );
    },
  };
}

async function loadGitHubReferences(
  pi: ExtensionAPI,
  cwd: string,
): Promise<AutocompleteItem[]> {
  try {
    const [issues, pullRequests] = await Promise.all([
      pi.exec(
        "gh",
        [
          "issue",
          "list",
          "--state",
          "open",
          "--limit",
          "100",
          "--json",
          "number,title,state",
        ],
        { cwd, timeout: 5_000 },
      ),
      pi.exec(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "100",
          "--json",
          "number,title,state",
        ],
        { cwd, timeout: 5_000 },
      ),
    ]);

    return [
      ...(issues.code === 0
        ? parseGitHubReferences(issues.stdout, "issue")
        : []),
      ...(pullRequests.code === 0
        ? parseGitHubReferences(pullRequests.stdout, "pr")
        : []),
    ];
  } catch {
    return [];
  }
}

export default function workflowAutocomplete(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    let referencesPromise: Promise<AutocompleteItem[]> | undefined;
    const getReferences = (): Promise<AutocompleteItem[]> => {
      referencesPromise ??= loadGitHubReferences(pi, ctx.cwd);
      return referencesPromise;
    };

    ctx.ui.addAutocompleteProvider((current) =>
      createWorkflowAutocompleteProvider(current, getReferences),
    );
  });
}
