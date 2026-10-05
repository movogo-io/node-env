import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupAgents } from '../lib/agents.js'
import { checkManifest, readManifest } from '../lib/instructions.js'

describe('agents', () => {
    let dir = ''

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'env-agents-'))
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('should refuse a manifest that does not fit', async () => {
        await write(dir, 'ai/core.md', 'x'.repeat(5000))
        await write(dir, 'ai/broad.md', 'Broad.')
        const manifest = await readManifest('@x/bad', dir, {
            ai: {
                core: './ai/core.md',
                topics: [
                    { name: 'Broad', file: './ai/broad.md', when: '', paths: ['**/*.ts'] },
                    { name: 'gone', file: './ai/gone.md', when: 'Never.' },
                ],
            },
        })
        assert.ok(manifest)
        assert.deepStrictEqual(checkManifest(manifest), [
            'The core is 4.9 KB; at most 4 KB is always loaded.',
            "Topic name 'Broad' must be lowercase letters, digits and hyphens.",
            "Topic 'Broad' has no 'when'.",
            "Topic 'Broad': path '**/*.ts' must start with a literal directory or file name.",
            "Topic 'gone': ./ai/gone.md is missing or empty.",
        ])
    })

    it('should inline a small legacy guide as the core', async () => {
        await write(dir, 'instructions.md', '# Small\n\nKeep it small.\n')
        const manifest = await readManifest('@x/small', dir, {
            ai: { instructions: './instructions.md' },
        })
        assert.deepStrictEqual(manifest, {
            packageName: '@x/small',
            coreBytesMax: 6144,
            legacy: true,
            core: '# Small\n\nKeep it small.\n',
            topics: [],
        })
    })

    it('should generate cores, skills, rules and the index', async () => {
        const dependencies = await fixture(dir)

        const { warnings } = await setupAgents(dir, Promise.resolve(dependencies))

        assert.deepStrictEqual(await readFile(join(dir, 'CLAUDE.md'), 'utf-8'), claudeExpected)
        assert.deepStrictEqual(
            (await readdir(join(dir, '.claude/skills'))).toSorted((a, b) => a.localeCompare(b)),
            ['.env-generated.json', 'hand-made', 'x-big', 'x-new-indexes'],
        )
        assert.deepStrictEqual(
            await readFile(join(dir, '.claude/skills/x-new-indexes/SKILL.md'), 'utf-8'),
            `---
name: x-new-indexes
description: "Adding an index: reindex, compositeKey."
---

# Indexes

Backfill with reindex. Tests: \`.claude/rules/x-new-testing.md\`.
`,
        )
        assert.deepStrictEqual(
            await readFile(join(dir, '.claude/rules/x-new-testing.md'), 'utf-8'),
            `---
paths:
  - "test/**"
---

# Testing

Use the memory driver.
`,
        )
        assert.deepStrictEqual(warnings, [
            '@x/big ships 6.9 KB of instructions as one file; it is generated as a single skill. Split it into ai/core.md and topics.',
            '.github/copilot-instructions.md is no longer generated; it was not written by env, so it was left in place.',
        ])
    })

    it('should point Codex at the guides in node_modules', async () => {
        const dependencies = await fixture(dir)

        await setupAgents(dir, Promise.resolve(dependencies))

        assert.deepStrictEqual(
            (await readFile(join(dir, 'AGENTS.md'), 'utf-8')).split('# Guides', 2)[1],
            `

Read the guide before doing the work it names.

| guide | read when |
|---|---|
| \`node_modules/@x/new/ai/indexes.md\` | Adding an index: reindex, compositeKey. |
| \`node_modules/@x/new/ai/testing.md\` | Writing a test. |
| \`node_modules/@x/big/instructions.md\` | Read before working with @x/big: A big legacy guide. |
`,
        )
    })

    it('should remove retired targets env generated and keep the rest', async () => {
        const dependencies = await fixture(dir)

        await setupAgents(dir, Promise.resolve(dependencies))

        assert.deepStrictEqual(
            (await readdir(dir)).toSorted((a, b) => a.localeCompare(b)),
            [
                '.claude',
                '.github',
                'AGENTS.md',
                'CLAUDE.md',
                'node_modules',
                'package.json',
                'README.md',
            ],
        )
        assert.deepStrictEqual(await readdir(join(dir, '.github')), ['copilot-instructions.md'])
    })

    it('should include infra topics only for a published package', async () => {
        const dependencies = await fixture(dir)
        await write(dir, 'package.json', JSON.stringify({ name: '@x/consumer' }))

        await setupAgents(dir, Promise.resolve(dependencies))

        assert.deepStrictEqual(
            (await readdir(join(dir, '.claude/skills'))).toSorted((a, b) => a.localeCompare(b)),
            ['.env-generated.json', 'hand-made', 'x-big', 'x-new-driver', 'x-new-indexes'],
        )
    })

    it('should delete skills it generated once their topic is gone', async () => {
        const dependencies = await fixture(dir)
        await setupAgents(dir, Promise.resolve(dependencies))
        const { '@x/big': big, ...rest } = dependencies.dependencies

        await setupAgents(dir, Promise.resolve({ dependencies: rest, devDependencies: {} }))

        assert.ok(big)
        assert.deepStrictEqual(
            (await readdir(join(dir, '.claude/skills'))).toSorted((a, b) => a.localeCompare(b)),
            ['.env-generated.json', 'hand-made', 'x-new-indexes'],
        )
    })
})

const claudeExpected = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Overview

The following is an overview of this project.

## Consumer

A service.

# Packages

The rules below are always in force. Before working in an area a guide covers, read that guide (see *Guides*); the rules here do not repeat the guides.

## @x/new

### New

- Load the \`x-new-indexes\` skill before adding an index.

## @x/small

### Small

Keep it small.

# Guides

Read the guide before doing the work it names.

| guide | read when |
|---|---|
| \`x-new-indexes\` skill | Adding an index: reindex, compositeKey. |
| \`.claude/rules/x-new-testing.md\` (loads with \`test/**\`) | Writing a test. |
| \`x-big\` skill | Read before working with @x/big: A big legacy guide. |
`

async function fixture(dir: string) {
    await write(dir, 'package.json', JSON.stringify({ name: 'consumer', private: true }))
    await write(dir, 'README.md', '# Consumer\n\nA service.\n')
    await write(dir, 'GEMINI.md', '# Packages\n\nThis project uses one or more packages.\n')
    await write(dir, '.github/copilot-instructions.md', 'Written by hand.\n')
    await write(
        dir,
        '.cursor/rules/usage',
        '---\ndescription: The project uses x\nglobs: **/*.ts\n---\n\nOld.\n',
    )
    await write(dir, '.claude/skills/hand-made/SKILL.md', '---\nname: hand-made\n---\n')

    const newDir = join(dir, 'node_modules/@x/new')
    await write(newDir, 'ai/core.md', '# New\n\n- Load @x/new#indexes before adding an index.\n')
    await write(
        newDir,
        'ai/indexes.md',
        '# Indexes\n\nBackfill with reindex. Tests: `@x/new#testing`.\n',
    )
    await write(newDir, 'ai/testing.md', '# Testing\n\nUse the memory driver.\n')
    await write(newDir, 'ai/driver.md', '# Driver\n\nPlumbing.\n')
    const smallDir = join(dir, 'node_modules/@x/small')
    await write(smallDir, 'instructions.md', '# Small\n\nKeep it small.\n')
    const bigDir = join(dir, 'node_modules/@x/big')
    await write(bigDir, 'instructions.md', `# Big\n\nA big legacy guide.\n\n${'y'.repeat(7000)}\n`)

    return {
        dependencies: {
            '@x/new': {
                path: newDir,
                packageJson: {
                    name: '@x/new',
                    ai: {
                        core: './ai/core.md',
                        topics: [
                            {
                                name: 'indexes',
                                file: './ai/indexes.md',
                                when: 'Adding an index: reindex, compositeKey.',
                            },
                            {
                                name: 'testing',
                                file: './ai/testing.md',
                                when: 'Writing a test.',
                                paths: ['test/**'],
                            },
                            {
                                name: 'driver',
                                file: './ai/driver.md',
                                when: 'Decorating the driver.',
                                audience: 'infra',
                            },
                        ],
                    },
                },
            },
            '@x/small': {
                path: smallDir,
                packageJson: { name: '@x/small', ai: { instructions: './instructions.md' } },
            },
            '@x/big': {
                path: bigDir,
                packageJson: { name: '@x/big', ai: { instructions: './instructions.md' } },
            },
        },
        devDependencies: {},
    }
}

async function write(dir: string, file: string, content: string) {
    await mkdir(join(dir, file, '..'), { recursive: true })
    await writeFile(join(dir, file), content, 'utf-8')
}
