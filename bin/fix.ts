#!/usr/bin/env node

import { Glob } from 'glob'
import { resolve } from 'node:path'
import { getSource } from '../lib/changes.js'
import { dependantPackages } from '../lib/dependencies.js'
import { formatFiles } from '../lib/formatter.js'
import { fixLints } from '../lib/linter.js'

const path = resolve(process.cwd(), process.argv[2] ?? '.')
const pattern = (await dependantPackages(path)).jsx ? '**/*.{ts,tsx}' : '**/*.ts'
const glob = new Glob(pattern, { cwd: path, ignore: ['node_modules/**', '**/*.d.ts'] })
const files = await glob.walk()
const sourceFiles = getSource(files.map(f => resolve(path, f)))

await fixLints(path, pattern)
const fixed = await formatFiles(
    path,
    sourceFiles.map(f => f.replace(path + '/', '')),
)

if (fixed.length !== 0) {
    console.log('Files fixed: ' + fixed.join(', '))
}
