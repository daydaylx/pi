// Pure reducer regressions for extensions/resilience/recovery-state.ts
// (REC-002). latestRecoveryGate() replays session entries into the same
// gate a live session would hold; foldRequiredMarker/foldCheckedMarker are
// the exact reducer steps both the live recovery_check tool (index.ts) and
// this replay use, so the two paths cannot silently diverge again.
import { assert, eq } from "../../shared/assertions.mjs";

function required(turnStartedAt, timestamp) {
  return {
    type: "custom",
    customType: "resilience.recovery-required",
    data: {
      schemaVersion: 2,
      timestamp,
      turnStartedAt,
      reason: "final_failure",
      workspaceChangedSinceTurnStart: false,
      toolMayHaveMutatedWorkspace: true,
    },
  };
}

function checked(turnStartedAt, timestamp, workspaceFingerprint) {
  return {
    type: "custom",
    customType: "resilience.recovery-checked",
    data: {
      schemaVersion: 2,
      timestamp,
      turnStartedAt,
      workspaceFingerprint,
    },
  };
}

export const recoveryStateSections = {
  "recovery gate reducer (REC-002)": async (context) => {
    const { section, recoveryState } = context;
    await section("recovery gate reducer (REC-002)", async () => {
      if (!recoveryState) return;
      const { foldCheckedMarker, foldRequiredMarker, latestRecoveryGate } =
        recoveryState;
      // required(turn1) -> checked(A) -> checked(B) -> restart yields B, not
      // the first check seen. This is the exact bug: a stale `!gate.checked`
      // guard in the old replay loop kept only the first checked marker per
      // required turn.
      const twoChecks = latestRecoveryGate([
        required("T1", "2026-01-01T00:00:00.000Z"),
        checked("T1", "2026-01-01T00:00:01.000Z", "fp-A"),
        checked("T1", "2026-01-01T00:00:02.000Z", "fp-B"),
      ]);
      eq(
        twoChecks?.checked?.workspaceFingerprint,
        "fp-B",
        "replay reconstructs the newest check (B), not the first (A)",
      );

      // required(turn1) -> checked(A) -> required(turn2) discards A: a new
      // required window always drops any earlier checked state, even one
      // that hasn't been superseded by another check.
      const newRequiredDiscards = latestRecoveryGate([
        required("T1", "2026-01-01T00:00:00.000Z"),
        checked("T1", "2026-01-01T00:00:01.000Z", "fp-A"),
        required("T2", "2026-01-01T00:00:02.000Z"),
      ]);
      assert(
        !newRequiredDiscards?.checked,
        "a later required marker discards the earlier check entirely",
      );
      eq(
        newRequiredDiscards?.required.turnStartedAt,
        "T2",
        "the gate now anchors on the newer required turn",
      );

      // A checked marker for an old, already-superseded required turn can
      // never open the current gate, even if it appears after the newer
      // required marker in the log (out-of-order writes, replayed history).
      const staleCheckIgnored = latestRecoveryGate([
        required("T1", "2026-01-01T00:00:00.000Z"),
        required("T2", "2026-01-01T00:00:01.000Z"),
        checked("T1", "2026-01-01T00:00:02.000Z", "fp-old"),
      ]);
      assert(
        !staleCheckIgnored?.checked,
        "a check referencing a superseded required turn never opens the current gate",
      );

      // No required marker at all: no gate.
      eq(
        latestRecoveryGate([checked("T1", "2026-01-01T00:00:00.000Z", "fp")]),
        undefined,
        "a checked marker with no preceding required marker produces no gate",
      );

      // Live and replay must use the identical reducer step. Applying
      // foldRequiredMarker/foldCheckedMarker directly, one call at a time,
      // must produce the same result as replaying the equivalent entries
      // through latestRecoveryGate in one pass.
      let live = undefined;
      live = foldRequiredMarker({
        schemaVersion: 2,
        timestamp: "2026-01-01T00:00:00.000Z",
        turnStartedAt: "T1",
        reason: "final_failure",
        workspaceChangedSinceTurnStart: false,
        toolMayHaveMutatedWorkspace: true,
      });
      live = foldCheckedMarker(live, {
        schemaVersion: 2,
        timestamp: "2026-01-01T00:00:01.000Z",
        turnStartedAt: "T1",
        workspaceFingerprint: "fp-A",
      });
      live = foldCheckedMarker(live, {
        schemaVersion: 2,
        timestamp: "2026-01-01T00:00:02.000Z",
        turnStartedAt: "T1",
        workspaceFingerprint: "fp-B",
      });
      eq(
        live?.checked?.workspaceFingerprint,
        twoChecks?.checked?.workspaceFingerprint,
        "applying the reducer steps one at a time (as the live recovery_check tool does) matches replaying the same entries in one pass",
      );

      // A checked marker whose turnStartedAt doesn't match any open
      // required window is a no-op, not a crash or a silently opened gate.
      eq(
        foldCheckedMarker(undefined, {
          schemaVersion: 2,
          timestamp: "2026-01-01T00:00:00.000Z",
          turnStartedAt: "T1",
          workspaceFingerprint: "fp",
        }),
        undefined,
        "a checked marker with no current gate is a no-op",
      );
    });
  },
};
