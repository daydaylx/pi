# Pi Agent — Aurora Setup

This repository is the declarative source for a comfort-focused Pi Coding
Agent setup. Plan workflow, permissions, LSP and presentation are separate
runtime modules; only Aurora owns custom TUI chrome.

## Runtime architecture

```text
Pi Core
├── setup-core        effective config, /setup-doctor, allowlisted verify tool
├── plan-mode         Shift+Tab Control Center, workflow, decision/review/work lifecycle
├── mode-permissions  capability and path policy
├── lsp               lazy, trust-gated language servers
├── pi-subagents      exact-pinned orchestration package
└── aurora-ui         editor, footer, activity surface and motion
```

`themes/aurora-night.json` defines the single color system. Aurora uses one
100 ms ticker only while contextual motion is active; `reduced` and `off`
never retain an animation interval. Built-in tools keep Pi's execution and
rendering contracts.

The central `setup.json` is schema-backed. Effective precedence is defaults,
global setup, then trusted `.pi/setup.json`. Project configuration cannot
relax global permissions or replace host verification commands.

## Plan workflow

The existing public UX remains available: Shift+Tab opens the temporary Control
Center; `/plan`, `/decide`, `/review-plan`, `/work`, `/go`, `/done`, `/finish`
and `/plan-todos` retain their existing semantics. The Control Center starts
with Schnellplan, Architekturplan, Work-Modus and Optionen klären, then offers
separate model-role, Thinking, permission and one-file LSP-diagnosis menus.

The Markdown plan remains `.agent/plans/current-plan.md`. Sidecar v2 stores a
stable `planId`, revision, lifecycle, per-todo hash and bound `executionId` in
`.agent/plans/current-plan.state.json`; lock/CAS writes and conservative
migration protect concurrent or older state. During `/work`, the model records
progress through `plan_progress(executionId, step, status, evidence)`; legacy progress
markers and `/done` remain compatible fallbacks. A saved execution is always
restored as `paused` and `/work` requires an explicit resume. Decision briefs
are injected only when their stored hash is linked to the current plan.

Planning, review, decision, execution, paused, blocked and ready are enforced
capability phases, not prompt-only conventions. Each phase exposes only its
required read, question, verification or progress surface; execution progress
is additionally bound to the active plan and execution identity.

## Install and verify

Use Node `22.22.2` and npm `10.9.7`.

```bash
npm ci --prefix npm
npm run verify
npm run install:user -- --dry-run --target ~/.pi/agent
npm run install:user -- --apply --target ~/.pi/agent
```

The installer copies only an explicit setup allowlist, including the npm
manifests, TypeScript config and test harness required by `verify`. It never
copies authentication, sessions, caches, backups, `.git`, symlinks or
installed dependencies. When this checkout already is `~/.pi/agent`,
installation is a no-op.

For an external empty target, run `npm ci --prefix ~/.pi/agent/npm` there
after installation before using `verify`. Dependency installation is
deliberately separate and requires the user's approval; the installer never
downloads packages on its own.

Run `/setup-doctor` after a Pi upgrade or configuration change. It reports
effective configuration, trust, model roles, LSP mode, active extension count
and manifest/install version drift without reading credentials.

## Safety and updates

- Unknown tools always require confirmation in Read+Write, Full and YOLO, and
  are blocked in stricter levels; Setup remains an absolute block. Workflow
  phase limits apply independently and cannot be relaxed by a permission level.
- `verify` accepts only `typecheck`, `test` or `verify`; it cannot execute free
  shell input and always runs this setup's fixed checks from the agent
  directory. Project test scripts still go through the normal Bash policy.
- LSP servers are never installed automatically and start only on first use.
- Only the Worker subagent has raw Bash/write tools. Review agents are
  technically read-only; the Test Runner receives only the allowlisted
  `verify` tool.
- Packages remain exact-pinned. Do not update dependencies, commit or publish
  branches without explicit approval.

The former Zentui/tool-display files remain in the repository for comparison,
but are not active runtime owners. Rolling back means restoring the previous
`settings.json` package and extension allowlists; authentication and session
state are unaffected.
