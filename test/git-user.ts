import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncGitUser } from '../lib/env.js'

describe('git user', () => {
    let dir = ''

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'env-git-user-'))
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('should pass over a directory that is not a repository', async () => {
        await syncGitUser(dir)
    })

    it('should leave a worktree, whose .git is a file, as it is', async () => {
        await writeFile(join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n')

        await syncGitUser(dir)

        assert.strictEqual(
            await readFile(join(dir, '.git'), 'utf-8'),
            'gitdir: /elsewhere/.git/worktrees/x\n',
        )
    })
})
