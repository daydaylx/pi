/**
 * Legacy-Migration v1/v2 nach v3: ausdrücklich, mit Backup, lease-aware.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const store = await load("extensions/plan-mode/store/index.ts");

await test("legacy migration is explicit, backed up and lease-aware", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-migrate-"));
  try {
    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      JSON.stringify({
        version: 2,
        planId: "legacy-id",
        phase: "paused",
      }),
    );
    assert(
      store.loadWorkflowStateV3(cwd).migrationRequired,
      "legacy state is never migrated implicitly",
    );
    let unconfirmed = false;
    try {
      store.migrateLegacyWorkflowToV3(cwd, {
        confirmedLegacySessionsClosed: false,
      });
    } catch {
      unconfirmed = true;
    }
    assert(unconfirmed, "migration requires session-closure confirmation");
    const migrated = store.migrateLegacyWorkflowToV3(cwd, {
      confirmedLegacySessionsClosed: true,
      now: new Date("2026-07-27T10:00:00.000Z"),
    });
    equal(migrated.state.version, 3, "migration writes v3 state");
    assert(
      readdirSync(
        path.join(cwd, store.MIGRATION_BACKUP_RELATIVE_DIR),
      ).length === 1,
      "migration creates one timestamped backup",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
