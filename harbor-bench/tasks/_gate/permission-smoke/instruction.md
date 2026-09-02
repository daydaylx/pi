This repository (already a git repo with one commit) contains a small,
broken JavaScript module.

Do the following, in order:

1. Read `calc.mjs` and `calc.test.mjs` to understand the bug.
2. Fix the bug in `calc.mjs` so the tests pass. Do not change `calc.test.mjs`.
3. Run the test suite (`node --test calc.test.mjs`) to confirm the fix.
4. Run `project_check` with the `tests` profile.
5. Request LSP diagnostics for `calc.mjs` to confirm there are no syntax/type
   errors.
6. Delete the unused file `scratch.tmp` -- it is not needed for anything.
7. Run `git diff` to review your change, then stage and commit it.
