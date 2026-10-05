import { readFile } from 'node:fs/promises'
import { findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isFileNotFound } from './fs.js'

export const coreBytesMax = 4096
export const coreBytesMaxCeiling = 8192
export const topicBytesMax = 20_480
export const whenLengthMax = 300
export const legacyInlineBytesMax = 6144

export type Topic = {
    name: string
    file: string
    when: string
    paths: string[]
    infra: boolean
    text: string
}

export type Manifest = {
    packageName: string
    core: string | undefined
    coreBytesMax: number
    topics: Topic[]
    legacy: boolean
}

type ManifestJson = {
    core?: unknown
    coreBytesMax?: unknown
    topics?: unknown
    audience?: unknown
    description?: unknown
    instructions?: unknown
}

type TopicJson = {
    name?: unknown
    file?: unknown
    when?: unknown
    paths?: unknown
    audience?: unknown
}

export async function readManifest(
    packageName: string,
    path: string,
    packageJson: unknown,
): Promise<Manifest | undefined> {
    const { ai } = packageJson as { ai?: ManifestJson }
    if (!ai) {
        return undefined
    }
    if (ai.core === undefined && ai.topics === undefined) {
        return await readLegacyManifest(packageName, path, ai)
    }
    const packageInfra = ai.audience === 'infra'
    return {
        packageName,
        core: typeof ai.core === 'string' ? await readText(path, ai.core) : undefined,
        coreBytesMax: typeof ai.coreBytesMax === 'number' ? ai.coreBytesMax : coreBytesMax,
        topics: await Promise.all(
            (Array.isArray(ai.topics) ? (ai.topics as TopicJson[]) : []).map(t =>
                readTopic(path, t, packageInfra),
            ),
        ),
        legacy: false,
    }
}

async function readLegacyManifest(packageName: string, path: string, ai: ManifestJson) {
    if (typeof ai.instructions !== 'string') {
        return undefined
    }
    const text = await readOptionalText(path, ai.instructions)
    if (text === undefined) {
        return undefined
    }
    const base = {
        packageName,
        coreBytesMax: legacyInlineBytesMax,
        legacy: true,
    }
    if (bytes(text) <= legacyInlineBytesMax) {
        return { ...base, core: text, topics: [] }
    }
    return {
        ...base,
        core: undefined,
        topics: [
            {
                name: '',
                file: ai.instructions,
                when:
                    typeof ai.description === 'string'
                        ? ai.description
                        : `Read before working with ${packageName}: ${firstParagraph(text)}`,
                paths: [],
                infra: false,
                text,
            },
        ],
    }
}

async function readTopic(path: string, topic: TopicJson, packageInfra: boolean): Promise<Topic> {
    const file = typeof topic.file === 'string' ? topic.file : ''
    return {
        name: typeof topic.name === 'string' ? topic.name : '',
        file,
        when: typeof topic.when === 'string' ? topic.when : '',
        paths: Array.isArray(topic.paths)
            ? topic.paths.filter((p): p is string => typeof p === 'string')
            : [],
        infra: packageInfra || topic.audience === 'infra',
        text: file === '' ? '' : ((await readOptionalText(path, file)) ?? ''),
    }
}

export function checkManifest(manifest: Manifest) {
    if (manifest.legacy) {
        return checkLegacyManifest(manifest)
    }
    return [
        ...checkCore(manifest),
        ...checkTopicNames(manifest.topics),
        ...manifest.topics.flatMap(checkTopic),
        ...checkSelfReferences(manifest),
    ]
}

function checkLegacyManifest(manifest: Manifest) {
    const [topic] = manifest.topics
    if (!topic) {
        return []
    }
    return [
        `${manifest.packageName} ships ${kilobytes(topic.text)} of instructions as one file; it is generated as a single skill. Split it into ai/core.md and topics.`,
    ]
}

function checkCore(manifest: Manifest) {
    const problems: string[] = []
    if (coreBytesMaxCeiling < manifest.coreBytesMax) {
        problems.push(
            `ai.coreBytesMax is ${manifest.coreBytesMax.toString()}; the ceiling is ${coreBytesMaxCeiling.toString()}.`,
        )
    }
    if (manifest.core !== undefined && manifest.coreBytesMax < bytes(manifest.core)) {
        problems.push(
            `The core is ${kilobytes(manifest.core)}; at most ${(manifest.coreBytesMax / 1024).toString()} KB is always loaded.`,
        )
    }
    return problems
}

function checkTopicNames(topics: Topic[]) {
    const seen = new Set<string>()
    const problems: string[] = []
    for (const { name } of topics) {
        if (!/^[a-z][a-z0-9-]*$/u.test(name)) {
            problems.push(`Topic name '${name}' must be lowercase letters, digits and hyphens.`)
        }
        if (seen.has(name)) {
            problems.push(`Topic '${name}' is declared twice.`)
        }
        seen.add(name)
    }
    return problems
}

function checkTopic(topic: Topic) {
    const problems: string[] = []
    if (topic.file === '') {
        problems.push(`Topic '${topic.name}' names no file.`)
    } else if (topic.text === '') {
        problems.push(`Topic '${topic.name}': ${topic.file} is missing or empty.`)
    }
    if (topicBytesMax < bytes(topic.text)) {
        problems.push(
            `Topic '${topic.name}' is ${kilobytes(topic.text)}; a topic is at most 20 KB.`,
        )
    }
    if (topic.when.trim() === '') {
        problems.push(`Topic '${topic.name}' has no 'when'.`)
    }
    if (whenLengthMax < topic.when.length) {
        problems.push(
            `Topic '${topic.name}': 'when' is ${topic.when.length.toString()} characters; at most ${whenLengthMax.toString()}.`,
        )
    }
    for (const pattern of topic.paths) {
        if (!isNarrowPath(pattern)) {
            problems.push(
                `Topic '${topic.name}': path '${pattern}' must start with a literal directory or file name.`,
            )
        }
    }
    return problems
}

function checkSelfReferences(manifest: Manifest) {
    const names = new Set(manifest.topics.map(t => t.name))
    return [manifest.core ?? '', ...manifest.topics.map(t => t.text)]
        .flatMap(references)
        .filter(r => r.packageName === manifest.packageName && !names.has(r.topic))
        .map(r => `Reference ${r.packageName}#${r.topic} names no topic of this package.`)
}

export async function checkReferences(manifest: Manifest, fromPath: string) {
    const baseUrl = `${pathToFileURL(fromPath).href}/`
    const others = [manifest.core ?? '', ...manifest.topics.map(t => t.text)]
        .flatMap(references)
        .filter(r => r.packageName !== manifest.packageName)
    const problems: string[] = []
    for (const r of others) {
        const packageJsonPath = findPackageJSON(r.packageName, baseUrl)
        if (!packageJsonPath) {
            continue
        }
        const target = await readManifest(
            r.packageName,
            dirname(packageJsonPath),
            JSON.parse(await readFile(packageJsonPath, 'utf-8')) as unknown,
        )
        if (!target?.topics.some(t => t.name === r.topic)) {
            problems.push(`Reference ${r.packageName}#${r.topic} names no topic of that package.`)
        }
    }
    return problems
}

export const referencePattern = /`?(@[a-z0-9-]+\/[a-z0-9-]+)#([a-z][a-z0-9-]*)`?/gu

export function references(text: string) {
    return text
        .matchAll(referencePattern)
        .map(([, packageName, topic]) => ({
            packageName: packageName ?? '',
            topic: topic ?? '',
        }))
        .toArray()
}

function isNarrowPath(pattern: string) {
    const [first] = pattern.split('/', 1)
    return !!first && !first.includes('*')
}

function firstParagraph(text: string) {
    const paragraph =
        text
            .split(/\n\s*\n/u)
            .map(p => p.trim())
            .find(p => p !== '' && !p.startsWith('#')) ?? ''
    const flat = paragraph.replaceAll(/\s+/gu, ' ')
    const room = whenLengthMax - 40
    if (flat.length <= room) {
        return flat
    }
    return flat.slice(0, room - 1) + '…'
}

export function bytes(text: string) {
    return Buffer.byteLength(text, 'utf-8')
}

export function kilobytes(text: string) {
    return `${(bytes(text) / 1024).toFixed(1)} KB`
}

async function readText(path: string, file: string) {
    return await readFile(join(path, file), 'utf-8')
}

async function readOptionalText(path: string, file: string) {
    try {
        return await readText(path, file)
    } catch (e) {
        if (isFileNotFound(e)) {
            return undefined
        }
        throw e
    }
}

export async function checkPackageInstructions(path: string) {
    const packageJson = JSON.parse(await readFile(join(path, 'package.json'), 'utf-8')) as {
        name?: string
    }
    const manifest = await readManifest(packageJson.name ?? '', path, packageJson)
    if (!manifest) {
        return { errors: [], warnings: [] }
    }
    const problems = [...checkManifest(manifest), ...(await checkReferences(manifest, path))]
    if (manifest.legacy) {
        return { errors: [], warnings: problems }
    }
    return { errors: problems, warnings: [] }
}
