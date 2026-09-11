# Phase 2 Implementation Plan (F-04 to F-10)

## F-04: Verifier-Retry nach urteilsloser Ausgabe
**Status**: Mostly implemented, verify edge cases
- `hasEvaluableVerifierResult` correctly returns false for "completed" without verdict
- `assessVerifierDedup` allows retry when no evaluable result
- `assessVerifierCoverageForDiff` blocks commit when no evaluable result
- **Gap**: Need to ensure "no-verdict" run doesn't silently overwrite a valid PASS in `lastVerifierRun`

## F-05: GUI/RPC erhält Verifikationsstatus nicht
**Status**: Partial - frontend only gets status on request, not on change
- `publishAuroraVerification` only called in `agent_settled` and on frontend request
- After `project_check` updates ledger, frontend not notified
- **Fix**: Call `publishAuroraVerification` after ledger updates in `project_check` tool

## F-06: project-write/Interpreter bewusst entscheiden
**Status**: Open - decision needed
- `opaqueInterpreter()` blocks in `yolo` but not in `project-write`
- Need to decide: strict (block in project-write), targeted (ask for inline/stdin), or document current behavior
- **Decision**: Implement targeted approach - ask for inline/stdin/external scripts in project-write

## F-07: Protocol + Frontend-Server in kanonisches Verify
**Status**: Already in verify via `test:frontend-contracts`
- `verify` script runs `test:frontend-contracts` which runs both
- **Action**: Verify with error injection that both suites make verify fail

## F-08: Git-Commit-Erkennung mit klarer Grenze
**Status**: Partial - `bashTouchesGitCommit` exists but needs explicit positive/negative matrix
- Current implementation handles many cases but some forms not supported
- **Action**: Document supported forms, add tests for all positive/negative cases

## F-09: autoritative Policy-Schicht statt Einzelfunktionsdogma
**Status**: Open - need authoritative policy layer
- Multiple permission functions with overlapping logic
- **Action**: Create single authoritative policy for path/security decisions

## F-10: Hot Path vereinfachen, keinen Cache-Komplex bauen
**Status**: Open - need to measure and simplify
- Redundant snapshot calculations in hot path
- **Action**: Consolidate snapshot calls within same decision, pass results through