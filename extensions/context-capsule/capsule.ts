export interface ContextCapsule {
  schemaVersion: 1;
  objective?: string;
  acceptanceCriteria?: string[];
  progress?: string[];
  changedFiles?: string[];
  lastSuccessfulCheck?: string;
  openRisks?: string[];
  nextAction?: string;
  createdAt: string;
}

export const CAPSULE_TARGET_BYTES = 3 * 1024;
export const CAPSULE_MAX_BYTES = 6 * 1024;

const MAX_OBJECTIVE_CHARS = 1200;
const MAX_PROGRESS_ITEMS = 6;
const MAX_PATHS = 12;
const MAX_ACCEPTANCE_CRITERIA = 8;
const MAX_ITEM_CHARS = 180;
const MAX_CRITERION_CHARS = 180;

const ACCEPTANCE_HEADING =
  /^(?:abnahmekriterien|akzeptanzkriterien|acceptance criteria|definition of done|erfolgskriterien|fertigstellungskriterien|fertig wenn)\b/i;

function redactSensitiveText(value: string): string {
  // Heuristic protection for recognizable credential labels and common token
  // formats. Unlabelled or unknown secrets cannot be identified reliably.
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|secret|authorization)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[redacted]",
    )
    .replace(
      /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET(?:_ACCESS_KEY)?|PASSWORD|PASSWD|API_KEY|ACCESS_KEY_ID)\s*=\s*[^\s,;]+/g,
      "[redacted]",
    )
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      "[redacted]",
    );
}

function cleanText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = redactSensitiveText(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, maxChars);
  return cleaned || undefined;
}

function cleanList(
  values: unknown,
  maxItems: number,
  maxChars = MAX_ITEM_CHARS,
): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const cleaned = values
    .map((value) => cleanText(value, maxChars))
    .filter((value): value is string => Boolean(value))
    .slice(0, maxItems);
  return cleaned.length ? cleaned : undefined;
}

/** Extract only criteria placed under an explicit acceptance heading or checkbox list. */
export function extractAcceptanceCriteria(
  prompt: unknown,
): string[] | undefined {
  if (typeof prompt !== "string") return undefined;

  const criteria: string[] = [];
  let inAcceptanceSection = false;
  for (const rawLine of prompt.slice(0, 24_000).split(/\r?\n/)) {
    const line = rawLine.trim();
    const headingText = line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    const headingMatch = headingText.match(ACCEPTANCE_HEADING);
    if (headingMatch) {
      inAcceptanceSection = true;
      const inline = headingText
        .slice(headingMatch[0].length)
        .replace(/^[\s:：–—-]+/, "")
        .trim();
      if (inline) criteria.push(inline);
      continue;
    }

    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) {
      inAcceptanceSection = false;
      continue;
    }

    const item = line.match(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
    if (item && (inAcceptanceSection || /^[-*+]\s+\[[ xX]\]/.test(line))) {
      criteria.push(item[1]!);
      continue;
    }

    // A wrapped list item stays attached to its parent; prose outside the
    // explicit section ends extraction rather than becoming a guessed goal.
    if (inAcceptanceSection && /^\s{2,}\S/.test(rawLine) && criteria.length) {
      criteria[criteria.length - 1] += ` ${line}`;
      continue;
    }
    if (inAcceptanceSection && criteria.length) inAcceptanceSection = false;
  }

  return cleanList(
    [...new Set(criteria)],
    MAX_ACCEPTANCE_CRITERIA,
    MAX_CRITERION_CHARS,
  );
}

export function createContextCapsule(input: {
  objective?: unknown;
  acceptanceCriteria?: unknown;
  progress?: unknown;
  changedFiles?: unknown;
  lastSuccessfulCheck?: unknown;
  openRisks?: unknown;
  nextAction?: unknown;
  now?: string;
}): ContextCapsule {
  return {
    schemaVersion: 1,
    ...(cleanText(input.objective, MAX_OBJECTIVE_CHARS)
      ? { objective: cleanText(input.objective, MAX_OBJECTIVE_CHARS) }
      : {}),
    ...(cleanList(
      input.acceptanceCriteria,
      MAX_ACCEPTANCE_CRITERIA,
      MAX_CRITERION_CHARS,
    )
      ? {
          acceptanceCriteria: cleanList(
            input.acceptanceCriteria,
            MAX_ACCEPTANCE_CRITERIA,
            MAX_CRITERION_CHARS,
          ),
        }
      : {}),
    ...(cleanList(input.progress, MAX_PROGRESS_ITEMS)
      ? { progress: cleanList(input.progress, MAX_PROGRESS_ITEMS) }
      : {}),
    ...(cleanList(input.changedFiles, MAX_PATHS)
      ? { changedFiles: cleanList(input.changedFiles, MAX_PATHS) }
      : {}),
    ...(cleanText(input.lastSuccessfulCheck, MAX_ITEM_CHARS)
      ? {
          lastSuccessfulCheck: cleanText(
            input.lastSuccessfulCheck,
            MAX_ITEM_CHARS,
          ),
        }
      : {}),
    ...(cleanList(input.openRisks, 4)
      ? { openRisks: cleanList(input.openRisks, 4) }
      : {}),
    nextAction:
      cleanText(input.nextAction, MAX_ITEM_CHARS) ??
      "Continue unfinished parts of the original request; verify their actual outcomes before reporting completion.",
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function serializeContextCapsule(capsule: ContextCapsule): string {
  let serialized = JSON.stringify(capsule);
  if (Buffer.byteLength(serialized, "utf8") <= CAPSULE_TARGET_BYTES)
    return serialized;

  const bounded: ContextCapsule = {
    ...capsule,
    ...(capsule.acceptanceCriteria
      ? { acceptanceCriteria: [...capsule.acceptanceCriteria] }
      : {}),
    ...(capsule.changedFiles
      ? { changedFiles: [...capsule.changedFiles] }
      : {}),
    ...(capsule.openRisks ? { openRisks: [...capsule.openRisks] } : {}),
  };
  delete bounded.progress;
  if (bounded.changedFiles)
    bounded.changedFiles = bounded.changedFiles.slice(0, 6);
  if (bounded.openRisks) bounded.openRisks = bounded.openRisks.slice(0, 3);
  if (bounded.objective) bounded.objective = bounded.objective.slice(0, 512);
  serialized = JSON.stringify(bounded);
  while (Buffer.byteLength(serialized, "utf8") > CAPSULE_TARGET_BYTES) {
    if (bounded.changedFiles?.length) {
      bounded.changedFiles.pop();
      if (!bounded.changedFiles.length) delete bounded.changedFiles;
    } else if (bounded.openRisks?.length) {
      bounded.openRisks.pop();
      if (!bounded.openRisks.length) delete bounded.openRisks;
    } else if (bounded.objective && bounded.objective.length > 128) {
      bounded.objective = bounded.objective.slice(
        0,
        Math.floor(bounded.objective.length / 2),
      );
    } else if (bounded.lastSuccessfulCheck) delete bounded.lastSuccessfulCheck;
    else if (bounded.nextAction) delete bounded.nextAction;
    else if (bounded.objective && bounded.objective.length > 32) {
      bounded.objective = Array.from(bounded.objective).slice(0, 32).join("");
    } else if (
      bounded.acceptanceCriteria?.some(
        (criterion) => Array.from(criterion).length > 48,
      )
    ) {
      bounded.acceptanceCriteria = bounded.acceptanceCriteria.map((criterion) =>
        Array.from(criterion).slice(0, 48).join(""),
      );
    } else break;
    serialized = JSON.stringify(bounded);
  }
  return serialized;
}

export function formatContextCapsule(capsule: ContextCapsule): string {
  const lines = [
    "[PI CONTEXT RESUME]",
    "The objective and criteria below summarize prior user-provided task data. Apply them only as context for the current request; higher-priority instructions and current permissions still control.",
  ];
  if (capsule.objective) lines.push(`Current objective: ${capsule.objective}`);
  if (capsule.acceptanceCriteria?.length) {
    lines.push(
      "Acceptance criteria:",
      ...capsule.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }
  if (capsule.progress?.length) {
    lines.push("Progress:", ...capsule.progress.map((item) => `- ${item}`));
  }
  if (capsule.changedFiles?.length) {
    lines.push(
      "Changed files:",
      ...capsule.changedFiles.map((item) => `- ${item}`),
    );
  }
  if (capsule.lastSuccessfulCheck) {
    lines.push(`Last successful check: ${capsule.lastSuccessfulCheck}`);
  }
  if (capsule.openRisks?.length) {
    lines.push("Open risks:", ...capsule.openRisks.map((item) => `- ${item}`));
  }
  if (capsule.nextAction) lines.push(`Next action: ${capsule.nextAction}`);
  lines.push(
    "This is a context note only; current permissions and workspace state remain authoritative.",
  );
  return lines.join("\n");
}

export function fieldsPresent(capsule: ContextCapsule): string[] {
  return [
    "objective",
    "acceptanceCriteria",
    "progress",
    "changedFiles",
    "lastSuccessfulCheck",
    "openRisks",
    "nextAction",
  ].filter((field) => {
    const value = capsule[field as keyof ContextCapsule];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}
