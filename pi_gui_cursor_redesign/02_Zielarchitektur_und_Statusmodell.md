# 02 – Zielarchitektur und Statusmodell

## Zielhierarchie

```text
Project
└── Task
    ├── Prompt / User Intent
    ├── Workflow
    ├── Activity
    ├── Agent Activity
    ├── Changes
    ├── Verification
    ├── Review
    └── Result
```

## Primäre UI-Struktur

```text
┌──────────────────────────────────────────────────────────────┐
│ Header                                                       │
├────────────────┬─────────────────────────────────────────────┤
│ Task Sidebar   │ Task Workspace                              │
│                │                                             │
│                │ Activity Stream                             │
│                │                                             │
│                │ Composer                                    │
└────────────────┴─────────────────────────────────────────────┘
```

Sekundär:

- Context Drawer
- Changes Review
- Verification Details
- Agent Details

## Task-Statusmodell

Empfohlene Zustände:

```text
new
planning
working
needs_input
verifying
ready_for_review
completed
failed
stopped
```

## Normaler Pfad

```text
new
→ planning
→ working
→ verifying
→ ready_for_review
→ completed
```

## Alternative Pfade

```text
working → needs_input → working
verifying → failed → working
working → stopped
```

## UI-Gruppierung in Sidebar

- ACTIVE
- NEEDS INPUT
- REVIEW
- COMPLETED

Interne Detailzustände müssen nicht alle als eigene Sidebar-Sektion sichtbar sein.
