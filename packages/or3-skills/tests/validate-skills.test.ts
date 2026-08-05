import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { packageRoot, validateSkills } from '../scripts/validate-skills'

const temporaryRoots: string[] = []
const skills = [
  'or3-setup',
  'or3-plugin-development',
  'or3-theme-development',
  'or3-core-development',
  'or3-openclaw-setup',
  'or3-hermes-setup',
]
const references = [
  'extension-decision-tree.md',
  'repository-navigation.md',
  'completion-contract.md',
  'quality-gates.md',
  'permissions-and-trust.md',
  'output-format.md',
  'external-agent-runs.md',
]

async function fixturePackage(options: { brokenLink?: boolean; mismatchedName?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'or3-skills-'))
  temporaryRoots.push(root)
  await mkdir(resolve(root, 'shared'), { recursive: true })
  await mkdir(resolve(root, 'skills'), { recursive: true })
  await writeFile(resolve(root, 'package.json'), '{}')
  await Promise.all(references.map((reference) => writeFile(resolve(root, 'shared', reference), '# Reference\n')))

  for (const skill of skills) {
    const directory = resolve(root, 'skills', skill)
    await mkdir(directory)
    const name = options.mismatchedName && skill === 'or3-setup' ? 'not-the-directory' : skill
    const link = options.brokenLink && skill === 'or3-setup' ? '\n[missing](./missing.md)' : ''
    await writeFile(resolve(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: A sufficiently descriptive fixture trigger for testing.\n---\n# Fixture${link}\n`)
  }
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('the shipped package has no validation errors', async () => {
  const checks = await validateSkills(packageRoot)
  expect(checks.filter(({ level }) => level === 'error')).toEqual([])
})

test('the validator rejects a directory-name mismatch', async () => {
  const checks = await validateSkills(await fixturePackage({ mismatchedName: true }))
  expect(checks.some(({ code }) => code === 'directory-name-mismatch')).toBe(true)
})

test('the validator rejects broken relative markdown links', async () => {
  const checks = await validateSkills(await fixturePackage({ brokenLink: true }))
  expect(checks.some(({ code }) => code === 'broken-relative-link')).toBe(true)
})
