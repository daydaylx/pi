/**
 * Assertion helpers and the process-wide result counters.
 *
 * One counter set per process, shared by every suite file. Keeping them here
 * rather than per file is what lets a runner import several suites and still
 * report one honest total — separate counters could hide a failing suite.
 *
 * `currentSection` names the failing area in a large suite; suites that run
 * one test at a time set it through `test`, run.mjs sets it through `section`.
 */
let passed = 0;
let failed = 0;
let currentSection = "";

export function setCurrentSection(name) {
  currentSection = name;
}

export function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.log(
    currentSection
      ? "  FAIL: [" + currentSection + "] " + message
      : "  FAIL: " + message,
  );
}

export function eq(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    message +
      " — expected " +
      JSON.stringify(expected) +
      ", got " +
      JSON.stringify(actual),
  );
}

/** Compatibility alias for tests that use the older assertion spelling. */
export const equal = eq;

export function counters() {
  return { passed, failed };
}

/** Record a thrown error as a failure without aborting the whole run. */
export function recordThrow(name, error) {
  failed += 1;
  console.log(
    `  FAIL: ${name} threw\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
}

export async function test(name, run) {
  const before = { passed, failed };
  setCurrentSection(name);
  try {
    await run();
  } catch (error) {
    recordThrow(name, error);
  } finally {
    if (process.env.PI_SECTION_STATS === "1") {
      console.log(
        `STATS\t${passed - before.passed}\t${failed - before.failed}\t${name}`,
      );
    }
    setCurrentSection("");
  }
}
