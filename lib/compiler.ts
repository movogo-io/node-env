/* eslint-disable unicorn/no-for-each */
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript'
import { isFileNotFound } from './fs.js'
import { Reporter } from './reporter.js'

export async function writeTSConfig(
    path: string,
    packageDependencies: Promise<{
        dependencies: { [dependency: string]: unknown }
        devDependencies: { [dependency: string]: unknown }
        jsx: boolean
    }>,
) {
    const { dependencies, devDependencies, jsx } = await packageDependencies
    const types = [
        ...new Set([
            'node',
            'mocha',
            ...[...Object.keys(dependencies), ...Object.keys(devDependencies)]
                .filter(d => d.startsWith('@types/'))
                .map(d => d.slice('@types/'.length)),
        ]),
    ]
    await patchConfig(resolve(path, 'tsconfig.json'), types, jsx)
    await patchConfig(resolve(path, 'example', 'tsconfig.json'), types, undefined)
}

export function compile(reporter: Reporter, path: string) {
    const configFile = ts.readConfigFile(resolve(path, 'tsconfig.json'), p => ts.sys.readFile(p))
    if (configFile.error) {
        reportDiagnostic(reporter)(configFile.error)
        return { sourceFiles: [] }
    }

    const tsconfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, './')
    if (tsconfig.errors.length !== 0) {
        tsconfig.errors.forEach(reportDiagnostic(reporter))
        return { sourceFiles: [] }
    }

    const program = ts.createProgram(tsconfig.fileNames, {
        ...tsconfig.options,
        listEmittedFiles: true,
        outDir: path,
        rootDir: path,
    })
    const sourceFiles = program.getSourceFiles().map(sf => relative(path, sf.fileName))

    const diagnostics = ts.getPreEmitDiagnostics(program)
    diagnostics.forEach(reportDiagnostic(reporter))
    const emitResult = program.emit()
    emitResult.diagnostics.forEach(reportDiagnostic(reporter))
    if (diagnostics.length !== 0 || emitResult.diagnostics.length !== 0 || emitResult.emitSkipped) {
        return { sourceFiles }
    }
    return {
        sourceFiles,
        outputFiles: emitResult.emittedFiles?.map(f => relative(path, f)),
    }
}

export function reportDiagnostic(reporter: Reporter) {
    return (diagnostic: ts.Diagnostic) => {
        const { line, character } =
            diagnostic.start === undefined
                ? { line: undefined, character: undefined }
                : (diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start) ?? {})
        reporter.error(
            ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            diagnostic.file?.fileName,
            line ? line + 1 : undefined,
            character ? character + 1 : undefined,
        )
    }
}

// `jsx` undefined leaves JSX settings alone: example/tsconfig.json is the author's own.
async function patchConfig(tsconfigPath: string, types: string[], jsx: boolean | undefined) {
    try {
        const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf-8')) as {
            compilerOptions?: { types?: string[]; jsx?: string; lib?: string[] }
            include?: string[]
            exclude?: string[]
        }
        const patched = structuredClone(tsconfig)
        const compilerOptions = (patched.compilerOptions ??= {})
        compilerOptions.types = types
        // An absent lib or include is TypeScript's default, which already holds DOM and .tsx.
        if (jsx === true) {
            compilerOptions.jsx = 'react-jsx'
            compilerOptions.lib &&= withEntries(compilerOptions.lib, ['DOM'])
            patched.include &&= withEntries(patched.include, ['**/*.tsx'])
            patched.exclude &&= withEntries(patched.exclude, tsxTestData)
        } else if (jsx === false) {
            if (compilerOptions.jsx === 'react-jsx') {
                delete compilerOptions.jsx
            }
            compilerOptions.lib &&= withoutEntries(compilerOptions.lib, ['DOM'])
            patched.include &&= withoutEntries(patched.include, ['**/*.tsx'])
            patched.exclude &&= withoutEntries(patched.exclude, tsxTestData)
        }
        if (isDeepStrictEqual(patched, tsconfig)) {
            return
        }
        await writeFile(tsconfigPath, JSON.stringify(patched, undefined, '  '), 'utf-8')
    } catch (e) {
        if (isFileNotFound(e)) {
            return
        }
        throw e
    }
}

const tsxTestData = ['test/data/**/*.tsx', 'example/test/data/**/*.tsx']

function withEntries(list: string[], entries: string[]) {
    return [...list, ...entries.filter(e => list.every(l => !sameEntry(l, e)))]
}

function withoutEntries(list: string[], entries: string[]) {
    return list.filter(l => entries.every(e => !sameEntry(l, e)))
}

function sameEntry(a: string, b: string) {
    return a.toLowerCase() === b.toLowerCase()
}
