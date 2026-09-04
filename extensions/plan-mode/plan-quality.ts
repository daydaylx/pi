/**
 * The one mechanical difference between a Schnellplan and an Architekturplan.
 *
 * Before this module the two plan modes differed only in the headings their
 * prompt suggested, and the prompt said outright that the structure was "eine
 * Empfehlung, keine Validierungsregel". Two modes that cannot be told apart
 * afterwards are one mode with two names.
 *
 * The check is deliberately shallow. It answers "did the author actually fill
 * this section in?" — a heading with a body that is neither empty nor the
 * template's own placeholder line. It does not try to judge whether the prose
 * is any good: natural language is not mechanically verifiable, and a validator
 * that pretends otherwise only teaches the model to write around it. Real plan
 * quality is measured separately by the evaluation suite in
 * `tests/plan-eval/`, which is where judgement-shaped criteria belong.
 */
import type { WorkflowMode } from "../shared/workflow-mode.ts";

export interface PlanQualityIssue {
  code: string;
  message: string;
}

export interface PlanQualityResult {
  ok: boolean;
  issues: readonly PlanQualityIssue[];
}

export type PlanningMode = Exclude<WorkflowMode, "work">;

/**
 * Sections a plan must carry, per mode.
 *
 * `Optionen`, `Empfehlung`, and a migration/rollback section stay optional on
 * purpose: the brief asks for real alternatives *only* where several sensible
 * paths exist, so requiring them would manufacture exactly the fake choices the
 * planning prompt tells the model not to invent.
 */
const SIMPLE_SECTIONS = [
  "Ziel",
  "Vorgehen",
  "Betroffene Bereiche",
  "Verifikation",
  "Risiken",
] as const;

const DETAILED_SECTIONS = [
  "Ziel",
  "Nicht-Ziele",
  "Ausgangslage",
  "Annahmen",
  "Umsetzung",
  "Abhängigkeiten",
  "Abschlusskriterien",
  "Verifikation",
  "Risiken",
] as const;

/** Minimum body text, excluding headings and list markers. */
const MIN_BODY_CHARS: Record<PlanningMode, number> = {
  simple_plan: 160,
  detailed_plan: 480,
};

export function requiredSections(mode: PlanningMode): readonly string[] {
  return mode === "detailed_plan" ? DETAILED_SECTIONS : SIMPLE_SECTIONS;
}

interface Section {
  heading: string;
  level: number;
  body: string;
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Split a markdown document into its ATX headings and their bodies, respecting
 * heading depth: a deeper heading (e.g. `### Phase 1` under `## Umsetzung`) is
 * a subsection *of* the enclosing heading, not a sibling that steals lines out
 * of it. Every line — including a subheading's own line, so a section's body
 * still shows how many subheadings it contains — is appended to every
 * currently open ancestor, not just the innermost one, which is what lets
 * `countUmsetzungSteps` see phases written as `### Phase N` headings and not
 * just as a flat list.
 */
export function planSections(content: string): Section[] {
  const sections: Section[] = [];
  const open: Section[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(\S.*)$/.exec(line);
    if (match) {
      const level = match[1].length;
      // A heading at this level or shallower closes every deeper or equal
      // section still open — those are done, this line starts a sibling or a
      // new parent, not their content.
      while (open.length > 0 && open[open.length - 1].level >= level) {
        open.pop();
      }
      for (const ancestor of open) ancestor.body += `${line}\n`;
      const section: Section = { heading: normalizeHeading(match[2]), level, body: "" };
      sections.push(section);
      open.push(section);
      continue;
    }
    for (const ancestor of open) ancestor.body += `${line}\n`;
  }
  return sections;
}

/**
 * A body counts as filled when it carries prose of its own. The template lines
 * the planning prompt ships ("Nur wenn ...") are placeholders, not content, so
 * a section that only echoes one back is still empty.
 */
function bodyIsFilled(body: string): boolean {
  const text = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^nur wenn\b/i.test(line) &&
        !/^(?:todo|tbd|n\/a|-{3,}|\.{3,})$/i.test(line),
    )
    .join(" ");
  return text.replace(/[-*+>`#|]/g, "").trim().length >= 12;
}

function bodyTextLength(content: string): number {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .join(" ")
    .replace(/[-*+>`#|]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** Phases of an Umsetzung section: sub-headings or list items, whichever is used. */
function countUmsetzungSteps(body: string): number {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const listItems = lines.filter((line) =>
    /^(?:[-*+]\s+\S|\d+[.)]\s+\S)/.test(line),
  ).length;
  const subHeadings = lines.filter((line) => /^#{3,6}\s+\S/.test(line)).length;
  return Math.max(listItems, subHeadings);
}

export function assessPlanQuality(
  mode: PlanningMode,
  content: string,
): PlanQualityResult {
  const issues: PlanQualityIssue[] = [];
  if (content.trim().length === 0) {
    return {
      ok: false,
      issues: [{ code: "empty", message: "Der Plan ist leer." }],
    };
  }

  const sections = planSections(content);
  const filled = new Set(
    sections.filter((s) => bodyIsFilled(s.body)).map((s) => s.heading),
  );
  for (const required of requiredSections(mode)) {
    const key = normalizeHeading(required);
    // Exact match, not substring: normalizeHeading("Nicht-Ziele") produces
    // "nicht ziele", which *contains* "ziel" — a loose `.includes(key)` check
    // let a filled "Nicht-Ziele" section silently satisfy the "Ziel"
    // requirement. The fixed templates in prompts.ts always emit the required
    // heading verbatim, so exact equality costs nothing a well-formed plan
    // would ever hit.
    const present = filled.has(key);
    if (!present) {
      issues.push({
        code: `section:${key.replace(/\s+/g, "-")}`,
        message: `Abschnitt "${required}" fehlt oder ist ohne eigenen Inhalt.`,
      });
    }
  }

  const length = bodyTextLength(content);
  if (length < MIN_BODY_CHARS[mode]) {
    issues.push({
      code: "too-short",
      message: `Der Plan trägt ${length} Zeichen Fließtext, gefordert sind mindestens ${MIN_BODY_CHARS[mode]}.`,
    });
  }

  if (mode === "detailed_plan") {
    const umsetzung = sections.find(
      (s) => s.heading === normalizeHeading("Umsetzung"),
    );
    if (umsetzung && countUmsetzungSteps(umsetzung.body) < 2) {
      issues.push({
        code: "phases",
        message:
          'Ein Architekturplan gliedert "Umsetzung" in mindestens zwei benannte Phasen oder Schritte.',
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** One agent-readable message listing every unmet requirement. */
export function describePlanQuality(
  mode: PlanningMode,
  result: PlanQualityResult,
): string {
  const label = mode === "detailed_plan" ? "Architekturplan" : "Schnellplan";
  return [
    `Der ${label} erfüllt die Mindestanforderungen noch nicht:`,
    ...result.issues.map((issue) => `- ${issue.message}`),
    "Ergänze die genannten Punkte und schreibe den Plan erneut.",
  ].join("\n");
}
