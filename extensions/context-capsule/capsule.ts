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
const MAX_ITEM_CHARS = 180;

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

function cleanList(values: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const cleaned = values
    .map((value) => cleanText(value, MAX_ITEM_CHARS))
    .filter((value): value is string => Boolean(value))
    .slice(0, maxItems);
  return cleaned.length ? cleaned : undefined;
}

export function createContextCapsule(input: {
  objective?: unknown;
  progress?: unknown;
  changedFiles?: unknown;
  lastSuccessfulCheck?: unknown;
  now?: string;
}): ContextCapsule {
  return {
    schemaVersion: 1,
    ...(cleanText(input.objective, MAX_OBJECTIVE_CHARS)
      ? { objective: cleanText(input.objective, MAX_OBJECTIVE_CHARS) }
      : {}),
    ...(cleanList(input.progress, MAX_PROGRESS_ITEMS)
      ? { progress: cleanList(input.progress, MAX_PROGRESS_ITEMS) }
      : {}),
    ...(cleanList(input.changedFiles, MAX_PATHS)
      ? { changedFiles: cleanList(input.changedFiles, MAX_PATHS) }
      : {}),
    ...(cleanText(input.lastSuccessfulCheck, MAX_ITEM_CHARS)
      ? { lastSuccessfulCheck: cleanText(input.lastSuccessfulCheck, MAX_ITEM_CHARS) }
      : {}),
    nextAction: "Den aktuellen Auftrag nach der Kompaktierung fortsetzen.",
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function serializeContextCapsule(capsule: ContextCapsule): string {
  let serialized = JSON.stringify(capsule);
  if (Buffer.byteLength(serialized, "utf8") <= CAPSULE_TARGET_BYTES) return serialized;

  const bounded: ContextCapsule = { ...capsule };
  delete bounded.progress;
  delete bounded.acceptanceCriteria;
  delete bounded.openRisks;
  if (bounded.changedFiles) bounded.changedFiles = bounded.changedFiles.slice(0, 6);
  if (bounded.objective) bounded.objective = bounded.objective.slice(0, 512);
  serialized = JSON.stringify(bounded);
  while (Buffer.byteLength(serialized, "utf8") > CAPSULE_TARGET_BYTES) {
    if (bounded.changedFiles?.length) bounded.changedFiles.pop();
    else if (bounded.lastSuccessfulCheck) delete bounded.lastSuccessfulCheck;
    else if (bounded.objective && bounded.objective.length > 128) {
      bounded.objective = bounded.objective.slice(0, Math.floor(bounded.objective.length / 2));
    } else {
      delete bounded.nextAction;
      break;
    }
    serialized = JSON.stringify(bounded);
  }
  return serialized;
}

export function formatContextCapsule(capsule: ContextCapsule): string {
  const lines = ["[PI CONTEXT RESUME]"];
  if (capsule.objective) lines.push(`Current objective: ${capsule.objective}`);
  if (capsule.acceptanceCriteria?.length) {
    lines.push("Acceptance criteria:", ...capsule.acceptanceCriteria.map((item) => `- ${item}`));
  }
  if (capsule.progress?.length) {
    lines.push("Progress:", ...capsule.progress.map((item) => `- ${item}`));
  }
  if (capsule.changedFiles?.length) {
    lines.push("Changed files:", ...capsule.changedFiles.map((item) => `- ${item}`));
  }
  if (capsule.lastSuccessfulCheck) {
    lines.push(`Last successful check: ${capsule.lastSuccessfulCheck}`);
  }
  if (capsule.openRisks?.length) {
    lines.push("Open risks:", ...capsule.openRisks.map((item) => `- ${item}`));
  }
  if (capsule.nextAction) lines.push(`Next action: ${capsule.nextAction}`);
  lines.push("This is a context note only; current permissions and workspace state remain authoritative.");
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
