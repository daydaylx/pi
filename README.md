# Minimal Stable Pi Setup

This repository contains a reproducible Pi Coding Agent setup with one global
presentation layer and local extensions limited to behavior and security.

## Architecture

```text
Pi Core
├── catppuccin-mocha
├── pi-zentui                 # global editor, footer, user-message chrome
├── pi-tool-display           # read/grep/find/ls/bash/edit/write renderer
├── pi-subagents              # subagent orchestration package
└── local extensions          # permissions, workflow, activity line, ask-user
```

Zentui owns the global editor and footer.  
pi-tool-display owns the configured built-in tool renderers.  
Local extensions own behavior and security, not global presentation.

Zentui renders the single footer in this order: current directory, workflow,
active model, thinking level. Normal permissions stay out of it; only elevated
`FULL ACCESS` or `YOLO` appear as a trailing warning. Git, token, cost,
runtime, time, and subagent state have no permanent footer segment.

`activity-status.ts` owns at most one muted activity line above the editor. It
uses lifecycle state only, never model reasoning text. `pi-tool-display` owns
the one-line tool timeline; successful calls are compact, while errors and
manually expanded calls show details. `pi-subagents` keeps lifecycle tracking
but its persistent async widget is disabled.

## Theme

`catppuccin-mocha` is the single, exact-pinned visual theme. Zentui and all
temporary local dialogs use its semantic theme tokens; this repository carries
no local color palette or icon set. Because every built-in project-data footer
segment is hidden, Zentui's periodic project refresh is disabled. If a future
configuration enables CWD, Git, or runtime footer data, it must also choose a
positive refresh interval deliberately.

## Native skills

Pi discovers the native skills in this agent directory from
`skills/<name>/SKILL.md`; in this checkout that is Pi's global
`~/.pi/agent/skills/` location. Invoke one with `/skill:<name> [arguments]`.
Skills are not loaded through a local
extension and are deliberately not a Shift+Tab workflow-menu entry. Their
instructions remain subject to the active workflow and permission policy.

## Install and verify

Use Node `22.22.2` and npm `10.9.7`.

```bash
npm --prefix npm ci
npm --prefix npm run verify
```

Run Pi from this agent directory after the package install. The checked-in
`settings.json`, `zentui.json`, and
`extensions/pi-tool-display/config.json` are the runtime configuration.

## Updates and rollback

The three UI runtime packages in `settings.json` are pinned to immutable
commits in the `daydaylx` forks. Update one only by committing the reviewed
fork change, replacing its full commit ID in `settings.json`, and running the
complete verification command. The exact npm pins remain for the local test
harness. Do not use version ranges or `latest`.

The pre-rebuild state is tagged `backup/pre-minimal-rebuild`. The inherited
worktree state is also retained in a named local Git stash until this rebuild
is accepted. Roll back a milestone by reverting its focused commit; do not
force-push or reset `main`.

See [the runtime matrix](docs/runtime-matrix.md) for pinned versions and
manual terminal coverage.
