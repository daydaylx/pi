# ANALYSIS — P6-TERRA-SUBAGENTS

**Status: abgeschlossen (n=3 je Zelle, 2 Aufgaben).** Wie bei P5 gilt: kleine Stichprobe, Formulierungen als "X von Y Läufen", keine Prozentaussagen.

## Hauptbefund: Erfolgsquote 6/6 zu 6/6 — vollständige Parität

Beide Seiten lösten alle 12 Piloten-Läufe korrekt. Kein einziger Fehlschlag auf beiden Seiten, bei beiden Aufgaben.

## Der wichtigste Unterschied zu P5-LUNA-HARNESS: die Rückfrage-Ergänzung wirkt

In P5 (gleiche Aufgabe 05, Modell Luna statt Terra, kein Subagenten-Zugriff, **kein** Anti-Rückfrage-Hinweis im Prompt) löste Pi nur 1 von 3 Wiederholungen — die anderen 2 endeten mit einer unbeantwortbaren Rückfrage. In P6 (gleiche Aufgabe 05, mit der identischen Prompt-Ergänzung auf beiden Seiten) löste Pi 3 von 3.

**Wichtige Einschränkung, bevor man das als "Ergänzung behebt das Problem" liest:** Diese Serie ändert **gleichzeitig drei Dinge** gegenüber P5 (Modell Luna→Terra, Subagenten gesperrt→erlaubt, kein Hinweis→Hinweis vorhanden) — nicht nur die Prompt-Ergänzung isoliert. Ein sauberer Beleg, dass _speziell_ die Ergänzung (und nicht z. B. ein Terra-spezifisches Verhalten) die Ursache ist, würde einen weiteren, isolierten A/B-Lauf erfordern (gleiches Modell, gleiche Subagentenregel, nur mit/ohne Ergänzung). Die Beobachtung ist real und die Ergänzung ist der plausibelste Erklärungsfaktor (sie adressiert exakt den in P5 protokollierten Mechanismus wörtlich), aber formal nicht isoliert bewiesen.

## Subagenten-Nutzung: 0 in beiden Aufgaben

Obwohl in P6 explizit erlaubt (Investigator/Debugger/Verifier bei Pi, natives Multi-Agent-Feature bei Codex), wurde in keinem der 12 Läufe delegiert. Beide Piloten-Aufgaben (05, 02) sind für Pis Delegationskriterien (siehe AGENTS.md) offenbar zu einfach/risikoarm. **Diese Serie kann damit keine Aussage über den Nutzen von Investigator/Debugger/Verifier liefern** — dafür wären Aufgaben nötig, die tatsächlich Komplexität/Risiko genug haben, um Delegation auszulösen (z. B. eher in Richtung Aufgabe 08, wäre deren Prompt nicht defekt, oder eine neue, bewusst komplexere Aufgabe).

## Effizienz: gleiches Muster wie P5

Codex bleibt bei ~10× mehr Input-Tokens (Median 320K vs. 30K) und kürzerer Laufzeit (Median 166s vs. 224s) mit weniger Modellaufrufen (4,0 vs. 10,5) — praktisch identisches Verhältnis wie in P5-LUNA-HARNESS, nur mit Terra statt Luna. Das deutet darauf hin, dass dieses Muster eher eine **Harness-Eigenschaft** (Codex' Kontextaufbereitung pro Turn) als eine **Modell-Eigenschaft** ist — bei zwei verschiedenen Modellen (Luna, Terra) bleibt der Effekt in ähnlicher Größenordnung bestehen.

## Fazit

**Für die 2 getesteten Aufgaben: praktisch gleichwertig** (6/6 zu 6/6), mit demselben Effizienz-Kompromiss wie in P5 (Pi tokeneffizienter, Codex schneller/weniger Modellaufrufe). Die auffälligste Verbesserung gegenüber P5 ist nicht "Codex besser als Pi" oder umgekehrt, sondern dass **die Prompt-Ergänzung gegen unbeantwortbare Rückfragen den in P5 gefundenen Pi-Schwachpunkt vollständig behoben zu haben scheint** — ein methodischer, kein Modell- oder Harness-Befund. Keine Aussage zu Subagenten-/Verifier-Nutzen möglich, da nie ausgelöst.
