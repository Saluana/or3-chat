import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { Check, flagPath, isDirectory, parseArgs, pathExists, printChecks } from './lib'

const REQUIRED_SKILLS = [
  'or3-setup',
  'or3-plugin-development',
  'or3-theme-development',
  'or3-core-development',
]

const REQUIRED_SHARED_REFERENCES = [
  'extension-decision-tree.md',
  'repository-navigation.md',
  'completion-contract.md',
  'quality-gates.md',
  'permissions-and-trust.md',
  'output-format.md',
]

export const packageRoot = resolve(import.meta.dir, '..')

interface Frontmatter {
  body: string
  values: Map<string, string>
}

function parseFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return null

  const values = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line)) continue
    const entry = line.match(/^([A-Za-z][\w-]*):\s*(.+)$/)
    if (entry) values.set(entry[1], entry[2].replace(/^['"]|['"]$/g, '').trim())
  }
  return { body: match[2], values }
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

function localLinkTargets(content: string) {
  const targets: string[] = []
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '')
    if (!target || target.startsWith('#') || /^[a-z]+:/i.test(target)) continue
    targets.push(target.split('#', 1)[0])
  }
  return targets
}

export async function validateSkills(root = packageRoot): Promise<Check[]> {
  const checks: Check[] = []
  const skillsRoot = resolve(root, 'skills')
  const sharedRoot = resolve(root, 'shared')

  for (const path of [resolve(root, 'package.json'), skillsRoot, sharedRoot]) {
    if (!await pathExists(path)) {
      checks.push({ code: 'required-path-missing', level: 'error', message: 'Required package path is missing.', path })
    }
  }

  if (!await isDirectory(skillsRoot)) return checks

  for (const skill of REQUIRED_SKILLS) {
    const path = resolve(skillsRoot, skill, 'SKILL.md')
    if (!await pathExists(path)) {
      checks.push({ code: 'required-skill-missing', level: 'error', message: `Missing required ${skill} skill.`, path })
    }
  }

  for (const reference of REQUIRED_SHARED_REFERENCES) {
    const path = resolve(sharedRoot, reference)
    if (!await pathExists(path)) {
      checks.push({ code: 'shared-reference-missing', level: 'error', message: 'Missing required shared reference.', path })
    }
  }

  const names = new Map<string, string>()
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = resolve(skillsRoot, entry.name, 'SKILL.md')
    if (!await pathExists(file)) continue

    const content = await readFile(file, 'utf8')
    const frontmatter = parseFrontmatter(content)
    if (!frontmatter) {
      checks.push({ code: 'frontmatter-missing', level: 'error', message: 'SKILL.md must start with YAML frontmatter.', path: file })
      continue
    }

    const name = frontmatter.values.get('name')
    const description = frontmatter.values.get('description')
    if (!name || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
      checks.push({ code: 'invalid-name', level: 'error', message: 'Skill name must be lowercase kebab-case.', path: file })
    } else {
      if (name !== entry.name) {
        checks.push({ code: 'directory-name-mismatch', level: 'error', message: `Frontmatter name ${name} must match ${entry.name}.`, path: file })
      }
      const duplicate = names.get(name)
      if (duplicate) {
        checks.push({ code: 'duplicate-skill-name', level: 'error', message: `Also declared by ${relative(root, duplicate)}.`, path: file })
      } else {
        names.set(name, file)
      }
    }

    if (!description || description.length < 24) {
      checks.push({ code: 'description-missing', level: 'error', message: 'Provide a meaningful trigger description.', path: file })
    }

    const lines = content.split(/\r?\n/).length
    if (lines > 500) {
      checks.push({ code: 'skill-too-long', level: 'warning', message: `${lines} lines; move detail into references.`, path: file })
    }
  }

  for (const file of await markdownFiles(root)) {
    const content = await readFile(file, 'utf8')
    for (const target of localLinkTargets(content)) {
      const path = resolve(dirname(file), target)
      if (!await pathExists(path)) {
        checks.push({ code: 'broken-relative-link', level: 'error', message: `Cannot resolve ${target}.`, path: file })
      }
    }
  }

  return checks
}

if (import.meta.main) {
  const { flags } = parseArgs(Bun.argv.slice(2))
  const root = flagPath(flags, 'root', packageRoot)
  const passed = printChecks(await validateSkills(root), flags.has('json'), { root })
  if (!passed) process.exitCode = 1
}
