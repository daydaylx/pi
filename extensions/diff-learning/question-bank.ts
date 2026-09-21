import type {
  LearningCandidate,
  LearningConcept,
  LearningQuestion,
  QuestionOption,
} from "./types.ts";

function choiceQuestion(
  id: string,
  concept: LearningConcept,
  prompt: string,
  correct: string,
  distractors: string[],
  explanation: string,
): LearningQuestion {
  const labels = [correct, ...distractors];
  const options: QuestionOption[] = labels.map((label, index) => ({
    id: `${id}-option-${index + 1}`,
    label,
    correct: index === 0,
  }));
  return { id, concept, prompt, options, explanation };
}

function changedText(candidate: LearningCandidate): string {
  return candidate.hunk.lines
    .filter((line) => line.kind === "added" || line.kind === "removed")
    .map((line) => line.text)
    .join("\n");
}

function hasAddedAndRemoved(candidate: LearningCandidate): boolean {
  return (
    candidate.hunk.lines.some((line) => line.kind === "added") &&
    candidate.hunk.lines.some((line) => line.kind === "removed")
  );
}

/** Deterministic MVP question templates; no question needs model output. */
export function buildQuestion(
  candidate: LearningCandidate,
): LearningQuestion | undefined {
  const concept = candidate.concepts[0];
  if (!concept) return undefined;
  const text = changedText(candidate);
  switch (concept) {
    case "diff-basics": {
      const correct = hasAddedAndRemoved(candidate)
        ? "Der Hunk enthält entfernte und hinzugefügte Zeilen."
        : candidate.hunk.lines.some((line) => line.kind === "added")
          ? "Der Hunk enthält eine hinzugefügte Zeile."
          : "Der Hunk enthält eine entfernte Zeile.";
      return choiceQuestion(
        "diff-basics-v1",
        concept,
        "Welche Aussage ist direkt am Diff-Hunk ablesbar?",
        correct,
        [
          "Der gesamte Dateiinhalt wurde geprüft.",
          "Die Änderung ist automatisch sicher.",
          "Der Agent hat die Änderung bereits korrekt erklärt.",
        ],
        "Die Antwort beschränkt sich auf die im Hunk sichtbaren +/- Zeilen; sie beweist keine Eigenschaften außerhalb dieses Ausschnitts.",
      );
    }
    case "condition-if":
      return choiceQuestion(
        "condition-if-v1",
        concept,
        "Welche Struktur ist im geänderten Ausschnitt sichtbar?",
        "Eine if-/else-if-Bedingung wurde verändert.",
        ["Ein catch-Block wurde verändert.", "Nur ein Kommentar wurde verändert."],
        "Der Hunk enthält eine sichtbare if- oder else-if-Bedingung. Über die Wirkung außerhalb dieses Ausschnitts sagt das allein nichts aus.",
      );
    case "condition-and":
      return choiceQuestion(
        "condition-and-v1",
        concept,
        "Was bedeutet der sichtbare Operator && in der Bedingung?",
        "Beide Teilausdrücke müssen wahr sein.",
        ["Mindestens einer der Teilausdrücke muss wahr sein.", "Der zweite Teilausdruck wird immer ignoriert."],
        "Der Hunk zeigt &&. Für eine erfüllte logische UND-Bedingung müssen beide Seiten wahr sein.",
      );
    case "condition-or":
      return choiceQuestion(
        "condition-or-v1",
        concept,
        "Was bedeutet der sichtbare Operator || in der Bedingung?",
        "Mindestens einer der Teilausdrücke muss wahr sein.",
        ["Beide Teilausdrücke müssen wahr sein.", "Die Bedingung ist immer falsch."],
        "Der Hunk zeigt ||. Für eine erfüllte logische ODER-Bedingung reicht eine wahre Seite.",
      );
    case "negation":
      return choiceQuestion(
        "negation-v1",
        concept,
        "Welche Rolle hat das sichtbare !?",
        "Es negiert den folgenden Ausdruck.",
        ["Es addiert zwei Zahlen.", "Es startet einen catch-Block."],
        "Der Hunk enthält ein ! außerhalb von !=/!==. Das steht für Negation des folgenden Ausdrucks.",
      );
    case "return":
      return choiceQuestion(
        "return-v1",
        concept,
        "Welche Kontrollfluss-Aussage ist im Hunk sichtbar?",
        "Ein return-Rückgabepfad wurde verändert.",
        ["Ein Fehler wird zwingend geworfen.", "Ein neuer Prozess wird gestartet."],
        "Der Hunk enthält return. Damit wird ein Rückgabepfad der Funktion verändert; der Hunk beweist nicht mehr als diesen konkreten Ausschnitt.",
      );
    case "throw":
      return choiceQuestion(
        "throw-v1",
        concept,
        "Welche Fehlerstrategie ist im Hunk sichtbar?",
        "Ein throw-Fehlerpfad wurde verändert.",
        ["Nur ein normaler Rückgabewert wurde verändert.", "Die Änderung betrifft ausschließlich Formatierung."],
        "Der Hunk enthält throw. Das markiert einen Fehlerpfad und ist nicht bloß ein normaler return-Wert.",
      );
    case "try-catch":
      return choiceQuestion(
        "try-catch-v1",
        concept,
        "Welche Fehlerbehandlungsstruktur ist sichtbar?",
        "Ein try-/catch-Pfad wurde verändert.",
        ["Eine Test-Erwartung ist die einzige sichtbare Struktur.", "Ein Importpfad wurde ohne Kontrollfluss verändert."],
        "Der Hunk enthält try oder catch. Er zeigt damit eine konkrete Fehlerbehandlungsstruktur, nicht automatisch eine vollständige Fehlerstrategie.",
      );
    case "fallback":
      return choiceQuestion(
        "fallback-v1",
        concept,
        "Welche Fallback-Aussage passt zum sichtbaren Ausdruck?",
        text.includes("??")
          ? "Die rechte Seite wird bei null oder undefined als Ersatz verwendet."
          : "Ein konkreter Fallback-Begriff oder -Pfad wurde verändert.",
        text.includes("??")
          ? [
              "Die rechte Seite wird immer zuerst ausgewertet.",
              "Der Ausdruck ist dadurch immer true.",
            ]
          : [
              "Damit ist das gesamte Fehlerverhalten bewiesen.",
              "Alle anderen Rückgabepfade sind dadurch entfernt.",
            ],
        text.includes("??")
          ? "Der Hunk zeigt den Nullish-Coalescing-Operator ??. Die rechte Seite dient nur bei null oder undefined als Ersatz."
          : "Die Erklärung bleibt auf den im Hunk sichtbaren Fallback-Begriff oder -Pfad beschränkt.",
      );
    case "permission-change":
      return choiceQuestion(
        "permission-change-v1",
        concept,
        "Was ist an dieser sicherheitsnahen Änderung direkt belegt?",
        "Eine konkrete Berechtigungs-/Zugriffsbedingung oder Bezeichnung wurde geändert.",
        [
          "Der gesamte Zugriffsschutz des Projekts ist entfernt.",
          "Alle Nutzer erhalten dadurch automatisch Zugriff.",
          "Die Änderung ist unabhängig vom gezeigten Hunk sicher.",
        ],
        "Der Hunk belegt nur die konkrete sichtbare Berechtigungs- oder Zugriffsänderung. Aussagen über das gesamte Projekt wären außerhalb der Beweislage.",
      );
    case "guard-removal":
      return choiceQuestion(
        "guard-removal-v1",
        concept,
        "Welche Aussage beschreibt die sichtbare Entfernung?",
        "Eine konkrete Guard-/Early-return-/Early-throw-Zeile wurde entfernt.",
        [
          "Alle Validierungen im Projekt wurden entfernt.",
          "Der Code ist dadurch nachweislich sicherer.",
          "Nur ein Kommentar wurde geändert.",
        ],
        "Der Hunk zeigt die konkrete entfernte Guard-Struktur. Er beweist keine Aussage über alle Prüfungen oder die Gesamtsicherheit.",
      );
    case "test-expectation":
      return choiceQuestion(
        "test-expectation-v1",
        concept,
        "Was wurde im gezeigten Test nachweisbar geändert?",
        "Eine Test-Erwartung wurde geändert.",
        [
          "Der Produktcode wurde dadurch nachweislich repariert.",
          "Alle Tests des Projekts sind dadurch aussagekräftiger.",
          "Die Berechtigungslogik wurde sicher geändert.",
        ],
        "Der Hunk zeigt eine Test-/Assertion-Erwartung. Das allein ist kein Beweis für eine Produktcode-Änderung oder einen behobenen Fehler.",
      );
    case "validation":
      return choiceQuestion(
        "validation-v1",
        concept,
        "Welche Änderung ist im Ausschnitt direkt sichtbar?",
        "Eine konkrete Validierungs- oder Eingabeprüfung wurde verändert.",
        [
          "Alle Eingaben des Projekts werden jetzt geprüft.",
          "Die Änderung beweist eine vollständige Sicherheitsprüfung.",
          "Nur die Dateiformatierung wurde verändert.",
        ],
        "Der Hunk enthält eine konkrete Validierungs-/Schema-/Parsing-Stelle. Die Aussage gilt nicht automatisch für andere Eingabepfade.",
      );
  }
}
