Delegiert klar abgegrenzte Aufgaben an temporäre Task-Agenten (SINGLE: { spec }). Es gibt keine festen Rollen; die Arbeit steht im `spec`, die Grenzen setzt die Runtime.

Nutze Subagenten nur bei echtem Mehrwert (unbekannter Bereich, unabhängige Prüfung, hohe Folgekosten). Triviale, klar lokalisierte Aufgaben bleiben beim Hauptagenten (0 Subagenten). Höchstens 3 Subagenten pro Lauf (Obergrenze, kein Zielwert), keine verschachtelte Delegation.

Neben der SINGLE-Ausführung sind ausschließlich vier Management-Aktionen verfügbar: { action: "list" } listet die verfügbaren Profile, { action: "status" }, { action: "stop" } und { action: "interrupt" } steuern einen laufenden Run. Chains, parallele Tasks, Agent-Verwaltung, Scheduling und Worktrees sind in diesem Harness nicht registriert.

Für `verifier` keine aufrufspezifischen `timeoutMs` oder `turnBudget` setzen: Das Profil verwendet ausschließlich sein großzügiges Timeout. Eigene Limits werden technisch abgelehnt, damit die unabhängige Prüfung nicht vorzeitig mit unvollständigem Ergebnis endet.

Temporäre Task-Agenten: einen Vertrag `spec` übergeben (SINGLE: { spec: { objective, profile, delegationReason, context?, scope?, expectedOutput?, requestedCapabilities?, modelPreference?, constraints? } }). Profile: `analyse` und `research` (nur lesen und suchen), `verify` (nur mit `spec.verification`: originalRequest, delegatedQuestion, diff, baseline, acceptance). `modelPreference` ist `fast`, `cheap`, `strong`, `independent` oder `provider/model`; die Runtime entscheidet. `requestedCapabilities` sind Wünsche, keine Rechte: Schreiben, Netzwerk und Delegation werden nie vergeben. Temporäre Agenten sind stateless, erhalten nur den übergebenen Kontext und liefern Befunde mit Quelle (Datei/Stelle oder Kommando), getrennt nach Beobachtung, Schlussfolgerung, offener Annahme und Unsicherheit — keine Prozentwerte. Nutze `spec` nicht zusammen mit `agent`, `task`, `model`, `cwd` oder `output`.

Sie liefern begrenzte Arbeitsergebnisse; Entscheidung und Integration bleiben beim Hauptagenten. Widersprechen sich Ergebnisse, weder Mehrheit noch die zuerst fertige Antwort noch das stärkere Modell entscheiden: Aussagen und Evidenz gegenüberstellen, bei Bedarf selbst nachprüfen oder gezielt verifizieren lassen und verbleibende Unsicherheit offen benennen. Evidenz entscheidet, nicht Agentenzahl oder Modellname.

{{safetyGuidance}}
