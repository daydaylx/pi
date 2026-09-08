# Stufe-2 Zwischenbericht: Task A + Task B (24/36 Kandidatenläufe)

Stand 2026-09-09. Task A (real-03-lsp-ruby-profile, Klasse A/klein) und
Task B (real-04-session-health-provider-filter, Klasse B/mittel) sind
vollständig durchgelaufen (je 3 Trials × 2 Workflows × 2 Kandidaten = 12
Läufe, zusammen 24). **Task C (real-05-lsp-rename-tool, Klasse C/komplex)
steht noch aus** — dieser Bericht deckt daher zwei von drei
Komplexitätsklassen ab, keine Gesamtauswertung.

Alle 24 Läufe: `comparable=true`, `baseline_status=clean`, keine Gate-Fehler
außer den unten genannten Checker-Ergebnissen.

## Funktionale Checker-Ergebnisse (mechanisch, aus `results.jsonl`)

| Task        | Kandidat   | Workflow  | Trial 1                 | Trial 2 | Trial 3 |
| ----------- | ---------- | --------- | ----------------------- | ------- | ------- |
| A (real-03) | codex-real | work-only | ✅                      | ✅      | ✅      |
| A (real-03) | codex-real | plan-work | ✅                      | ✅      | ✅      |
| A (real-03) | pi-real    | work-only | ❌ (docs/lsp.md fehlte) | ✅      | ✅      |
| A (real-03) | pi-real    | plan-work | ✅                      | ✅      | ✅      |
| B (real-04) | codex-real | work-only | ✅                      | ✅      | ✅      |
| B (real-04) | codex-real | plan-work | ✅                      | ✅      | ✅      |
| B (real-04) | pi-real    | work-only | ✅                      | ✅      | ✅      |
| B (real-04) | pi-real    | plan-work | ✅                      | ✅      | ✅      |

23/24 Checker-Läufe bestanden. Der einzige Fehlschlag (Pi, Task A,
Work-only, Trial 1) wurde am realen Worktree verifiziert: `server-profiles.ts`
war korrekt implementiert, `docs/lsp.md` wurde schlicht vergessen — ein
echter, kein durch den Checker fehlerhaft erkannter Fall. Bemerkenswert:
in allen drei Plan→Work-Läufen von Task A hat Pi die Doku-Aktualisierung
nicht vergessen — bei n=3 kein belastbarer Beleg, aber ein Muster, das zur
Kernfrage des Benchmarks passt.

## Quantitative Kennzahlen (n=3 pro Zelle, Mean/Median/Min–Max)

Vollständige Tabellen: siehe unten (per `report_plan_work.py --all-tasks`
reproduzierbar erzeugt, nicht manuell gepflegt).

**Task A (klein) — Laufzeit-Muster:** Codex ist bei Plan→Work langsamer als
Work-only (Median 384s vs. 346s) — erwartbar durch die zusätzliche
Planphase. Bei Pi zeigt sich das Gegenteil: Plan→Work (Median 569s) ist
schneller als Work-only (Median 764s), getrieben von einem Ausreißer in
Work-only Trial 3 (2420s, ein einzelner sehr langer Lauf). Bei n=3 kein
konsistentes Muster — starke Varianz.

**Task B (mittel) — Laufzeit-Muster:** Ähnliches Bild bei Codex (Plan→Work
minimal langsamer im Median, aber ein Work-only-Ausreißer bei 2780s zieht
den Mittelwert stark nach oben). Bei Pi ist Plan→Work durchgehend langsamer
(Median 1760s vs. 779s) — hier zeichnet sich ein konsistenteres Muster ab
als bei Task A, aber ebenfalls bei nur n=3 nicht als signifikant zu werten.

**Tokens:** Plan→Work verbraucht bei beiden Tasks und beiden Kandidaten
durchgehend mehr Fresh Input und Cache Read als Work-only — erwartbar durch
die zusätzliche Planphase, konsistent über beide Klassen.

**Toolfehler:** Keine auffällige Differenz zwischen den Workflows bei
beiden Tasks; die Werte liegen alle im niedrigen einstelligen Bereich pro
Lauf.

## Was noch fehlt

- **Task C (komplex/riskant)** — die Klasse, in der der Arbeitsauftrag den
  größten Unterschied zwischen Work-only und Plan→Work erwartet, steht noch
  komplett aus.
- **Blind-Review** — Anforderungserfüllung, Regressionen, Architekturqualität
  und Nutzerkorrekturen sind laut Arbeitsauftrag keine mechanischen
  Kriterien; die Checker-PASS/FAIL-Ergebnisse oben sind kein Ersatz dafür,
  nur ein erster grober Filter.
- Keine Aussage zu „konsistentes Muster" vs. „gemischtes Ergebnis" über die
  volle Matrix, solange Task C fehlt.

## Volle mechanische Tabellen

```

```
# Work-only vs. Plan→Work: real-03-lsp-ruby-profile

### codex-real

| Kennzahl | Work-only | Plan→Work | Differenz |
| --- | ---: | ---: | ---: |
| Funktional erfolgreich | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Regressionen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Anforderungserfüllung | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Laufzeit (s) | 310.743 (n=3, Median 345.735, 147.296–439.197) | 387.1 (n=3, Median 383.132, 380.966–397.203) | 76.357 |
| Fresh Input | 73833.333 (n=3, Median 75946, 50692–94862) | 116000.667 (n=3, Median 110200, 86217–151585) | 42167.334 |
| Cache Read | 1132885.333 (n=3, Median 990208, 577536–1830912) | 1899690.667 (n=3, Median 1911040, 1707520–2080512) | 766805.334 |
| Cache Write | 0 (n=3, Median 0, 0–0) | 0 (n=3, Median 0, 0–0) | 0 |
| Output | 7649.667 (n=3, Median 8508, 4903–9538) | 11261.333 (n=3, Median 10632, 9801–13351) | 3611.666 |
| Verarbeitete Tokens (Summe obiger Werte) | 1214368.333 (n=3, Median 1093578, 633131–1916396) | 2026952.667 (n=3, Median 2034591, 1804369–2241898) | 812584.334 |
| Toolfehler (gesamt) | 1.667 (n=3, Median 1, 0–4) | 0.333 (n=3, Median 0, 0–1) | -1.334 |
| Toolfehler Planphase | – | 0 (n=3, Median 0, 0–0) | – |
| Toolfehler Workphase | – | 0.333 (n=3, Median 0, 0–1) | – |
| Nutzerkorrekturen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Planqualität | – | – | – |
| Ungeplante Änderungen | – | keine | – |
| Streuung/Muster (n>1, qualitativ) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |

### pi-real

| Kennzahl | Work-only | Plan→Work | Differenz |
| --- | ---: | ---: | ---: |
| Funktional erfolgreich | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Regressionen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Anforderungserfüllung | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Laufzeit (s) | 1100.02 (n=3, Median 764.378, 115.648–2420.033) | 760.593 (n=3, Median 569.43, 541.055–1171.295) | -339.427 |
| Fresh Input | 57772.667 (n=3, Median 67263, 31584–74471) | 91801.667 (n=3, Median 94513, 81181–99711) | 34029.0 |
| Cache Read | 398336 (n=3, Median 457728, 14848–722432) | 758272 (n=3, Median 665088, 530432–1079296) | 359936 |
| Cache Write | 0 (n=3, Median 0, 0–0) | 0 (n=3, Median 0, 0–0) | 0 |
| Output | 7119 (n=3, Median 9081, 1290–10986) | 8676 (n=3, Median 8363, 8320–9345) | 1557 |
| Verarbeitete Tokens (Summe obiger Werte) | 463227.667 (n=3, Median 534072, 47722–807889) | 858749.667 (n=3, Median 754632, 633265–1188352) | 395522.0 |
| Toolfehler (gesamt) | 1.667 (n=3, Median 2, 1–2) | 3.667 (n=3, Median 3, 3–5) | 2.0 |
| Toolfehler Planphase | – | 2 (n=3, Median 2, 1–3) | – |
| Toolfehler Workphase | – | 1.667 (n=3, Median 2, 1–2) | – |
| Nutzerkorrekturen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Planqualität | – | 3/3 bestanden | – |
| Ungeplante Änderungen | – | keine | – |
| Streuung/Muster (n>1, qualitativ) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |

Hinweis: 'Funktional erfolgreich', 'Regressionen', 'Anforderungserfüllung' und 'Nutzerkorrekturen' sind laut Arbeitsauftrag keine mechanischen Kriterien und muessen durch Blind-Review/menschliches Urteil ausgefuellt werden.

# Work-only vs. Plan→Work: real-04-session-health-provider-filter

### codex-real

| Kennzahl | Work-only | Plan→Work | Differenz |
| --- | ---: | ---: | ---: |
| Funktional erfolgreich | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Regressionen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Anforderungserfüllung | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Laufzeit (s) | 1309.324 (n=3, Median 581.781, 566.439–2779.751) | 830.184 (n=3, Median 866.397, 507.732–1116.424) | -479.14 |
| Fresh Input | 104535.667 (n=3, Median 110650, 90502–112455) | 121265 (n=3, Median 129576, 97208–137011) | 16729.333 |
| Cache Read | 2669141.333 (n=3, Median 2850560, 2087168–3069696) | 3833770.667 (n=3, Median 3342592, 3031040–5127680) | 1164629.334 |
| Cache Write | 0 (n=3, Median 0, 0–0) | 0 (n=3, Median 0, 0–0) | 0 |
| Output | 16385.667 (n=3, Median 17597, 13800–17760) | 16480.667 (n=3, Median 15970, 15151–18321) | 95.0 |
| Verarbeitete Tokens (Summe obiger Werte) | 2790062.667 (n=3, Median 2978970, 2195267–3195951) | 3971516.333 (n=3, Median 3497924, 3175767–5240858) | 1181453.666 |
| Toolfehler (gesamt) | 1.667 (n=3, Median 2, 1–2) | 0.667 (n=3, Median 1, 0–1) | -1.0 |
| Toolfehler Planphase | – | 0 (n=3, Median 0, 0–0) | – |
| Toolfehler Workphase | – | 0.667 (n=3, Median 1, 0–1) | – |
| Nutzerkorrekturen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Planqualität | – | – | – |
| Ungeplante Änderungen | – | keine | – |
| Streuung/Muster (n>1, qualitativ) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |

### pi-real

| Kennzahl | Work-only | Plan→Work | Differenz |
| --- | ---: | ---: | ---: |
| Funktional erfolgreich | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Regressionen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Anforderungserfüllung | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Laufzeit (s) | 831.664 (n=3, Median 778.781, 421.316–1294.894) | 1800.96 (n=3, Median 1759.675, 1472.88–2170.324) | 969.296 |
| Fresh Input | 69819.667 (n=3, Median 70529, 57777–81153) | 113917 (n=3, Median 117852, 99294–124605) | 44097.333 |
| Cache Read | 767488 (n=3, Median 788480, 525824–988160) | 1213440 (n=3, Median 1185280, 892416–1562624) | 445952 |
| Cache Write | 0 (n=3, Median 0, 0–0) | 0 (n=3, Median 0, 0–0) | 0 |
| Output | 12356 (n=3, Median 10841, 10679–15548) | 18650.333 (n=3, Median 21029, 12176–22746) | 6294.333 |
| Verarbeitete Tokens (Summe obiger Werte) | 849663.667 (n=3, Median 869688, 594442–1084861) | 1346007.333 (n=3, Median 1324161, 1003886–1709975) | 496343.666 |
| Toolfehler (gesamt) | 3 (n=3, Median 3, 2–4) | 4 (n=3, Median 4, 3–5) | 1 |
| Toolfehler Planphase | – | 2.667 (n=3, Median 3, 2–3) | – |
| Toolfehler Workphase | – | 1.333 (n=3, Median 1, 1–2) | – |
| Nutzerkorrekturen | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |
| Planqualität | – | 3/3 bestanden | – |
| Ungeplante Änderungen | – | keine | – |
| Streuung/Muster (n>1, qualitativ) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) | TODO (manuell/Blind-Review) |

Hinweis: 'Funktional erfolgreich', 'Regressionen', 'Anforderungserfüllung' und 'Nutzerkorrekturen' sind laut Arbeitsauftrag keine mechanischen Kriterien und muessen durch Blind-Review/menschliches Urteil ausgefuellt werden.

# Gesamtuebersicht nach Komplexitaetsklasse

Klassen werden getrennt ausgewiesen, nicht gemeinsam gemittelt -- siehe Einzeltabellen oben fuer Zahlen je Task/Harness/Workflow.
- Klasse A: real-03-lsp-ruby-profile
- Klasse B: real-04-session-health-provider-filter
```
