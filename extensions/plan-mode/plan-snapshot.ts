import { createHash, randomUUID } from "node:crypto";

export const PLAN_SNAPSHOT_METADATA_VERSION = 3 as const;
export const PLAN_SNAPSHOT_METADATA_PREFIX = "PI-PLAN-METADATA:";
export const PLAN_STEP_ID_PREFIX = "PI-STEP-ID:";

export type PlanKind = "simple_plan" | "detailed_plan";

export interface PlanSnapshotMetadata {
  version: typeof PLAN_SNAPSHOT_METADATA_VERSION;
  planId: string;
  planRevision: number;
  planType: PlanKind;
}

export interface PlanStep {
  id: string;
  text: string;
}

export interface PlanSnapshot {
  planId: string;
  planRevision: number;
  planHash: string;
  planType: PlanKind;
  goal: string;
  nonGoals: string[];
  chosenSolution: string;
  assumptions: string[];
  options: string[];
  steps: PlanStep[];
  affectedAreas: string[];
  technicalScope: string[];
  changeRules: string[];
  risks: string[];
  verification: string[];
  acceptanceCriteria: string[];
  content: string;
}

export interface PlanSnapshotDiagnostic {
  field:
    | "metadata"
    | "structure"
    | "goal"
    | "nonGoals"
    | "chosenSolution"
    | "assumptions"
    | "options"
    | "steps"
    | "affectedAreas"
    | "technicalScope"
    | "changeRules"
    | "risks"
    | "verification"
    | "acceptanceCriteria";
  message: string;
}

export interface ParsedPlanSnapshot {
  snapshot?: PlanSnapshot;
  diagnostics: PlanSnapshotDiagnostic[];
}

export interface FinalizedPlanDocument {
  content: string;
  metadata: PlanSnapshotMetadata;
  snapshot: PlanSnapshot;
  changed: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SCOPE_PATTERN = /^[A-Za-z0-9._?*()[\]{}@+\-/]+$/;
const METADATA_PATTERN =
  /^[ \t]*<!--\s*PI-PLAN-METADATA:\s*(\{[^\r\n]*\})\s*-->[ \t]*$/gm;
const STEP_ID_PATTERN =
  /[ \t]*<!--\s*PI-STEP-ID:\s*([0-9a-f-]+)\s*-->[ \t]*$/i;

const REQUIRED_SECTIONS = {
  goal: ["ziel", "auftrag"],
  nonGoals: ["nicht-ziele"],
  chosenSolution: ["gewählte lösung", "gewaehlte loesung"],
  assumptions: ["annahmen"],
  steps: ["umsetzungsschritte", "todos"],
  affectedAreas: ["betroffene bereiche"],
  technicalScope: ["technischer scope"],
  changeRules: ["änderungsregeln", "aenderungsregeln"],
  risks: ["risiken", "risiken / entscheidungen"],
  verification: ["verifikation", "tests / checks"],
  acceptanceCriteria: ["abschlusskriterien"],
} as const;

const EXACT_SECTION_ORDER = [
  "Ziel",
  "Nicht-Ziele",
  "Gewählte Lösung",
  "Annahmen",
  "Umsetzungsschritte",
  "Betroffene Bereiche",
  "Technischer Scope",
  "Änderungsregeln",
  "Risiken",
  "Verifikation",
  "Abschlusskriterien",
] as const;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^\d+\.\s*/, "")
    .trim()
    .toLocaleLowerCase("de-DE");
}

function normalizeStepText(value: string): string {
  return value
    .replace(STEP_ID_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentity(value: string): string {
  return normalizeStepText(value).toLocaleLowerCase("de-DE");
}

function parseMetadata(content: string): PlanSnapshotMetadata | undefined {
  const matches = [...content.matchAll(METADATA_PATTERN)];
  if (matches.length !== 1) return undefined;
  try {
    const value = JSON.parse(matches[0]?.[1] ?? "") as Record<string, unknown>;
    if (
      value.version !== PLAN_SNAPSHOT_METADATA_VERSION ||
      typeof value.planId !== "string" ||
      !UUID_PATTERN.test(value.planId) ||
      !Number.isSafeInteger(value.planRevision) ||
      Number(value.planRevision) < 1 ||
      (value.planType !== "simple_plan" &&
        value.planType !== "detailed_plan")
    ) {
      return undefined;
    }
    return {
      version: PLAN_SNAPSHOT_METADATA_VERSION,
      planId: value.planId,
      planRevision: Number(value.planRevision),
      planType: value.planType,
    };
  } catch {
    return undefined;
  }
}

function formatMetadata(metadata: PlanSnapshotMetadata): string {
  return `<!-- ${PLAN_SNAPSHOT_METADATA_PREFIX} ${JSON.stringify(metadata)} -->`;
}

function withoutMetadata(content: string): string {
  return content.replace(METADATA_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function stampPlanSnapshotMetadata(
  content: string,
  metadata: PlanSnapshotMetadata,
): string {
  const clean = withoutMetadata(content);
  const lines = clean.split(/\r?\n/);
  const metadataLine = formatMetadata(metadata);
  if (/^#\s+/.test(lines[0] ?? "")) {
    lines.splice(1, 0, metadataLine);
  } else {
    lines.unshift(metadataLine);
  }
  return `${lines.join("\n").trim()}\n`;
}

interface HeadingSection {
  heading: string;
  start: number;
  end: number;
}

function sections(content: string): HeadingSection[] {
  const lines = content.split(/\r?\n/);
  const found = lines.flatMap((line, index) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return match
      ? [
          {
            heading: normalizeHeading(match[1] ?? ""),
            lineIndex: index,
          },
        ]
      : [];
  });
  return found.map((entry, index) => ({
    heading: entry.heading,
    start: entry.lineIndex + 1,
    end: found[index + 1]?.lineIndex ?? lines.length,
  }));
}

function exactSectionHeadings(content: string): string[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return match ? [match[1] as string] : [];
  });
}

function expectedSectionHeadings(planType: PlanKind): string[] {
  const expected: string[] = [...EXACT_SECTION_ORDER];
  if (planType === "detailed_plan") {
    expected.splice(4, 0, "Bewertete Optionen");
  }
  return expected;
}

function sectionText(
  content: string,
  headings: readonly string[],
): string | undefined {
  const lines = content.split(/\r?\n/);
  const candidates = new Set(headings.map(normalizeHeading));
  const section = sections(content).find((entry) =>
    candidates.has(entry.heading),
  );
  if (!section) return undefined;
  const value = lines.slice(section.start, section.end).join("\n").trim();
  return value || undefined;
}

function listItems(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

export function extractPlanSnapshotSteps(content: string): PlanStep[] {
  const text = sectionText(content, REQUIRED_SECTIONS.steps);
  if (!text) return [];
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(
      /^\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+?)\s*$/,
    );
    if (!match) return [];
    const raw = match[1] ?? "";
    const idMatch = raw.match(STEP_ID_PATTERN);
    const textValue = normalizeStepText(raw);
    return idMatch && UUID_PATTERN.test(idMatch[1] ?? "") && textValue
      ? [{ id: idMatch[1] as string, text: textValue }]
      : [];
  });
}

function validateScopeEntry(value: string): string | undefined {
  const unquoted = value.replace(/^`|`$/g, "").trim().replace(/\\/g, "/");
  if (!unquoted) return undefined;
  if (
    unquoted.startsWith("/") ||
    /^[A-Za-z]:\//.test(unquoted) ||
    unquoted.startsWith("!") ||
    unquoted.split("/").includes("..") ||
    !SAFE_SCOPE_PATTERN.test(unquoted)
  ) {
    return undefined;
  }
  return unquoted.replace(/^\.\//, "");
}

function addMissing(
  diagnostics: PlanSnapshotDiagnostic[],
  field: PlanSnapshotDiagnostic["field"],
  title: string,
): void {
  diagnostics.push({ field, message: `Fehlender oder leerer Abschnitt: ${title}` });
}

export function parsePlanSnapshot(content: string): ParsedPlanSnapshot {
  const diagnostics: PlanSnapshotDiagnostic[] = [];
  const metadata = parseMetadata(content);
  if (!metadata) {
    diagnostics.push({
      field: "metadata",
      message: "Plan-Metadaten v3 fehlen oder sind ungültig.",
    });
  }
  if (metadata) {
    const actual = exactSectionHeadings(content);
    const expected = expectedSectionHeadings(metadata.planType);
    if (
      actual.length !== expected.length ||
      actual.some((heading, index) => heading !== expected[index])
    ) {
      diagnostics.push({
        field: "structure",
        message:
          `H2-Abschnitte müssen exakt und in dieser Reihenfolge vorkommen: ${expected.join(" → ")}.`,
      });
    }
  }

  const goal = sectionText(content, REQUIRED_SECTIONS.goal);
  const nonGoals = listItems(
    sectionText(content, REQUIRED_SECTIONS.nonGoals),
  );
  const chosenSolution = sectionText(
    content,
    REQUIRED_SECTIONS.chosenSolution,
  );
  const assumptions = listItems(
    sectionText(content, REQUIRED_SECTIONS.assumptions),
  );
  const options = listItems(sectionText(content, ["bewertete optionen"]));
  const steps = extractPlanSnapshotSteps(content);
  const affectedAreas = listItems(
    sectionText(content, REQUIRED_SECTIONS.affectedAreas),
  );
  const rawScope = listItems(
    sectionText(content, REQUIRED_SECTIONS.technicalScope),
  );
  const technicalScope = rawScope.flatMap((entry) => {
    const safe = validateScopeEntry(entry);
    if (!safe) {
      diagnostics.push({
        field: "technicalScope",
        message: `Unsicherer oder mehrdeutiger Scope-Eintrag: ${entry}`,
      });
      return [];
    }
    return [safe];
  });
  const changeRules = listItems(
    sectionText(content, REQUIRED_SECTIONS.changeRules),
  );
  const risks = listItems(sectionText(content, REQUIRED_SECTIONS.risks));
  const verification = listItems(
    sectionText(content, REQUIRED_SECTIONS.verification),
  );
  const acceptanceCriteria = listItems(
    sectionText(content, REQUIRED_SECTIONS.acceptanceCriteria),
  );

  if (!goal) addMissing(diagnostics, "goal", "Ziel");
  if (nonGoals.length === 0) addMissing(diagnostics, "nonGoals", "Nicht-Ziele");
  if (!chosenSolution)
    addMissing(diagnostics, "chosenSolution", "Gewählte Lösung");
  if (assumptions.length === 0)
    addMissing(diagnostics, "assumptions", "Annahmen");
  if (steps.length === 0)
    addMissing(diagnostics, "steps", "Umsetzungsschritte mit stabilen IDs");
  if (affectedAreas.length === 0)
    addMissing(diagnostics, "affectedAreas", "Betroffene Bereiche");
  if (rawScope.length === 0)
    addMissing(diagnostics, "technicalScope", "Technischer Scope");
  if (changeRules.length === 0)
    addMissing(diagnostics, "changeRules", "Änderungsregeln");
  if (risks.length === 0) addMissing(diagnostics, "risks", "Risiken");
  if (verification.length === 0)
    addMissing(diagnostics, "verification", "Verifikation");
  if (acceptanceCriteria.length === 0)
    addMissing(diagnostics, "acceptanceCriteria", "Abschlusskriterien");

  if (
    metadata?.planType === "detailed_plan" &&
    (options.length < 2 || options.length > 4)
  ) {
    diagnostics.push({
      field: "options",
      message:
        "Ein Architekturplan benötigt zwei bis vier tatsächlich unterschiedliche Optionen.",
    });
  }

  const ids = steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) {
    diagnostics.push({
      field: "steps",
      message: "Schritt-IDs müssen innerhalb des Plans eindeutig sein.",
    });
  }

  if (!metadata || diagnostics.length > 0 || !goal || !chosenSolution) {
    return { diagnostics };
  }

  return {
    snapshot: {
      planId: metadata.planId,
      planRevision: metadata.planRevision,
      planHash: sha256(content),
      planType: metadata.planType,
      goal,
      nonGoals,
      chosenSolution,
      assumptions,
      options,
      steps,
      affectedAreas,
      technicalScope,
      changeRules,
      risks,
      verification,
      acceptanceCriteria,
      content,
    },
    diagnostics,
  };
}

function previousStepIds(
  previousContent: string | undefined,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!previousContent) return result;
  const parsed = parsePlanSnapshot(previousContent);
  for (const step of parsed.snapshot?.steps ?? []) {
    const key = normalizeIdentity(step.text);
    result.set(key, [...(result.get(key) ?? []), step.id]);
  }
  return result;
}

export function ensurePlanStepIds(
  content: string,
  previousContent?: string,
): string {
  const lines = withoutMetadata(content).split(/\r?\n/);
  const allSections = sections(withoutMetadata(content));
  const todoSection = allSections.find((entry) =>
    REQUIRED_SECTIONS.steps.map(normalizeHeading).includes(entry.heading),
  );
  if (!todoSection) return withoutMetadata(content);
  const reusable = previousStepIds(previousContent);
  const used = new Set<string>();

  for (let index = todoSection.start; index < todoSection.end; index += 1) {
    const match = lines[index]?.match(
      /^(\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+))(.+?)\s*$/,
    );
    if (!match) continue;
    const prefix = match[1] ?? "";
    const raw = match[2] ?? "";
    const existing = raw.match(STEP_ID_PATTERN)?.[1];
    const text = normalizeStepText(raw);
    if (!text) continue;
    let id =
      existing && UUID_PATTERN.test(existing) && !used.has(existing)
        ? existing
        : undefined;
    if (!id) {
      const key = normalizeIdentity(text);
      const candidates = (reusable.get(key) ?? []).filter(
        (candidate) => !used.has(candidate),
      );
      id = candidates.length === 1 ? candidates[0] : randomUUID();
    }
    used.add(id);
    lines[index] = `${prefix}${text} <!-- ${PLAN_STEP_ID_PREFIX} ${id} -->`;
  }
  return lines.join("\n").trim();
}

export function finalizePlanDocument(
  content: string,
  planType: PlanKind,
  previousContent?: string,
): FinalizedPlanDocument {
  const previousMetadata = previousContent
    ? parseMetadata(previousContent)
    : undefined;
  const withStepIds = ensurePlanStepIds(content, previousContent);
  const previousSemantic = previousContent
    ? ensurePlanStepIds(previousContent, previousContent)
    : undefined;
  const samePlan =
    previousMetadata !== undefined &&
    previousMetadata.planType === planType;
  const semanticChanged =
    previousSemantic === undefined || previousSemantic !== withStepIds;
  const metadata: PlanSnapshotMetadata = {
    version: PLAN_SNAPSHOT_METADATA_VERSION,
    planId: samePlan ? previousMetadata.planId : randomUUID(),
    planRevision: samePlan
      ? previousMetadata.planRevision + (semanticChanged ? 1 : 0)
      : 1,
    planType,
  };
  const finalized = stampPlanSnapshotMetadata(withStepIds, metadata);
  const parsed = parsePlanSnapshot(finalized);
  if (!parsed.snapshot) {
    throw new Error(
      parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
  }
  return {
    content: finalized,
    metadata,
    snapshot: parsed.snapshot,
    changed: finalized !== content,
  };
}

export function hashPlanSnapshotContent(content: string): string {
  return sha256(content);
}

export function isSafeTechnicalScopeEntry(value: string): boolean {
  return validateScopeEntry(value) !== undefined;
}
