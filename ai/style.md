# Code style

## File Organization

- Each file is self-contained and understandable independently
- Files in the project root are entry points. Files in the `./test` directory are mocha.js-like test files. Commandline tools go in the bin directory. Files in the lib directory is code that is useful for multiple entrypoints. Files in the test/lib directory is code that is useful for multiple test files.
- Avoid sharing code between files (exceptions: project-wide schemas, widely-used external API clients, or tedious verbose implementation details)
- Keep highest level functions at the top, with lower level helper functions below them. If function a calls function b, place a above b.

## Function Design

- Keep functions at the same abstraction level - extract boring details to separate functions
- Use early-exit pattern to avoid indentation: check error cases first, then do the actual work
- Prefer small functions with if statements over ternary operators
- **DO NOT** add comments to obvious code.
- Prefer using explaining variables and explaining functions instead of comments **if** explanation is needed or it makes reading the code much easier. **DO NOT** use variables for obvious things, e.g. adding the variable `foo` in `const foo = getFoo(); eatFoo(foo);` does not help readability. Similarly, avoid one-line functions.

## Control Flow

- Use `const` over `let`. Create functions that return values instead of reassigning variables; **Prefer:**

```ts
function entry() {
    const value = get();
    use(value);
    more(value);
}

function get() {
    try {
        stuff();
        return 1;
    } catch (e) {
        return 0;
    }
}
```

**Avoid** `let`:

```ts
function entry() {
    let value;
    try {
        stuff();
        value = 1;
    } catch (e) {
        value = 0;
    }
    use(value);
    more(value);
}
```

- Prefer less than, i.e. `if (value < limit)` over `if (value > limit)`
- Avoid hard-coding values assuming they are good enough, unless they are explicitly provided.
- **DO NOT** Fail silently. **DO NOT** catch and ignore errors. We **WANT** to know if an error occurs. Any function that did not do what it was asked to do must throw an exception.
- **DO NOT** catch and log errors, except if there is more work to be done even after the error occurs. Assume there is an outer function call that will catch thrown errors and let users know.

## Dependencies

- Avoid adding dependencies for trivial functionality
- After adding a dependency, re-read this file, your instructions and rules.
- Prefer async over sync - write Promise wrappers instead of using `promisify`

## Classes

- Use classes only for encapsulation (rare, since files provide encapsulation)
- Prefer composition over inheritance

## Naming

- **DO NOT** use generic names such as "util" or "helper".
- Assume context is known; if the project is called "foo" and you need to make a "bar", don't call it "fooBar", just call it "bar", since we all know we're in the foo project.
- Use names like "client" for REST API clients, "schema" files containing database schemas.

## TypeScript

- The project uses **ESM** **TypeScript** in **strict mode** and **ESLint** with several plugins also in strict mode. Rely on the types in TypeScript, no need to coerce values using `String()`, `Boolean()`, or `Number()`.
- Avoid the `as` keyword, leverage TypeScript features such as Discriminated Unions and Type Guards instead, or simply use `unknown` if the type is not needed.
- Inline types as much as possible, prefer `type Foo = { bar: { x: number } }` over `type Foo = { bar: Bar }; type Bar = { x: number }`.
