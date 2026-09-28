import { glob, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { isFileNotFound } from './fs.js'

// The package directories a workspace root declares; none for a directory
// that is not one, or has no readable package.json.
export async function workspaceMembers(root: string) {
    try {
        return await readWorkspaceMembers(root)
    } catch (e) {
        if (isFileNotFound(e) || e instanceof SyntaxError) {
            return []
        }
        throw e
    }
}

// The workspace root npm installs `path` from, or `path` itself when it is not
// a workspace member.
export async function installRoot(path: string) {
    const target = resolve(path)
    for (let dir = dirname(target); dir !== dirname(dir); dir = dirname(dir)) {
        if ((await workspaceMembers(dir)).includes(target)) {
            return dir
        }
    }
    return target
}

export function isInside(path: string, file: string) {
    const fromPath = relative(path, resolve(path, file))
    return fromPath !== '..' && !fromPath.startsWith(`..${sep}`)
}

async function readWorkspaceMembers(root: string) {
    const { workspaces } = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8')) as {
        workspaces?: string[] | { packages?: string[] }
    }
    const patterns = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? [])
    const members = []
    for (const pattern of patterns) {
        for await (const manifest of glob(join(pattern, 'package.json'), { cwd: root })) {
            members.push(resolve(root, dirname(manifest)))
        }
    }
    return members.toSorted((a, b) => a.localeCompare(b))
}
