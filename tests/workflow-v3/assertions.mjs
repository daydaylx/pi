/**
 * Assertions for the workflow-v3 suites.
 *
 * Re-exports the shared counters so this runner and run.mjs cannot drift into
 * two independent tallies. `eq` and `equal` are the same function: the suites
 * migrated out of run.mjs call it `eq`, the original workflow-v3 suites call
 * it `equal`.
 */
export {
  assert,
  eq,
  equal,
  test,
  counters as summary,
} from "../shared/assertions.mjs";
