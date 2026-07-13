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
└── local extensions          # permissions, workflow, skills, ask-user
```

Zentui owns the global editor and footer.  
pi-tool-display owns the configured built-in tool renderers.  
Local extensions own behavior and security, not global presentation.

`workflow`, `permissions`, and `plan` are the only local status keys published
to Zentui. No local extension may install a footer, editor, header, permanent
widget, or sidebar.

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

Update a package only by changing its exact version in both `settings.json`
and `npm/package.json`, regenerating `npm/package-lock.json`, and running the
complete verification command. Do not use version ranges or `latest`.

The pre-rebuild state is tagged `backup/pre-minimal-rebuild`. The inherited
worktree state is also retained in a named local Git stash until this rebuild
is accepted. Roll back a milestone by reverting its focused commit; do not
force-push or reset `main`.

See [the runtime matrix](docs/runtime-matrix.md) for pinned versions and
manual terminal coverage.
