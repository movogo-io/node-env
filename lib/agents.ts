import { access, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { EOL } from 'node:os'
import { join } from 'node:path'
import { ensureUnlinked, isFileNotFound } from './fs.js'
import {
    bytes,
    checkManifest,
    kilobytes,
    type Manifest,
    readManifest,
    referencePattern,
    type Topic,
} from './instructions.js'

type Dependencies = {
    [dependency: string]: {
        path: string
        packageJson: unknown
    }
}

export const managedFiles = [
    'CLAUDE.md',
    'AGENTS.md',
    '.claude/settings.local.json',
    '.claude/skills/',
    '.claude/rules/',
]

export const alwaysLoadedBytesMax = 40_960
export const agentsBytesMax = 32_768

const generatedManifest = '.env-generated.json'

type Guide = {
    manifest: Manifest
    topic: Topic
    name: string
    rule: boolean
    relativeFile: string
}

export async function setupAgents(
    path: string,
    dependencies: Promise<{
        dependencies: Dependencies
        devDependencies: Dependencies
    }>,
    myself?: boolean,
) {
    const packageJson = JSON.parse(await readFile(join(path, 'package.json'), 'utf-8')) as {
        name?: string
        private?: boolean
    }
    const [readme, manifests] = await Promise.all([
        readReadme(path),
        readManifests(path, packageJson, dependencies),
    ])
    const infra = packageJson.private !== true
    const guides = manifests.flatMap(m => guidesOf(m, infra, m.packageName === packageJson.name))
    const claude = claudeDocument(readme, manifests, guides, myself)
    const agents = agentsDocument(readme, manifests, guides, myself)
    const [skillWarnings, ruleWarnings, retiredWarnings] = await Promise.all([
        syncGenerated(
            join(path, '.claude', 'skills'),
            guides
                .filter(g => !g.rule)
                .map(g => [join(g.name, 'SKILL.md'), skillFile(g, guides)] as const),
        ),
        syncGenerated(
            join(path, '.claude', 'rules'),
            guides.filter(g => g.rule).map(g => [`${g.name}.md`, ruleFile(g, guides)] as const),
        ),
        removeRetiredTargets(path),
        writeFile(join(path, 'CLAUDE.md'), claude),
        writeFile(join(path, 'AGENTS.md'), agents),
        writeSettings(path, myself),
    ])
    return {
        summary: budgetSummary(manifests, guides, claude, agents),
        warnings: [
            ...manifests.flatMap(checkManifest),
            ...budgetWarnings(claude, agents),
            ...skillWarnings,
            ...ruleWarnings,
            ...retiredWarnings,
        ],
    }
}

async function readManifests(
    path: string,
    packageJson: { name?: string },
    dependenciesPromise: Promise<{ dependencies: Dependencies; devDependencies: Dependencies }>,
) {
    const deps = await dependenciesPromise
    const sources = [
        ...(packageJson.name ? [[packageJson.name, { path, packageJson }] as const] : []),
        ...Object.entries({ ...deps.dependencies, ...deps.devDependencies }),
    ]
    const manifests = await Promise.all(
        sources.map(async ([name, dependency]) =>
            readManifest(name, dependency.path, dependency.packageJson),
        ),
    )
    return manifests.filter(m => m !== undefined)
}

function guidesOf(manifest: Manifest, infra: boolean, own: boolean): Guide[] {
    return manifest.topics
        .filter(t => infra || !t.infra)
        .map(topic => ({
            manifest,
            topic,
            name: guideName(manifest.packageName, topic.name),
            rule: topic.paths.length !== 0,
            relativeFile: own
                ? join(topic.file)
                : join('node_modules', manifest.packageName, topic.file),
        }))
}

export function guideName(packageName: string, topic: string) {
    const base = packageName
        .replace(/^@/u, '')
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/gu, '-')
    return topic === '' ? base : `${base}-${topic}`
}

function claudeDocument(
    readme: string | undefined,
    manifests: Manifest[],
    guides: Guide[],
    myself?: boolean,
) {
    return [
        `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
`,
        ...bodySections(readme, manifests, myself, text => renderClaude(text, guides)),
        ...guideIndex(guides, g => {
            if (g.rule) {
                return `\`.claude/rules/${g.name}.md\` (loads with ${g.topic.paths.map(p => `\`${p}\``).join(', ')})`
            }
            return `\`${g.name}\` skill`
        }),
    ].join(EOL)
}

function agentsDocument(
    readme: string | undefined,
    manifests: Manifest[],
    guides: Guide[],
    myself?: boolean,
) {
    return [
        ...bodySections(readme, manifests, myself, text => renderFiles(text, guides)),
        ...guideIndex(guides, g => `\`${g.relativeFile}\``),
    ].join(EOL)
}

function* bodySections(
    readme: string | undefined,
    manifests: Manifest[],
    myself: boolean | undefined,
    render: (text: string) => string,
) {
    if (myself) {
        yield `
This is a TypeScript package meant to be installed by other Node packages. The instructions below are what the users of this package follow. Commands we provide are invoked through node_modules by our users; here, run them with node from the bin directory.
`
    }
    if (readme) {
        yield `# Overview

The following is an overview of this project.
`
        yield subsection(readme)
    }
    const cores = manifests.filter(m => m.core !== undefined)
    if (cores.length !== 0) {
        yield `# Packages

The rules below are always in force. Before working in an area a guide covers, read that guide (see *Guides*); the rules here do not repeat the guides.
`
    }
    for (const manifest of cores) {
        yield `## ${manifest.packageName}
`
        yield subsection(subsection(render(manifest.core ?? '')))
    }
}

function* guideIndex(guides: Guide[], locate: (guide: Guide) => string) {
    if (guides.length === 0) {
        return
    }
    yield `# Guides

Read the guide before doing the work it names.

| guide | read when |
|---|---|`
    for (const g of guides) {
        yield `| ${locate(g)} | ${g.topic.when.replaceAll('|', '\\|').replaceAll(/\s+/gu, ' ')} |`
    }
    yield ''
}

function skillFile(guide: Guide, guides: Guide[]) {
    return `---
name: ${guide.name}
description: ${JSON.stringify(guide.topic.when)}
---

${renderClaude(guide.topic.text, guides)}`
}

function ruleFile(guide: Guide, guides: Guide[]) {
    return `---
paths:
${guide.topic.paths.map(p => `  - ${JSON.stringify(p)}`).join(EOL)}
---

${renderClaude(guide.topic.text, guides)}`
}

function renderClaude(text: string, guides: Guide[]) {
    return renderReferences(text, guides, g =>
        g.rule ? `\`.claude/rules/${g.name}.md\`` : `the \`${g.name}\` skill`,
    )
}

function renderFiles(text: string, guides: Guide[]) {
    return renderReferences(text, guides, g => `\`${g.relativeFile}\``)
}

function renderReferences(text: string, guides: Guide[], locate: (guide: Guide) => string) {
    return text.replaceAll(referencePattern, (reference, packageName: string, topic: string) => {
        const guide = guides.find(
            g => g.manifest.packageName === packageName && g.topic.name === topic,
        )
        return guide ? locate(guide) : reference
    })
}

function budgetSummary(manifests: Manifest[], guides: Guide[], claude: string, agents: string) {
    return [
        `Agent instructions: CLAUDE.md ${kilobytes(claude)}, AGENTS.md ${kilobytes(agents)}, ${guides.filter(g => !g.rule).length.toString()} skills, ${guides.filter(g => g.rule).length.toString()} rules.`,
        ...manifests
            .filter(m => m.core !== undefined)
            .map(m => `  ${m.packageName}: core ${kilobytes(m.core ?? '')}`),
    ]
}

function budgetWarnings(claude: string, agents: string) {
    const warnings: string[] = []
    if (alwaysLoadedBytesMax < bytes(claude)) {
        warnings.push(
            `CLAUDE.md is ${kilobytes(claude)}; the always-loaded budget is ${(alwaysLoadedBytesMax / 1024).toString()} KB.`,
        )
    }
    if (agentsBytesMax < bytes(agents)) {
        warnings.push(
            `AGENTS.md is ${kilobytes(agents)}; Codex reads only the first ${(agentsBytesMax / 1024).toString()} KiB by default.`,
        )
    }
    return warnings
}

async function syncGenerated(directory: string, files: (readonly [string, string])[]) {
    const owned = await readGenerated(directory)
    const wanted = new Set(files.map(([file]) => topEntry(file)))
    for (const entry of owned) {
        if (!wanted.has(entry)) {
            await rm(join(directory, entry), { recursive: true, force: true })
        }
    }
    const warnings: string[] = []
    const written: string[] = []
    for (const [file, content] of files) {
        const entry = topEntry(file)
        if (!owned.includes(entry) && (await exists(join(directory, entry)))) {
            warnings.push(`${join(directory, entry)} was not generated; left in place.`)
            continue
        }
        await mkdir(join(directory, file, '..'), { recursive: true })
        await writeFile(join(directory, file), content, 'utf-8')
        written.push(entry)
    }
    if (written.length === 0) {
        await ensureUnlinked(join(directory, generatedManifest))
        await removeIfEmpty(directory)
        return warnings
    }
    await writeFile(
        join(directory, generatedManifest),
        JSON.stringify(
            written.toSorted((a, b) => a.localeCompare(b)),
            undefined,
            '  ',
        ) + '\n',
        'utf-8',
    )
    return warnings
}

async function readGenerated(directory: string) {
    try {
        return JSON.parse(await readFile(join(directory, generatedManifest), 'utf-8')) as string[]
    } catch (e) {
        if (isFileNotFound(e)) {
            return []
        }
        throw e
    }
}

function topEntry(file: string) {
    return file.split(/[/\\]/u, 1)[0] ?? file
}

const retiredFiles: [string, (content: string) => boolean][] = [
    [
        'GEMINI.md',
        c =>
            c.startsWith('# Packages\n') ||
            c.startsWith('# Overview\n') ||
            c.startsWith('\nThis is a TypeScript package'),
    ],
    [join('.github', 'copilot-instructions.md'), c => c.startsWith('# Guide for Copilot\n')],
]
const retiredRuleDirectories = ['.cursor', '.continue']

async function removeRetiredTargets(path: string) {
    const warnings: string[] = []
    for (const [file, generated] of retiredFiles) {
        const content = await readOptional(join(path, file))
        if (content === undefined) {
            continue
        }
        if (!generated(content)) {
            warnings.push(
                `${file} is no longer generated; it was not written by env, so it was left in place.`,
            )
            continue
        }
        await ensureUnlinked(join(path, file))
        await removeIfEmpty(join(path, file, '..'))
    }
    for (const directory of retiredRuleDirectories) {
        warnings.push(...(await removeRetiredRules(join(path, directory))))
    }
    return warnings
}

async function removeRetiredRules(directory: string) {
    const rules = join(directory, 'rules')
    const entries = await readOptionalDirectory(rules)
    const warnings: string[] = []
    for (const entry of entries) {
        const content = await readOptional(join(rules, entry))
        if (content?.startsWith('---\ndescription: ') && content.includes('\nglobs: **/*.ts\n')) {
            await ensureUnlinked(join(rules, entry))
        } else {
            warnings.push(`${join(rules, entry)} was not written by env; left in place.`)
        }
    }
    await removeIfEmpty(rules)
    await removeIfEmpty(directory)
    return warnings
}

async function writeSettings(path: string, myself?: boolean) {
    await mkdir(join(path, '.claude'), { recursive: true })
    await writeFile(
        join(path, '.claude/settings.local.json'),
        JSON.stringify(
            {
                permissions: {
                    allow: myself
                        ? ['Bash(node ./bin/fix.js)', 'Bash(node ./bin/build.js)']
                        : [
                              'Bash(npm init)',
                              'Bash(mkdir -p test)',
                              'Bash(npx riddance-fix)',
                              'Bash(npx riddance-build)',
                          ],
                },
            },
            undefined,
            '  ',
        ),
        'utf-8',
    )
}

async function readReadme(path: string) {
    return await readOptional(join(path, 'README.md'))
}

function subsection(section: string) {
    return section.replaceAll(/^(#+)/gmu, '#$1')
}

async function readOptional(file: string) {
    try {
        return await readFile(file, 'utf-8')
    } catch (e) {
        if (isFileNotFound(e)) {
            return undefined
        }
        throw e
    }
}

async function readOptionalDirectory(directory: string) {
    try {
        return await readdir(directory)
    } catch (e) {
        if (isFileNotFound(e)) {
            return []
        }
        throw e
    }
}

async function exists(path: string) {
    try {
        await access(path)
        return true
    } catch (e) {
        if (isFileNotFound(e)) {
            return false
        }
        throw e
    }
}

async function removeIfEmpty(directory: string) {
    if ((await readOptionalDirectory(directory)).length === 0) {
        try {
            await rmdir(directory)
        } catch (e) {
            if (isFileNotFound(e)) {
                return
            }
            throw e
        }
    }
}
