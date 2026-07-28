## 1. Kurzfazit

  • Reproduzierbarkeit: Die untersuchten Fehler sind im Quellcode und in der Laufzeitstruktur
  vollständig nachvollziehbar und reproduzierbar.
  • Hauptursache: Entkopplung zwischen temporärem In-Memory-Flag (session.planningKind) und dem
  echten Workflow-Sidecar-Zustand (current-plan.state.json), kombiniert mit fehlenden Workflow-
  Aktivierungsereignissen bei Abbruch/Abschluss und doppelter Kontextinjektion (sendMessage +
  before_agent_start).
  • Runtime-Patches: Alle 6 geforderten Runtime-Patches sind in der aktuellen Umgebung (Pi
  Runtime 0.82.1) vorhanden; ohne sie kehrt sich jedoch die Ladereihenfolge der Extensions um.
  • Rechte-Inkonsistenz: Rechte sind nicht nur falsch angezeigt, sondern tatsächlich effektiv
  falsch: Nach /discard-plan oder nach Ende des Planungs-Turns bleibt readonly wirksam, weil kein
  Aktivierungs-Event für work gesendet wird.
  • Planübergabe: Die Plan- und Kontextübergabe ist doppelt: /work sendet den Plantext über pi.
  sendMessage() und injiziert ihn vor Agentenstart über before_agent_start erneut.
  • Die 3 Höchstpriorisierten Änderungen:
      1. workflowMode() an den tatsächlichen Sidecar-Zustand binden und
      WORKFLOW_CAPABILITY_EVENTS.activated bei allen Statusübergängen (inkl. /discard-plan und
      Plan-Finalisierung) feuern.
      2. Die doppelte Kontextinjektion in events.ts (before_agent_start) auflösen.
      3. plan-mode an die Aurora-Eventkanäle (AURORA_UI_CHANNELS) anbinden.

  ──────
  ## 2. Lokale Umgebung

   Parameter                     │ Wert / Status
  ───────────────────────────────┼───────────────────────────────────────────────────────────────
   Repository-Pfad                   │ /home/d/.pi/agent
   Aktueller Branch                  │ main
   Aktueller Commit                  │ 7f8067e23f70b5638f6a8edd5becb9c5da91e28f
   Git-Status (--short)              │ Modifiziert: extensions/aurora-ui/footer.ts,
                                     │ extensions/aurora-ui/index.ts, extensions/aurora-
                                     │ ui/state.ts, extensions/plan-mode/commands.ts,
                                     │ extensions/plan-mode/completion-commands.ts,
                                     │ extensions/plan-mode/completion/report.ts,
                                     │ extensions/plan-mode/completion/types.ts,
                                     │ extensions/plan-mode/direct-task-commands.ts,
                                     │ extensions/plan-mode/execution.ts, extensions/plan-
                                     │ mode/session.ts, extensions/plan-mode/store/types.ts,
                                       │ extensions/setup-core/config.ts,
                                       │ schemas/setup.schema.json, settings.json,
                                       │ tests/workflow-v3.mjsUntracked: extensions/plan-
                                       │ mode/route-commands.ts, extensions/plan-mode/routing/,
                                       │ tests/workflow-v3/routing.test.mjs
   Node-Version                        │ v22.22.2
   npm-Version                         │ 10.9.7
   Pi-CLI-Version                      │ 0.82.1 (/home/d/.npm-global/bin/pi)
   Installierter Pi-Runtime-Pfad       │ /home/d/.npm-global/lib/node_modules/@earendil-
                                       │ works/pi-coding-agent
   Dev-Dependency-Version              │ pi-agent (lokales Repo)
   Aktive settings.json                │ /home/d/.pi/agent/settings.json
   Deklarierte Extension-Reihenfolge   │ 1. extensions/setup-core/index.ts2. extensions/plan-
                                       │ mode/index.ts3. extensions/mode-permissions.ts4.
                                       │ extensions/lsp/index.ts5. extensions/ask-user.ts6.
                                       │ extensions/tool-output-guard.ts7. extensions/diff-
                                       │ viewer/index.ts8. extensions/control-plane.ts9.
                                       │ extensions/aurora-ui/index.ts
   Globale / Projekt-Setup-Dateien     │ /home/d/.pi/agent/setup.json
   Aktive Nutzer-Workflowdateien       │ Keine aktiven Workflow-Dateien vorhanden
                                       │ (.agent/plans/current-plan.md und .agent/plans/current-
                                       │ plan.state.json nicht aktiv; Archiv in
                                       │ .agent/plans/archive/ vorhanden).
   Abweichung Repository vs. Pi-Config │ Keines; Repository-Pfad und Pi-Konfigurationspfad sind
                                       │ identisch (/home/d/.pi/agent).
  ──────
  ## 3. Kritische Befunde

  ### Befund 1 (P1): workflowMode() liefert sofort nach Planungsende work, während der Sidecar
  noch in planning steht (Hypothese H1)

  1. Titel: Inkonsistenz zwischen In-Memory workflowMode() und Sidecar-Status nach agent_settled.
  2. Priorität: P1
  3. Beobachtetes Verhalten: Sobald der LLM den Planungs-Turn beendet hat (agent_settled ->
  finalizePlanning()), wird session.planningKind auf undefined gesetzt. session.workflowMode()
  liefert daraufhin sofort "work". Der Sidecar-Zustand in .agent/plans/current-plan.state.json
  hat jedoch weiterhin status: "planning".
  4. Erwartetes Verhalten: workflowMode() und der übermittelte Capability-Modus müssen den
  tatsächlichen Sidecar-Zustand widerspiegeln, bis /work den Modus explizit auf working umstellt.
  5. Reproduzierbare Schritte:
      • Run /plan quick.
      • Agenten den Plan schreiben lassen (Turn endet mit agent_settled).
      • Abfrage von requestWorkflowCapabilities(pi.events) ausführen: Ergebis ist { state:
      "planning", mode: "work" }.
  6. Betroffene Dateien und Funktionen:
      • session.ts: WorkflowSession.workflowMode()
      • planning.ts: finalizePlanning()
      • events.ts: WORKFLOW_CAPABILITY_EVENTS.request Handler
  7. Konkrete Codezeilen:
      • extensions/plan-mode/session.ts:L91: workflowMode() { return session.planningKind ??
      "work"; }
      • extensions/plan-mode/planning.ts:L217: session.planningKind = undefined;
  8. Technische Ursache: workflowMode() stützt sich ausschließlich auf das flüchtige Flag
  planningKind, statt den geladenen Sidecar-Zustand session.current.state?.status einzubeziehen.
  9. Auswirkung: UI-Workflow-Wechsler (Shift+Tab) zeigt „Arbeiten“ als aktiv an, obwohl der Plan
  noch nicht freigegeben wurde. Bei einem Re-Init oder Session-Start vor /work schaltet das
  Rechte-Modul fälschlicherweise auf project-write um.
  10. Warum bestehende Tests den Fehler nicht erkennen: Tests prüften workflowMode() nur während
  eines aktiven Planungsturns, aber nicht nach dem Aufruf von finalizePlanning().
  11. Kleinste sichere Reparaturoption: In workflowMode() prüfen, ob session.current.state?.
  status === "planning" vorliegt, und in diesem Fall den Typ aus session.current.snapshot?.
  planType zurückgeben.
  12. Architektonisch saubere Reparaturoption: workflowMode() als abgeleiteten Getter aus einem
  zentralen Workflow-State-Machine-Zustand implementieren, der Sidecar-Status und aktive Turns
  konsistent zusammenführt.
  13. Notwendige Regressionstests: workflowMode() und Capability-Response nach finalizePlanning()
  vor /work testen.
  14. Sicherheit der Einschätzung: 99%
  ──────
  ### Befund 2 (P1): Doppelte Planübergabe (executionPrompt wird bei /work zweifach injiziert)
  (Hypothese H4)

  1. Titel: Doppelte Injektion des Ausführungsprompts bei /work.
  2. Priorität: P1
  3. Beobachtetes Verhalten: Beim Ausführen von /work wird der vollständige Plantext und
  Schrittstatus zweifach an das LLM gesendet.
  4. Erwartetes Verhalten: Der Ausführungskontext darf exakt einmal pro Agententurn im Context-
  Window vorkommen.
  5. Reproduzierbare Schritte:
      • Aktiven Plan erstellen.
      • /work ausführen.
      • Nachrichtenhistorie prüfen: Sowohl die per pi.sendMessage() gesendete Nachricht pi-work-
      request als auch die von before_agent_start injizierte Nachricht pi-work-context enthalten
      den identischen executionPrompt(snapshot, state).
  6. Betroffene Dateien und Funktionen:
      • execution.ts: startWork()
      • events.ts: before_agent_start Listener
  7. Konkrete Codezeilen:
      • extensions/plan-mode/execution.ts:L212-L218:
        session.pi.sendMessage({
          customType: "pi-work-request",
          content: executionPrompt(loaded.snapshot, saved),
          display: true,
        }, { triggerTurn: true });

      • extensions/plan-mode/events.ts:L67-L73:
        if (loaded.snapshot && loaded.state?.status === "working") {
          return { message: { customType: "pi-work-context", content: executionPrompt(loaded.
      snapshot, loaded.state) } };
        }

  8. Technische Ursache: startWork() verwendet sendMessage() mit triggerTurn: true. Beim Start
  dieses Agententurns schlägt zusätzlich der Event-Hook before_agent_start an und injiziert den
  gleichen Prompt ein zweites Mal.
  9. Auswirkung: Verschwendung von Context-Tokens (mehrere tausend Tokens bei großen Plänen),
  Verdopplung von Instruction-Weight, Verwirrung des LLM durch doppelte Handlungsanweisungen.
  10. Warum bestehende Tests den Fehler nicht erkennen: Tests haben executionPrompt() und
  before_agent_start isoliert auf ihre Rückgabewerte geprüft, aber nicht die Gesamtzahl der
  Prompt-Vorkommnisse in einer echten Nachrichtensequenz gezählt.
  11. Kleinste sichere Reparaturoption: In before_agent_start prüfen, ob der Turn durch pi-work-
  request ausgelöst wurde, und in diesem Fall die Zusatzinjektion unterdrücken.
  12. Architektonisch saubere Reparaturoption: Einheitliche Kontext-Handoff-Architektur:
  sendMessage() stellt nur das Trigger-Signal dar oder before_agent_start ist die alleinige
  Injektionsquelle für Arbeitskontexte.
  13. Notwendige Regressionstests: Nach /work alle Nachrichten im Prompt-Array erfassen und
  prüfen, dass [PI WORKFLOW: AUSFÜHRUNG] exakt einmal enthalten ist.
  14. Sicherheit der Einschätzung: 100%
  ──────
  ### Befund 3 (P1): Fehlende Permission-Aktivierungsereignisse beim Verwerfen eines Plans
  (/discard-plan) (Hypothese H2)

  1. Titel: readonly-Berechtigung bleibt nach /discard-plan dauerhaft aktiv.
  2. Priorität: P1
  3. Beobachtetes Verhalten: Wenn ein Plan mit /discard-plan verworfen wird, wird kein
  WORKFLOW_CAPABILITY_EVENTS.activated-Event für den Modus work gesendet. Die Rechte-Extension
  verbleibt im Zustand readonly.
  4. Erwartetes Verhalten: Beim Verwerfen eines Plans muss der Workflow-Default work (project-
  write) wiederhergestellt werden.
  5. Reproduzierbare Schritte:
      • /plan quick ausführen (Rechte schalten auf readonly).
      • /discard-plan ausführen und bestätigen.
      • Effektive Rechte abfragen: Sie verharren auf readonly.
  6. Betroffene Dateien und Funktionen:
      • maintenance-commands.ts: discardPlan()
  7. Konkrete Codezeilen:
      • extensions/plan-mode/maintenance-commands.ts:L54-L62: discardActiveWorkflow wird
      aufgerufen, aber session.publishWorkflowActivation(ctx) fehlt.
  8. Technische Ursache: discardPlan() löscht die Dateien und aktualisiert das TUI-Statusfeld,
  benachrichtigt aber das Eventsystem nicht über den Moduswechsel zurück zu work.
  9. Auswirkung: Der Nutzer kann nach dem Verwerfen eines Plans keine Projektdateien mehr
  bearbeiten, ohne manuell /permission project-write einzutippen.
  10. Warum bestehende Tests den Fehler nicht erkennen: Die Tests für discardPlan prüften das
  Löschen im Store, nicht aber den Zustand der mode-permissions-Extension.
  11. Kleinste sichere Reparaturoption: Aufruf von session.publishWorkflowActivation(ctx) am Ende
  von discardPlan() hinzufügen.
  12. Architektonisch saubere Reparaturoption: publishWorkflowActivation(ctx) automatisch an das
  Umschalten des Sidecar-Status binden (replaceState / discardActiveWorkflow).
  13. Notwendige Regressionstests: discardPlan ausführen und verifizieren, dass mode-permissions
  das Activation-Event empfängt und den Default auf project-write zurücksetzt.
  14. Sicherheit der Einschätzung: 100%
  ──────
  ### Befund 4 (P2): plan-mode veröffentlicht keine Aurora-UI-State-Snapshots oder -Patches
  (Hypothese H3)

  1. Titel: Aurora UI zeigt dauerhaft phase: "idle" und label: "ARBEIT".
  2. Priorität: P2
  3. Beobachtetes Verhalten: Bei Zustandsänderungen (z. B. planning, reviewing, paused, blocked)
  meldet plan-mode nur klassische TUI-Statuswerte (setTuiStatus), veröffentlicht aber keine
  Aurora-Patches oder Snapshots über AURORA_UI_CHANNELS.
  4. Erwartetes Verhalten: Aurora UI muss bei jedem Statusübergang aktualisiert werden und auf
  aurora-ui/state/request-Events antworten.
  5. Reproduzierbare Schritte:
      • /plan quick ausführen.
      • Aurora-UI-State abfragen oder AURORA_UI_CHANNELS.request senden.
      • Der Bereich workflow in Aurora wird von plan-mode nicht befüllt.
  6. Betroffene Dateien und Funktionen:
      • presentation.ts: updateWorkflowPresentation()
      • events.ts: Listener-Registrierung
  7. Konkrete Codezeilen:
      • extensions/plan-mode/events.ts: Keinerlei Registrierung für AURORA_UI_CHANNELS.request.
      • extensions/plan-mode/presentation.ts: Verwendet nur setTuiStatus.
  8. Technische Ursache: plan-mode wurde für die klassische TUI entwickelt; der Aurora-Provider-
  Vertrag (publishAuroraUiPatch / publishAuroraUiSnapshot) wurde nicht implementiert.
  9. Auswirkung: Visuelle Asynchronität in modernen UIs (Aurora-Night Theme / Aurora Surface
  Framework).
  10. Warum bestehende Tests den Fehler nicht erkennen: Der Test FAIL: [Aurora UI lifecycle and
  responsive surfaces] the editor frame names the current step schlägt in der bestehenden Suite
  bereits fehl.
  11. Kleinste sichere Reparaturoption: In updateWorkflowPresentation() zusätzlich
  publishAuroraUiPatch aufrufen und in events.ts auf AURORA_UI_CHANNELS.request lauschen.
  12. Architektonisch saubere Reparaturoption: Einen gemeinsamen Presentation-Service in shared/
  nutzen, der TUI-Status und Aurora-UI-State gleichzeitig versorgt.
  13. Notwendige Regressionstests: Antwort auf AURORA_UI_CHANNELS.request in allen 7 Workflow-
  Zuständen testen.
  14. Sicherheit der Einschätzung: 98%
  ──────
  ### Befund 5 (P2): Fortschritt bleibt nach Planrevision erhalten trotz Nutzerwarnung (Hypothese
  H6)

  1. Titel: Abgeschlossene Schritte und Evidence bleiben bei neuer Planrevision erhalten.
  2. Priorität: P2
  3. Beobachtetes Verhalten: Beim erneuten Aufruf von /plan wird der Nutzer gewarnt, dass der
  bisherige Fortschritt invalidiert wird. Werden jedoch im neuen Plan Schritte mit identischem
  Text geschrieben, behalten sie den Status completed und ihre alte evidence.
  4. Erwartetes Verhalten: Eine vom Nutzer bestätigte Planrevision muss den
  Ausführungsfortschritt und abgeschlossene Schritte auf pending zurücksetzen.
  5. Reproduzierbare Schritte:
      • Schritt 1 abschließen (/done 1).
      • /plan ausführen und Warnung bestätigen.
      • Text von Schritt 1 unverändert lassen und Plan finalisieren.
      • Schritt 1 ist im neuen Sidecar weiterhin completed.
  6. Betroffene Dateien und Funktionen:
      • plan-snapshot.ts: ensurePlanStepIds()
      • workflow-state-factory.ts: reconcileSteps()
  7. Konkrete Codezeilen:
      • extensions/plan-mode/store/workflow-state-factory.ts:L23-L24: return existing ? { ...
      existing } : { id: step.id, status: "pending" };
  8. Technische Ursache: reconcileSteps übernimmt den Zustand existing bedingungslos, sobald die
  Step-ID gleich bleibt – unabhängig davon, ob sich die planRevision erhöht hat.
  9. Auswirkung: Invalide Nachweise und veralteter Fortschritt sickernden in revidierte Pläne ein.
  10. Warum bestehende Tests den Fehler nicht erkennen: Tests prüften reconcileSteps für Sidecar-
  Reperaturen, aber nicht den spezifischen Ablauf einer expliziten Planrevision.
  11. Kleinste sichere Reparaturoption: In createWorkflowState() bei Erhöhung von planRevision
  reconcileSteps anweisen, alle Schritt-Zustände auf pending zurückzusetzen.
  12. Architektonisch saubere Reparaturoption: Trennung zwischen struktureller ID-
  Wiederverwendung (für Nachvollziehbarkeit) und Fortschritts-Invalidation (bei Versionssprung).
  13. Notwendige Regressionstests: Erstellen einer Planrevision mit identischen Schritttexten und
  Prüfung auf status: "pending".
  14. Sicherheit der Einschätzung: 98%
  ──────
  ### Befund 6 (P2): Fehlerhafte Test-Assertion in bestehender Testsuite (Hypothese H7)

  1. Titel: Testfehlschlag in tests/workflow-v3/routing.test.mjs.
  2. Priorität: P2
  3. Beobachtetes Verhalten: node tests/workflow-v3.mjs bricht ab mit FAIL: [profiles are
  swappable and fall back safely] invalid config uses the documented fallback — expected "coding",
  got undefined.
  4. Erwartetes Verhalten: Die integrierte Testsuite muss ohne Fehler durchlaufen.
  5. Reproduzierbare Schritte: node tests/workflow-v3.mjs ausführen.
  6. Betroffene Dateien und Funktionen:
      • routing.test.mjs: Test-Definition
      • profiles.ts: resolveProfiles()
  7. Konkrete Codezeilen:
      • tests/workflow-v3/routing.test.mjs:L151-L155: Greift auf fallback.workerProfile zu,
      während resolveProfiles ein Objekt mit Eigenschaft worker liefert.
  8. Technische Ursache: Refactoring des Datenmodells (worker statt workerProfile), ohne die
  Testdatei anzupassen.
  9. Auswirkung: Falsche Signale beim Ausführen von Regressionstests.
  10. Warum bestehende Tests den Fehler nicht erkennen: Der Test schlägt aktuell reproduzierbar
  fehl.
  11. Kleinste sichere Reparaturoption: fallback.worker in routing.test.mjs:L152 abfragen.
  12. Confidence: 100%
  ──────
  ### Befund 7 (P3): Manuelle Rechte-Auswahl verharrt über Workflow-Grenzen hinweg

  1. Titel: Manuell gewählte Berechtigungsstufe blockiert automatische Workflow-Defaults.
  2. Priorität: P3
  3. Beobachtetes Verhalten: Wenn der Nutzer manuell /permission confirm-all ausführt, setzt das
  Rechte-Modul selectedPermissionState = "MANUAL". Bei späteren Workflow-Wechseln (z. B. von
  Planung zu /work) greift der neue Default (project-write) nicht mehr.
  4. Erwartetes Verhalten: Ein Workflow-Wechsel sollte den manuellen Override entweder
  zurücksetzen oder den Nutzer ausdrücklich darauf hinweisen.
  5. Betroffene Dateien: session-state.ts
  6. Confidence: 95%
  ──────
  ## 4. Transition-Matrix

   Über… │ Side… │ work… │ Capa… │ Capa… │ Perm… │ gewä… │ effe… │ TUI-… │ Auro… │ Agen… │ Bewe…
  ───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────
   1.    │ idle  │ work  │ idle  │ work  │ proje │ proje │ proje │ ARBEI │ idle  │ None  │ konsi
   Sessi │       │       │       │       │ ct-   │ ct-   │ ct-   │ T     │       │       │ stent
   on-   │       │       │       │       │ write │ write │ write │       │       │       │
   Start │       │       │       │       │       │       │       │       │       │       │
   ohne  │       │       │       │       │       │       │       │       │       │       │
   Plan  │       │       │       │       │       │       │       │       │       │       │
   2.    │ worki │ work  │ worki │ work  │ proje │ proje │ proje │ ARBEI │ idle  │ pi-   │ wider
   Sessi │ ng    │       │ ng    │       │ ct-   │ ct-   │ ct-   │ T     │ (stal │ work- │ sprüc
   on-   │       │       │       │       │ write │ write │ write │       │ e)    │ conte │ hlich
   Start │       │       │       │       │       │       │       │       │       │ xt    │ (Auro
   mit   │       │       │       │       │       │       │       │       │       │       │ ra
   Plan  │       │       │       │       │       │       │       │       │       │       │ veral
         │       │       │       │       │       │       │       │       │       │       │ tet)
   3.    │ idle  │ simpl │ plann │ simpl │ reado │ reado │ reado │ PLANU │ idle  │ sendM │ wider
   Arbei │       │ e_pla │ ing   │ e_pla │ nly   │ nly   │ nly   │ NG    │ (stal │ essag │ sprüc
   t →   │       │ n     │       │ n     │       │       │       │       │ e)    │ e +   │ hlich
   Schne │       │       │       │       │       │       │       │       │       │ befor │ (Auro
   llpla │       │       │       │       │       │       │       │       │       │ e_age │ ra
   n     │       │       │       │       │       │       │       │       │       │ nt_st │ veral
         │       │       │       │       │       │       │       │       │       │ art   │ tet,
         │       │       │       │       │       │       │       │       │       │       │ Promp
         │       │       │       │       │       │       │       │       │       │       │ t
         │       │       │       │       │       │       │       │       │       │       │ doppe
         │       │       │       │       │       │       │       │       │       │       │ lt)
   4.    │ idle  │ detai │ plann │ detai │ reado │ reado │ reado │ PLANU │ idle  │ sendM │ wider
   Arbei │       │ led_p │ ing   │ led_p │ nly   │ nly   │ nly   │ NG    │ (stal │ essag │ sprüc
   t →   │       │ lan   │       │ lan   │       │       │       │       │ e)    │ e +   │ hlich
   Archi │       │       │       │       │       │       │       │       │       │ befor │ (Auro
   tektu │       │       │       │       │       │       │       │       │       │ e_age │ ra
   rplan │       │       │       │       │       │       │       │       │       │ nt_st │ veral
         │       │       │       │       │       │       │       │       │       │ art   │ tet,
         │       │       │       │       │       │       │       │       │       │       │ Promp
         │       │       │       │       │       │       │       │       │       │       │ t
         │       │       │       │       │       │       │       │       │       │       │ doppe
         │       │       │       │       │       │       │       │       │       │       │ lt)
   5.    │ plann │ work  │ plann │ work  │ proje │ reado │ reado │ PLAN  │ idle  │ None  │ wider
   Schne │ ing   │ (Fehl │ ing   │ (Fehl │ ct-   │ nly / │ nly / │ BEREI │ (stal │       │ sprüc
   llpla │       │ er)   │       │ er)   │ write │ proje │ proje │ T     │ e)    │       │ hlich
   n →   │       │       │       │       │       │ ct-   │ ct-   │       │       │       │ (work
   ferti │       │       │       │       │       │ write │ write │       │       │       │ flowM
   ger   │       │       │       │       │       │       │       │       │       │       │ ode
   Plan  │       │       │       │       │       │       │       │       │       │       │ zu
         │       │       │       │       │       │       │       │       │       │       │ früh
         │       │       │       │       │       │       │       │       │       │       │ work)
   6.    │ plann │ work  │ plann │ work  │ proje │ reado │ reado │ PLAN  │ idle  │ None  │ wider
   Archi │ ing   │ (Fehl │ ing   │ (Fehl │ ct-   │ nly / │ nly / │ BEREI │ (stal │       │ sprüc
   tektu │       │ er)   │       │ er)   │ write │ proje │ proje │ T     │ e)    │       │ hlich
   rplan │       │       │       │       │       │ ct-   │ ct-   │       │       │       │ (work
   →     │       │       │       │       │       │ write │ write │       │       │       │ flowM
   ferti │       │       │       │       │       │       │       │       │       │       │ ode
   ger   │       │       │       │       │       │       │       │       │       │       │ zu
   Plan  │       │       │       │       │       │       │       │       │       │       │ früh
         │       │       │       │       │       │       │       │       │       │       │ work)
   7.    │ plann │ simpl │ revie │ plan  │ reado │ reado │ reado │ PLAN- │ idle  │ sendM │ wider
   ferti │ ing   │ e_pla │ wing  │ type  │ nly   │ nly   │ nly   │ REVIE │ (stal │ essag │ sprüc
   ger   │       │ n /   │       │       │       │       │       │ W     │ e)    │ e +   │ hlich
   Plan  │       │ detai │       │       │       │       │       │       │       │ befor │ (Auro
   →     │       │ led_p │       │       │       │       │       │       │       │ e_age │ ra
   Revie │       │ lan   │       │       │       │       │       │       │       │ nt_st │ veral
   w     │       │       │       │       │       │       │       │       │       │ art   │ tet,
         │       │       │       │       │       │       │       │       │       │       │ Promp
         │       │       │       │       │       │       │       │       │       │       │ t
         │       │       │       │       │       │       │       │       │       │       │ doppe
         │       │       │       │       │       │       │       │       │       │       │ lt)
   8.    │ plann │ work  │ plann │ work  │ proje │ reado │ reado │ PLAN  │ idle  │ None  │ wider
   Revie │ ing   │ (Fehl │ ing   │ (Fehl │ ct-   │ nly / │ nly / │ BEREI │ (stal │       │ sprüc
   w →   │       │ er)   │       │ er)   │ write │ proje │ proje │ T     │ e)    │       │ hlich
   ferti │       │       │       │       │       │ ct-   │ ct-   │       │       │       │ (work
   ger   │       │       │       │       │       │ write │ write │       │       │       │ flowM
   revid │       │       │       │       │       │       │       │       │       │       │ ode
   ierte │       │       │       │       │       │       │       │       │       │       │ zu
   r     │       │       │       │       │       │       │       │       │       │       │ früh
   Plan  │       │       │       │       │       │       │       │       │       │       │ work)
   9.    │ worki │ work  │ worki │ work  │ proje │ proje │ proje │ ARBEI │ idle  │ sendM │ wider
   ferti │ ng    │       │ ng    │       │ ct-   │ ct-   │ ct-   │ T     │ (stal │ essag │ sprüc
   ger   │       │       │       │       │ write │ write │ write │       │ e)    │ e AND │ hlich
   Plan  │       │       │       │       │       │       │       │       │       │ befor │ (Dopp
   →     │       │       │       │       │       │       │       │       │       │ e_age │ elte
   /work │       │       │       │       │       │       │       │       │       │ nt_st │ Injek
         │       │       │       │       │       │       │       │       │       │ art   │ tion)
   10.   │ pause │ work  │ pause │ work  │ proje │ proje │ proje │ PAUSI │ idle  │ None  │ wider
   Worki │ d     │       │ d     │       │ ct-   │ ct-   │ ct-   │ ERT   │ (stal │       │ sprüc
   ng →  │       │       │       │       │ write │ write │ write │       │ e)    │       │ hlich
   Pause │       │       │       │       │       │       │       │       │       │       │ (Auro
   d     │       │       │       │       │       │       │       │       │       │       │ ra
         │       │       │       │       │       │       │       │       │       │       │ ignor
         │       │       │       │       │       │       │       │       │       │       │ iert)
   11.   │ worki │ work  │ worki │ work  │ proje │ proje │ proje │ ARBEI │ idle  │ sendM │ wider
   Pause │ ng    │       │ ng    │       │ ct-   │ ct-   │ ct-   │ T     │ (stal │ essag │ sprüc
   d →   │       │       │       │       │ write │ write │ write │       │ e)    │ e AND │ hlich
   /work │       │       │       │       │       │       │       │       │       │ befor │ (Dopp
         │       │       │       │       │       │       │       │       │       │ e_age │ elte
         │       │       │       │       │       │       │       │       │       │ nt_st │ Injek
         │       │       │       │       │       │       │       │       │       │ art   │ tion)
   12.   │ block │ work  │ block │ work  │ proje │ proje │ proje │ BLOCK │ idle  │ None  │ wider
   Worki │ ed    │       │ ed    │       │ ct-   │ ct-   │ ct-   │ IERT  │ (stal │       │ sprüc
   ng →  │       │       │       │       │ write │ write │ write │       │ e)    │       │ hlich
   Block │       │       │       │       │       │       │       │       │       │       │ (Auro
   ed    │       │       │       │       │       │       │       │       │       │       │ ra
         │       │       │       │       │       │       │       │       │       │       │ ignor
         │       │       │       │       │       │       │       │       │       │       │ iert)
   13.   │ worki │ work  │ worki │ work  │ proje │ proje │ proje │ ARBEI │ idle  │ sendM │ wider
   Block │ ng    │       │ ng    │       │ ct-   │ ct-   │ ct-   │ T     │ (stal │ essag │ sprüc
   ed →  │       │       │       │       │ write │ write │ write │       │ e)    │ e AND │ hlich
   /work │       │       │       │       │       │       │       │       │       │ befor │ (Dopp
         │       │       │       │       │       │       │       │       │       │ e_age │ elte
         │       │       │       │       │       │       │       │       │       │ nt_st │ Injek
         │       │       │       │       │       │       │       │       │       │ art   │ tion)
   14.   │ revie │ work  │ revie │ work  │ proje │ proje │ proje │ COMPL │ idle  │ None  │ wider
   Worki │ wing  │       │ wing  │       │ ct-   │ ct-   │ ct-   │ ETION │ (stal │       │ sprüc
   ng →  │       │       │       │       │ write │ write │ write │       │ e)    │       │ hlich
   Revie │       │       │       │       │       │       │       │       │       │       │ (Auro
   wing  │       │       │       │       │       │       │       │       │       │       │ ra
         │       │       │       │       │       │       │       │       │       │       │ ignor
         │       │       │       │       │       │       │       │       │       │       │ iert)
   15.   │ done  │ work  │ done  │ work  │ proje │ proje │ proje │ None  │ idle  │ None  │ konsi
   Revie │ /     │       │ /     │       │ ct-   │ ct-   │ ct-   │       │ (stal │       │ stent
   wing  │ missi │       │ idle  │       │ write │ write │ write │       │ e)    │       │
   →     │ ng    │       │       │       │       │       │       │       │       │       │
   Done/ │       │       │       │       │       │       │       │       │       │       │
   Archi │       │       │       │       │       │       │       │       │       │       │
   v     │       │       │       │       │       │       │       │       │       │       │
   16.   │ missi │ work  │ idle  │ work  │ proje │ reado │ reado │ None  │ idle  │ None  │ wider
   Plann │ ng    │       │       │       │ ct-   │ nly   │ nly   │       │ (stal │       │ sprüc
   ing → │       │       │       │       │ write │ (Fehl │ (Fehl │       │ e)    │       │ hlich
   /disc │       │       │       │       │       │ er)   │ er)   │       │       │       │ (read
   ard-  │       │       │       │       │       │       │       │       │       │       │ only
   plan  │       │       │       │       │       │       │       │       │       │       │ bleib
         │       │       │       │       │       │       │       │       │       │       │ t
         │       │       │       │       │       │       │       │       │       │       │ hänge
         │       │       │       │       │       │       │       │       │       │       │ n)
   17.   │ missi │ work  │ idle  │ work  │ proje │ reado │ reado │ None  │ idle  │ None  │ wider
   ferti │ ng    │       │       │       │ ct-   │ nly   │ nly   │       │ (stal │       │ sprüc
   ger   │       │       │       │       │ write │ (if   │ (if   │       │ e)    │       │ hlich
   Plan  │       │       │       │       │       │ set)  │ set)  │       │       │       │ (read
   →     │       │       │       │       │       │       │       │       │       │       │ only
   /disc │       │       │       │       │       │       │       │       │       │       │ bleib
   ard-  │       │       │       │       │       │       │       │       │       │       │ t
   plan  │       │       │       │       │       │       │       │       │       │       │ hänge
         │       │       │       │       │       │       │       │       │       │       │ n)
   18.   │ missi │ work  │ idle  │ work  │ proje │ proje │ proje │ None  │ idle  │ None  │ konsi
   Worki │ ng    │       │       │       │ ct-   │ ct-   │ ct-   │       │ (stal │       │ stent
   ng →  │       │       │       │       │ write │ write │ write │       │ e)    │       │
   /disc │       │       │       │       │       │       │       │       │       │       │
   ard-  │       │       │       │       │       │       │       │       │       │       │
   plan  │       │       │       │       │       │       │       │       │       │       │
   19.   │ idle  │ work  │ idle  │ work  │ proje │ proje │ proje │ DIREC │ idle  │ befor │ konsi
   Direc │       │       │       │       │ ct-   │ ct-   │ ct-   │ T     │ (stal │ e_age │ stent
   t     │       │       │       │       │ write │ write │ write │ TASK  │ e)    │ nt_st │
   Task  │       │       │       │       │       │       │       │       │       │ art   │
   start │       │       │       │       │       │       │       │       │       │       │
   en    │       │       │       │       │       │       │       │       │       │       │
   20.   │ idle  │ work  │ idle  │ work  │ proje │ proje │ proje │ None  │ idle  │ None  │ konsi
   Direc │       │       │       │       │ ct-   │ ct-   │ ct-   │       │ (stal │       │ stent
   t     │       │       │       │       │ write │ write │ write │       │ e)    │       │
   Task  │       │       │       │       │       │       │       │       │       │       │
   absch │       │       │       │       │       │       │       │       │       │       │
   ließe │       │       │       │       │       │       │       │       │       │       │
   n     │       │       │       │       │       │       │       │       │       │       │
   21.   │ plann │ work  │ plann │ work  │ proje │ reado │ reado │ resto │ idle  │ befor │ wider
   Sessi │ ing   │ (if   │ ing   │ (if   │ ct-   │ nly / │ nly / │ red   │ (stal │ e_age │ sprüc
   on-   │       │ not   │       │ not   │ write │ proje │ proje │       │ e)    │ nt_st │ hlich
   Reloa │       │ in    │       │ in    │       │ ct-   │ ct-   │       │       │ art   │ (Mode
   d in  │       │ turn) │       │ turn) │       │ write │ write │       │       │       │ -Mism
   Plan  │       │       │       │       │       │       │       │       │       │       │ atch)
   22.   │ new   │ reset │ reset │ reset │ proje │ resto │ resto │ updat │ reset │ new   │ wider
   Sessi │ state │       │       │       │ ct-   │ red   │ red   │ ed    │       │ conte │ sprüc
   on-   │       │       │       │       │ write │       │       │       │       │ xt    │ hlich
   Wechs │       │       │       │       │       │       │       │       │       │       │ (Manu
   el    │       │       │       │       │       │       │       │       │       │       │ al
         │       │       │       │       │       │       │       │       │       │       │ permi
         │       │       │       │       │       │       │       │       │       │       │ ssion
         │       │       │       │       │       │       │       │       │       │       │ überl
         │       │       │       │       │       │       │       │       │       │       │ ebt)
   23.   │ same  │ same  │ re-   │ same  │ same  │ same  │ same  │ same  │ reset │ same  │ unkla
   Exten │       │       │ bound │       │       │       │       │       │       │       │ r
   sion- │       │       │       │       │       │       │       │       │       │       │ (Patc
   Reloa │       │       │       │       │       │       │       │       │       │       │ h-
   d     │       │       │       │       │       │       │       │       │       │       │ abhän
         │       │       │       │       │       │       │       │       │       │       │ gig)
   24.   │ loade │ work  │ loade │ work  │ proje │ resto │ resto │ updat │ idle  │ injec │ wider
   Pi-   │ d     │       │ d.sta │       │ ct-   │ red   │ red   │ ed    │ (stal │ ted   │ sprüc
   Neust │       │       │ te.st │       │ write │       │       │       │ e)    │ on    │ hlich
   art   │       │       │ atus  │       │       │       │       │       │       │ start │ (Auro
   mit   │       │       │       │       │       │       │       │       │       │       │ ra
   Sidec │       │       │       │       │       │       │       │       │       │       │ veral
   ar    │       │       │       │       │       │       │       │       │       │       │ tet)
  ──────
  ## 5. Plan- und Kontextübergabe

  ### Exakter Nachrichtenaustausch bei /work:

  1. Sichtbare User-Nachricht (über session.pi.sendMessage):
      • CustomType: "pi-work-request"
      • Inhalt: Vollständiger executionPrompt(snapshot, state) inklusive [PI WORKFLOW:
      AUSFÜHRUNG], Regeln, vollständigem Plan-Markdown und allen Schritt-IDs mit Status.
  2. Unsichtbare Kontextinjektion (über before_agent_start-Hook):
      • CustomType: "pi-work-context"
      • Inhalt: Identischer executionPrompt(snapshot, state).


  Ergebnis: Der vollständige Plantext und die Step-IDs kommen im finalen Agenten-Input exakt 2-
  mal vor.
  ──────
  ## 6. Berechtigungsanalyse

  • Default-Stufe: Wird von mode-permissions über setup.json geladen (z. B. work -> project-write,
  simple_plan/detailed_plan -> readonly).
  • Manuelle Auswahl: Kann über /permission <level> gesetzt werden und markiert den Status als
  MANUAL.
  • Effektive Stufe: Ist die aktuell von den Guards durchgesetzte Stufe.
  • Workflow-Beschränkung: Während des Status planning schränken die Guards in guards.ts
  Schreibzugriffe zusätzlich auf .agent/plans/* ein.
  • Sichtbare UI-Anzeige: Wird über setTuiStatus in die TUI-Statuszeile gerendert (z. B. 🛡
  DEFAULT · READONLY).
  • Hauptproblem: Bei /discard-plan erfolgt keine Benachrichtigung an mode-permissions, wodurch
  der effektive Modus readonly aktiv bleibt, obwohl die UI das Workflow-Feld leert.
  ──────
  ## 7. Aurora-Analyse

  • State Owner: extensions/aurora-ui/state.ts hält das zentral gemappte Objekt AuroraUiState.
  • Patch Publisher: mode-permissions und lsp rufen publishAuroraUiPatch /
  publishAuroraUiSnapshot auf.
  • Verhalten von plan-mode: plan-mode besitzt keine Listener für AURORA_UI_CHANNELS.request und
  veröffentlicht keine Patches.
  • Auswirkung: Das Aurora-UI zeigt durchgehend den Initialzustand phase: "idle" / label:
  "ARBEIT".
  ──────
  ## 8. Runtime-Patch-Analyse

  • Vorhandene Patches (geprüft via node scripts/apply-runtime-patches.mjs):
      • OK loader-scoped-events
      • OK loader-unsubscriber-list
      • OK runner-dispose
      • OK session-reload-dispose
      • OK package-manager-order-helper
      • OK package-manager-order-use
  • Fehlende Patches: Keine (alle 6 Patches sind in Node-Modules vorhanden).
  • Folgen bei fehlenden Patches (z. B. nach neuem npm install von Pi ohne Patch-Skript):
      • Kehrseite der Extension-Ladereihenfolge (mode-permissions lädt vor plan-mode).
      • Alte Event-Listener bleiben nach Extension-Reloads aktiv und erzeugen doppelte Antworten.
  • Sicherer manueller Reparaturbefehl (nicht ausgeführt):
    npm run patch:runtime

  ──────
  ## 9. Testlücken

  1. T1 (P1): Fehlender Integrationstest für den Übergang finalizePlanning -> Capability Mode.
  2. T2 (P1): Fehlender Test für Context-Vorkommnisse nach /work (Prüfung auf exakt 1 Prompt-
  Block).
  3. T3 (P1): Fehlender Test für Rechte-Reset nach /discard-plan.
  4. T4 (P2): Fehlende Aurora-UI-State Provider-Tests in plan-mode.
  5. T5 (P2): Fehlender Test für Fortschritts-Reset bei Re-Planning / Planrevision.
  6. T6 (P2): Korrektur der Assertion in tests/workflow-v3/routing.test.mjs.
  ──────
  ## 10. Reparaturplan

  (Kein Code geändert; rein konzeptioneller Ablauf)

  1. Schritt 1: P1-Regressionstests erstellen
      • Dateien: tests/workflow-v3/integration.test.mjs, tests/workflow-v3/permissions.test.mjs
      • Ziel: Testfälle für H1, H2, H4 vorab fehlschlagen lassen.
      • Risiko: Gering.
      • Verifikation: node tests/workflow-v3.mjs
  2. Schritt 2: Kanonische Workflow-Transitionen & Modus-Geber reparieren
      • Dateien: extensions/plan-mode/session.ts, extensions/plan-mode/planning.ts
      • Ziel: workflowMode() an den echten Sidecar-Status binden; publishWorkflowActivation bei
      allen Zustandsänderungen rufen.
      • Risiko: Mittel.
      • Verifikation: Integrationstests für Modus-Wechsel.
  3. Schritt 3: Plan-Handoff auf Exakt-Einmal umstellen
      • Dateien: extensions/plan-mode/events.ts, extensions/plan-mode/execution.ts
      • Ziel: Entfernung der doppelten Injektion in before_agent_start.
      • Risiko: Mittel.
      • Verifikation: Prompt-Inhalts-Analysen im Test-Harness.
  4. Schritt 4: Aurora-Workflow-Provider anbinden
      • Dateien: extensions/plan-mode/presentation.ts, extensions/plan-mode/events.ts
      • Ziel: Veröffentlichung von Aurora-Patches und Snapshots bei allen Statusänderungen.
      • Risiko: Gering.
      • Verifikation: npm run test (UI-Suite).
  5. Schritt 5: Fortschritts-Reset bei Planrevision durchsetzen
      • Dateien: extensions/plan-mode/store/workflow-state-factory.ts
      • Ziel: Invalidation von Schritt-Status bei Re-Planning.
      • Risiko: Gering.
      • Verifikation: planning.test.mjs.

  ──────
    Auditstatus: BESTÄTIGT
    Hauptursache: Entkopplung von In-Memory-Flag (planningKind) und Sidecar-State, fehlende
  Activation-Events bei Discard/Finalize, doppelte Promptinjektion bei /work sowie fehlende
  Aurora-Event-Anbindung.
    Kritischster Befund: Befund 1 (P1 - workflowMode Inconsistenz) & Befund 2 (P1 - Doppelte
  Planinjektion) & Befund 3 (P1 - Hängende readonly-Rechte nach /discard-plan).
    Runtime-Patches: VOLLSTÄNDIG
    Empfohlener nächster Schritt: Reparaturplan in Reihenfolge 1 -> 5 umsetzen (TUI- und Event-
  Übergänge priorisieren).
    Geänderte Dateien: keine