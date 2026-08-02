# Performance-Werkzeuge

`performance_measure` misst **ob** ein konfigurierter Kandidat schneller ist.
`performance_profile` verdichtet **warum** ein Profil auffällig ist.
Beide Werkzeuge sind rein beratend: Sie ändern keinen Workflowmodus, starten
keine Installation und ersetzen keine Korrektheitsprüfung.

Die Dateien werden ausschließlich in einem vertrauten Projekt geladen.
Kommandos bestehen stets aus `program` und `args`; Shell-Zeichenketten sind
nicht zulässig. Der Median ist der primäre Wert, nicht der beste Einzellauf.

## Messung

Lege `.pi/performance.json` an:

```json
{
  "profiles": {
    "startup": {
      "program": "node",
      "args": ["bench/startup.mjs", "--json"],
      "warmups": 2,
      "runs": 7,
      "metricSource": "json",
      "metric": "duration_ms",
      "direction": "lower_is_better"
    },
    "throughput": {
      "program": "node",
      "args": ["bench/throughput.mjs"],
      "warmups": 2,
      "runs": 7,
      "metricSource": "process_duration_ms",
      "direction": "lower_is_better"
    }
  }
}
```

Danach `performance_measure` mit der Profil-ID aufrufen. Das Ergebnis enthält
Rohwerte, Median, Mittelwert, Min/Max, Streuung, Profil- und Diff-Fingerprint.
`performance_compare` akzeptiert nur zwei in derselben Sitzung aufgezeichnete
Messungen mit identischen Fingerprints. Hohe Streuung oder unvollständige
Serien bleiben sichtbar und werden nicht als belastbarer Gewinn dargestellt.

`performance_state` hält Baseline, Versuche und den besten technisch gültigen
Kandidaten nur für die aktuelle Sitzung. Es speichert weder Logs noch Prompts,
ändert keine Dateien und führt niemals einen Git-Rollback aus.

## Profiling

`.pi/profiling.json` hat eine getrennte, kleine Adapterliste:

```json
{
  "profiles": {
    "cpu": {
      "adapter": "node-cpu",
      "program": "node",
      "args": ["bench/workload.mjs"],
      "maxFindings": 10
    },
    "vectorization": {
      "adapter": "compiler-diagnostics",
      "program": "clang++",
      "args": ["-O3", "-Rpass=loop-vectorize", "src/kernel.cc", "-c"]
    }
  }
}
```

`node-cpu` liest nur die wichtigsten V8-Samples. `compiler-diagnostics` fasst
Compiler-`remark`-, `note`- und `warning`-Zeilen zusammen. Rohe CPU-Profile
liegen nur temporär außerhalb des Projekts und gelangen nicht in den Kontext.
Fehlende Binaries, Plattform- oder Berechtigungsgrenzen sind eindeutige
Ergebnisse; es gibt weder `sudo` noch einen stillen Adapter-Fallback.
