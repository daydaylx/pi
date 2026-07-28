/**
 * Deterministic routing assessment.
 *
 * Pure: turns a RoutingInput into structured evidence plus a raw score. No
 * file system, no execution, no confidence percentage, no model names. The
 * caller (decide.ts) turns this into a level; the score follows the documented
 * point system (Auftrags-Abschnitt 7), and harte HIGH-Kategorien always force
 * HIGH regardless of the score.
 */
import type {
  RoutingAssessment,
  RoutingEvidence,
  RoutingInput,
} from "./types.ts";

/**
 * A category that forces HIGH independent of the score. Categories 1–5 also
 * contribute the documented +3 to the score; categories 6–9 are override-only
 * (not in the point system) but still force HIGH.
 */
interface HardHighCategory {
  /** Menschenlesbarer Grund, landet in evidence.hardHighReasons und risk. */
  readonly reason: string;
  /** Ob diese Kategorie zum Punktesystem (+3) gehört oder nur Override ist. */
  readonly scores: boolean;
  readonly keywords: readonly string[];
}

const HARD_HIGH_CATEGORIES: readonly HardHighCategory[] = [
  {
    reason: "Authentifizierung oder Autorisierung betroffen",
    scores: true,
    keywords: [
      "auth",
      "login",
      "authenticate",
      "authentifiz",
      "authoriz",
      "berechtigung",
      "oauth",
      "jwt",
      "sso",
      "password",
      "passwort",
      "kennwort",
    ],
  },
  {
    reason: "Permission- oder Secret-Grenze betroffen",
    scores: true,
    keywords: [
      "secret",
      "api-key",
      "apikey",
      "api_key",
      "credential",
      "ssh-key",
      "private-key",
      "gpg",
      "zugangsdaten",
      "permission boundary",
      "trust boundary",
      "berechtigungsmodell",
      "permission",
      "zugriffskontrolle",
    ],
  },
  {
    reason: "Datenmigration betroffen",
    scores: true,
    keywords: ["migration", "migrate", "datentransformation", "datenmigration"],
  },
  {
    reason: "Persistentes Dateiformat oder Schema betroffen",
    scores: true,
    keywords: [
      "schema",
      "datenformat",
      "serialisier",
      "persistenz",
      "persistente",
      "json-schema",
      "versioniert",
      "sidecar",
      "manifest",
    ],
  },
  {
    reason: "CAS oder parallele Schreibzugriffe betroffen",
    scores: true,
    keywords: [
      "cas",
      "content-addressed",
      "atomic write",
      "atomarer schreib",
      "concurrency",
      "nebenläufig",
      "race condition",
      "mutex",
      "schreibzugriff",
    ],
  },
  {
    reason: "Zentrale Workflow-State-Logik betroffen",
    scores: false,
    keywords: [
      "workflow-state",
      "workflowstatus",
      "workflow status",
      "workflow state",
      "state machine",
      "workflow-status",
      "session-state",
    ],
  },
  {
    reason: "Completion- oder Abschlusslogik betroffen",
    scores: false,
    keywords: [
      "completion",
      "task-done",
      "/finish",
      "abschlusslogik",
      "completion-pipeline",
      "abschlussentscheidung",
    ],
  },
  {
    reason: "Sicherheitskritische Pfad-, Symlink- oder Systemgrenze",
    scores: false,
    keywords: [
      "symlink",
      "symbolic link",
      "/etc/",
      "chmod",
      "chown",
      "system root",
      "trust-grenze",
      "trust grenze",
    ],
  },
  {
    reason: "Runtime-Patch mit systemweiter Wirkung",
    scores: false,
    keywords: [
      "runtime-patch",
      "runtime patch",
      "monkeypatch",
      "runtime patches",
      "patch runtime",
      "loader patch",
    ],
  },
];

const PUBLIC_API_KEYWORDS: readonly string[] = [
  "api",
  "public interface",
  "public type",
  "export ",
  "endpoint",
  "sdk",
  "rest ",
  "graphql",
  "öffentliche api",
  "oeffentliche api",
  "öffentliche schnittstelle",
  "schnittstelle",
];

const ARCHITECTURE_KEYWORDS: readonly string[] = [
  "architektur",
  "architecture",
  "refactor",
  "redesign",
  "subsystem",
  "neue abhängigkeit",
  "neue dependency",
  "richtungsentscheidung",
];

const UNKNOWN_AREA_KEYWORDS: readonly string[] = [
  "unbekannt",
  "unvertraut",
  "fremder code",
  "neuer bereich",
  "unvertraut",
];

function joinSignals(input: RoutingInput): string {
  return [
    input.taskText,
    input.scopePaths.join(" "),
    input.affectedAreas.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function topSegments(paths: readonly string[]): Set<string> {
  return new Set(
    paths
      .map((path) => path.split("/")[0]?.toLowerCase())
      .filter((segment): segment is string => Boolean(segment)),
  );
}

export function assessRouting(input: RoutingInput): RoutingAssessment {
  const evidence: RoutingEvidence = {
    complexity: [],
    risk: [],
    uncertainty: [],
    hardHighReasons: [],
  };
  let score = 0;
  const signals = joinSignals(input);

  // Harte HIGH-Kategorien (Vorrang vor der Punktzahl, ausgewertet in decide.ts).
  for (const category of HARD_HIGH_CATEGORIES) {
    if (containsAny(signals, category.keywords)) {
      evidence.hardHighReasons.push(category.reason);
      evidence.risk.push(category.reason);
      if (category.scores) score += 3;
    }
  }

  // Komplexität.
  if (input.scopePaths.length >= 2) {
    score += 1;
    evidence.complexity.push("Mehrere Dateien betroffen");
  }
  const modules = topSegments(input.scopePaths);
  if (modules.size >= 2 || input.affectedAreas.length >= 2) {
    score += 1;
    evidence.complexity.push("Mehrere Module oder Schichten betroffen");
  }
  if (containsAny(signals, PUBLIC_API_KEYWORDS)) {
    score += 2;
    evidence.complexity.push("Öffentliche API oder Schnittstelle betroffen");
  }
  if (
    input.planType === "detailed_plan" ||
    containsAny(signals, ARCHITECTURE_KEYWORDS)
  ) {
    score += 2;
    evidence.complexity.push("Architekturentscheidung erforderlich");
  }

  // Unsicherheit.
  if (containsAny(signals, UNKNOWN_AREA_KEYWORDS)) {
    score += 1;
    evidence.uncertainty.push("Unbekannter Codebereich");
  }
  if (input.verification.length === 0) {
    score += 1;
    evidence.uncertainty.push("Keine Verifikation deklariert");
  }
  if (input.scopePaths.length === 0) {
    score += 1;
    evidence.uncertainty.push("Scope nicht eindeutig begrenzt");
  }

  return { evidence, score };
}
