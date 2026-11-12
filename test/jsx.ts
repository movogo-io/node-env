import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTSConfig } from '../lib/compiler.js'

const envRoot = join(import.meta.dirname, '..')

describe('jsx', () => {
    let dir = ''

    beforeEach(async () => {
        dir = await realpath(await mkdtemp(join(tmpdir(), 'env-jsx-')))
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('should leave the template unchanged without the flag', async () => {
        const template = await readFile(join(envRoot, 'tsconfig.json'), 'utf-8')
        const templateConfig = JSON.parse(template)
        await writeFile(join(dir, 'tsconfig.json'), template)

        await writeTSConfig(
            dir,
            Promise.resolve({ dependencies: {}, devDependencies: {}, jsx: false }),
        )

        assert.deepStrictEqual(JSON.parse(await readFile(join(dir, 'tsconfig.json'), 'utf-8')), {
            ...templateConfig,
            compilerOptions: { ...templateConfig.compilerOptions, types: ['node', 'mocha'] },
        })
    })

    it('should add JSX with the flag and remove it again without', async () => {
        await writeFile(
            join(dir, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: { types: ['node', 'mocha'], lib: ['ES2025'] },
                include: ['**/*.ts'],
                exclude: ['test/data/**/*.ts'],
            }),
        )
        await mkdir(join(dir, 'example'))
        await writeFile(
            join(dir, 'example/tsconfig.json'),
            JSON.stringify({ compilerOptions: { types: ['node', 'mocha'] } }),
        )

        await writeTSConfig(
            dir,
            Promise.resolve({ dependencies: {}, devDependencies: {}, jsx: true }),
        )
        const withJsx = JSON.parse(await readFile(join(dir, 'tsconfig.json'), 'utf-8'))
        const example = JSON.parse(await readFile(join(dir, 'example/tsconfig.json'), 'utf-8'))
        await writeTSConfig(
            dir,
            Promise.resolve({ dependencies: {}, devDependencies: {}, jsx: false }),
        )
        const withoutJsx = JSON.parse(await readFile(join(dir, 'tsconfig.json'), 'utf-8'))

        assert.deepStrictEqual(withJsx, {
            compilerOptions: { types: ['node', 'mocha'], lib: ['ES2025', 'DOM'], jsx: 'react-jsx' },
            include: ['**/*.ts', '**/*.tsx'],
            exclude: ['test/data/**/*.ts', 'test/data/**/*.tsx', 'example/test/data/**/*.tsx'],
        })
        assert.deepStrictEqual(example, { compilerOptions: { types: ['node', 'mocha'] } })
        assert.deepStrictEqual(withoutJsx, {
            compilerOptions: { types: ['node', 'mocha'], lib: ['ES2025'] },
            include: ['**/*.ts'],
            exclude: ['test/data/**/*.ts'],
        })
    })

    it('should build, lint and test a package with a component', async () => {
        await cp(join(envRoot, 'test/data/jsx'), dir, { recursive: true })
        await Promise.all(
            ['tsconfig.json', '.prettierrc.json', '.editorconfig'].map(file =>
                cp(join(envRoot, file), join(dir, file)),
            ),
        )
        await writeFile(
            join(dir, 'eslint.config.mjs'),
            `import { configuration } from '${pathToFileURL(join(envRoot, 'lib/eslint-config.js')).href}'\n\nexport default configuration(import.meta.dirname)\n`,
        )
        await writeFile(join(dir, '.mocharc.json'), '{}')
        await symlink(join(envRoot, 'node_modules'), join(dir, 'node_modules'))
        await writeFile(
            join(dir, '.timestamps.json'),
            JSON.stringify({
                outputs: [],
                stages: { install: new Date(Date.now() + 60_000).toISOString() },
            }),
        )

        const stdout = await build(dir)

        assert.match(stdout, /1 passing/u)
    }).timeout(60_000)
})

function build(cwd: string) {
    return new Promise<string>((resolve, reject) => {
        execFile(
            process.execPath,
            [join(envRoot, 'bin/build.js')],
            { cwd },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stdout + stderr, { cause: error }))
                    return
                }
                resolve(stdout)
            },
        )
    })
}
