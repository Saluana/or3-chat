import { resolve } from 'node:path'
import { Check, flagPath, parseArgs, pathExists, printChecks, readJson } from './lib'
import { packageRoot } from './validate-skills'

const SKILLS = new Set([
  'or3-setup',
  'or3-plugin-development',
  'or3-theme-development',
  'or3-core-development',
])

interface RoutingCase {
  expected: { primarySkill: string | null; surface: string }
  id: string
  prompt: string
}

interface CompletionCase {
  id: string
  requiredSections: string[]
}

export async function validateEvaluationFixtures(root = packageRoot) {
  const checks: Check[] = []
  const routingPath = resolve(root, 'tests/fixtures/routing-cases.json')
  const completionPath = resolve(root, 'tests/fixtures/completion-cases.json')

  for (const path of [routingPath, completionPath]) {
    if (!await pathExists(path)) {
      checks.push({ code: 'fixture-missing', level: 'error', message: 'Required evaluation fixture is missing.', path })
    }
  }
  if (checks.length > 0) return { checks, completionCases: 0, routingCases: 0 }

  const routingCases = await readJson<RoutingCase[]>(routingPath)
  const completionCases = await readJson<CompletionCase[]>(completionPath)
  const ids = new Set<string>()
  for (const testCase of routingCases) {
    if (!testCase.id || ids.has(testCase.id)) {
      checks.push({ code: 'routing-case-id-invalid', level: 'error', message: 'Routing case IDs must be unique and non-empty.', path: routingPath })
    }
    ids.add(testCase.id)
    if (!testCase.prompt?.trim()) {
      checks.push({ code: 'routing-prompt-missing', level: 'error', message: `Case ${testCase.id} has no prompt.`, path: routingPath })
    }
    const skill = testCase.expected?.primarySkill
    if (skill !== null && !SKILLS.has(skill)) {
      checks.push({ code: 'routing-skill-unknown', level: 'error', message: `Case ${testCase.id} references unknown skill ${skill}.`, path: routingPath })
    }
    if (!testCase.expected?.surface) {
      checks.push({ code: 'routing-surface-missing', level: 'error', message: `Case ${testCase.id} has no expected surface.`, path: routingPath })
    }
  }

  const requiredSections = ['Architecture', 'Changes', 'Permissions', 'Validation', 'Artifact or installation', 'Rollback', 'Remaining risks']
  for (const testCase of completionCases) {
    const missing = requiredSections.filter((section) => !testCase.requiredSections?.includes(section))
    if (!testCase.id || missing.length > 0) {
      checks.push({ code: 'completion-case-incomplete', level: 'error', message: `Case ${testCase.id || '(unnamed)'} omits ${missing.join(', ') || 'an ID'}.`, path: completionPath })
    }
  }

  return { checks, completionCases: completionCases.length, routingCases: routingCases.length }
}

if (import.meta.main) {
  const { flags } = parseArgs(Bun.argv.slice(2))
  const root = flagPath(flags, 'root', packageRoot)
  const result = await validateEvaluationFixtures(root)
  const passed = printChecks(result.checks, flags.has('json'), {
    completionCases: result.completionCases,
    modelRuns: 0,
    routingCases: result.routingCases,
    status: 'fixtures-valid; no model adapter configured',
  })
  if (!passed) process.exitCode = 1
}
