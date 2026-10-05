# Tests

- Prefer `assert.deepStrictEquals` over `assert.ok`, so we can see the diff if the expectation is not met, e.g. `assert.deepStrictEqual(someList, []))` over `assert.ok(someList.length === 0)`.
- Keep the simplest tests at the top of the file, e.g. error cases, and increase complexity as you go down the file.
- Use `it('...', () => { ... }).timeout(...)` instead of `it('...', function() { this.timeout(...) ... })`
- Avoid using helper functions in tests, as tests serves as documentation, so it needs to be clear what is being done in any given test from looking at the test code. You shouldn't have to look through helper functions to understand test code.

## Spelling

- Add business/technical terms that are used throughout the project to a `dictionary.txt` file in the root.
- Use `// spell-checker: ignore impropercasingAsAnexample` for words that are used in isolation, e.g. in individual tests or individual external APIs, so you don't accidentally allow those mistakes in the rest of the project. If the purpose of the whole project is to interact with a non-English API, then it's OK to add the foreign words to `dictionary.txt`. The same goes for `/* eslint-disable camelcase */` in case of e.g. external APIs use camelcase.
