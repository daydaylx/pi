/**
 * Module loading for the workflow-v3 suites.
 *
 * Re-exports the shared jiti bootstrap so there is exactly one alias table in
 * the test tree. Suites import `load` and pull in only the runtime modules
 * they exercise, which keeps a failure attributable to one area.
 */
export { ROOT, importModule as load } from "../shared/jiti-loader.mjs";
