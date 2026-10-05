# Toolchain

- Files in the project root are entry points. Code shared by several entry points goes in `lib/`, tests in `test/` (shared test code in `test/lib/`), command-line tools in `bin/`.
- `npx riddance-fix` fixes formatting and lint and lists what it changed; run it before every check. `npx riddance-build` checks spelling, lint, types and formatting and runs the tests. **Never** run `tsc`, `eslint`, `prettier`, `mocha` or `npm test` directly. A command that times out is an error: run it again or find out why.
- Business and technical terms used across the project go in `dictionary.txt`; a word used once gets `// spell-checker: ignore word` beside it.
- **Do not fail silently.** A function that did not do what it was asked throws. Never catch and ignore; never catch and log unless more work follows the error.
- Commit messages explain the context and reason, quote the user's original prompt, and carry the `Co-Authored-By:` line (see @movogo-io/env#commits). Never push.
- Before calling a change done: re-read the instructions, look for simplifications and duplication, and remove comments that state the obvious.
