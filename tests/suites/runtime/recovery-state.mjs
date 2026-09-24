// Pure reducer regressions for extensions/resilience/recovery-state.ts.
// Live folding and history replay must validate markers identically.
import { assert, eq } from "../../shared/assertions.mjs";

function turnTimestamp(value) {
  if (value === "T1") return "2026-01-01T00:00:00.000Z";
  if (value === "T2") return "2026-01-01T00:00:02.000Z";
  return value;
}

function required(turnStartedAt, timestamp, overrides = {}) {
  return {
    type: "custom",
    customType: "resilience.recovery-required",
    data: {
      schemaVersion: 2,
      timestamp,
      turnStartedAt: turnTimestamp(turnStartedAt),
      reason: "final_failure",
      workspaceChangedSinceTurnStart: false,
      toolMayHaveMutatedWorkspace: true,
      ...overrides,
    },
  };
}

function checked(turnStartedAt, timestamp, workspaceFingerprint, overrides = {}) {
  return {
    type: "custom",
    customType: "resilience.recovery-checked",
    data: {
      schemaVersion: 2,
      timestamp,
      turnStartedAt: turnTimestamp(turnStartedAt),
      workspaceFingerprint,
      ...overrides,
    },
  };
}

export const recoveryStateSections = {
  "recovery gate reducer (REC-002)": async (context) => {
    const { section, recoveryState } = context;
    await section("recovery gate reducer (REC-002)", async () => {
      if (!recoveryState) return;
      const {
        foldCheckedMarker,
        foldRequiredMarker,
        gateRequiresInspection,
        latestRecoveryGate,
      } = recoveryState;
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
        turnTimestamp("T2"),
        "the gate now anchors on the newer required turn",
      );

      const staleCheckIgnored = latestRecoveryGate([
        required("T1", "2026-01-01T00:00:00.000Z"),
        required("T2", "2026-01-01T00:00:01.000Z"),
        checked("T1", "2026-01-01T00:00:02.000Z", "fp-old"),
      ]);
      assert(
        !staleCheckIgnored?.checked,
        "a check referencing a superseded required turn never opens the current gate",
      );

      eq(
        latestRecoveryGate([checked("T1", "2026-01-01T00:00:00.000Z", "fp")]),
        undefined,
        "a checked marker with no preceding required marker produces no gate",
      );

      const validRequired = required("T1", "2026-01-01T00:00:00.000Z");
      assert(
        latestRecoveryGate([validRequired]),
        "a complete supported marker is accepted",
      );
      const malformedMarkers = [
        { ...validRequired.data, toolMayHaveMutatedWorkspace: undefined },
        { ...validRequired.data, workspaceChangedSinceTurnStart: undefined },
        { ...validRequired.data, toolMayHaveMutatedWorkspace: "false" },
        {
          ...validRequired.data,
          timestamp: "not-a-timestamp",
          workspaceChangedSinceTurnStart: false,
          toolMayHaveMutatedWorkspace: false,
        },
        {
          ...validRequired.data,
          schemaVersion: 99,
          workspaceChangedSinceTurnStart: false,
          toolMayHaveMutatedWorkspace: false,
        },
        {
          ...validRequired.data,
          schemaVersion: 1,
          toolMayHaveMutatedWorkspace: undefined,
        },
      ];
      for (const [index, data] of malformedMarkers.entries()) {
        const replayed = latestRecoveryGate([
          {
            type: "custom",
            customType: "resilience.recovery-required",
            data,
          },
        ]);
        assert(
          replayed && gateRequiresInspection(replayed.required),
          `malformed or old marker ${index} is unknown and requires inspection`,
        );
        let live = foldRequiredMarker(replayed.required);
        live = foldCheckedMarker(live, {
          schemaVersion: 2,
          timestamp: "2026-01-01T00:00:03.000Z",
          turnStartedAt: replayed.required.turnStartedAt,
          workspaceFingerprint: "fp-live",
        });
        const replayAfterCheck = latestRecoveryGate([
          { type: "custom", customType: "resilience.recovery-required", data },
          checked(replayed.required.turnStartedAt, "2026-01-01T00:00:03.000Z", "fp-live"),
        ]);
        eq(
          live?.checked?.workspaceFingerprint,
          replayAfterCheck?.checked?.workspaceFingerprint,
          `live and replay agree for malformed marker ${index}`,
        );
      }

      const newRequiredAfterChecked = latestRecoveryGate([
        required("T1", "2026-01-01T00:00:00.000Z"),
        checked("T1", "2026-01-01T00:00:01.000Z", "fp-A"),
        required("T2", "2026-01-01T00:00:02.000Z"),
      ]);
      assert(
        !newRequiredAfterChecked?.checked &&
          gateRequiresInspection(newRequiredAfterChecked.required),
        "a new required marker after a checked marker re-arms recovery",
      );

      let live = foldRequiredMarker(validRequired.data);
      live = foldCheckedMarker(live, {
        schemaVersion: 2,
        timestamp: "2026-01-01T00:00:01.000Z",
        turnStartedAt: turnTimestamp("T1"),
        workspaceFingerprint: "fp-A",
      });
      live = foldCheckedMarker(live, {
        schemaVersion: 2,
        timestamp: "2026-01-01T00:00:02.000Z",
        turnStartedAt: turnTimestamp("T1"),
        workspaceFingerprint: "fp-B",
      });
      eq(
        live?.checked?.workspaceFingerprint,
        twoChecks?.checked?.workspaceFingerprint,
        "live folding matches replaying the same valid entries",
      );
      eq(
        foldCheckedMarker(undefined, {
          schemaVersion: 2,
          timestamp: "2026-01-01T00:00:00.000Z",
          turnStartedAt: turnTimestamp("T1"),
          workspaceFingerprint: "fp",
        }),
        undefined,
        "a checked marker with no current gate is a no-op",
      );
    });
  },
};
