import { readFile } from 'node:fs/promises'
import { findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function dependantPackages(path: string) {
    const { dependencies, devDependencies, allowScripts } = JSON.parse(
        await readFile(join(path, 'package.json'), 'utf-8'),
    ) as {
        dependencies?: { [p: string]: string }
        devDependencies?: { [p: string]: string }
        allowScripts?: { [p: string]: boolean }
    }
    return {
        dependencies: await readPackageJsonFiles(path, dependencies),
        devDependencies: await readPackageJsonFiles(path, devDependencies),
        allowScripts,
    }
}

async function readPackageJsonFiles(path: string, dependencies?: { [p: string]: string }) {
    if (!dependencies) {
        return {}
    }
    const baseUrl = `${pathToFileURL(path).href}/`
    const packages = await Promise.all(
        Object.entries(dependencies).map(async ([dependency, version]) => {
            const packageJson = findPackageJSON(dependency, baseUrl)
            if (!packageJson) {
                return undefined
            }
            return [
                dependency,
                {
                    version,
                    path: dirname(packageJson),
                    packageJson: JSON.parse(await readFile(packageJson, 'utf-8')) as unknown,
                },
            ] as const
        }),
    )
    return Object.fromEntries(packages.filter(p => !!p))
}
