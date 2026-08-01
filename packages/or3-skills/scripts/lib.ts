import { access, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export type CheckLevel = 'error' | 'warning'

export interface Check {
  code: string
  level: CheckLevel
  message: string
  path?: string
}

export function parseArgs(args: string[]) {
  const flags = new Map<string, string | true>()
  const positional: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value.startsWith('--')) {
      positional.push(value)
      continue
    }

    const [key, inline] = value.slice(2).split('=', 2)
    if (inline !== undefined) {
      flags.set(key, inline)
      continue
    }

    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, true)
    }
  }

  return { flags, positional }
}

export function flagPath(flags: Map<string, string | true>, name: string, fallback: string) {
  const value = flags.get(name)
  return resolve(typeof value === 'string' ? value : fallback)
}

export async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function findUp(start: string, predicate: (path: string) => Promise<boolean>) {
  let current = resolve(start)
  while (true) {
    if (await predicate(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function printChecks(checks: Check[], json: boolean, summary: Record<string, unknown> = {}) {
  const errors = checks.filter(({ level }) => level === 'error')
  const warnings = checks.filter(({ level }) => level === 'warning')
  const result = { ...summary, errors: errors.length, warnings: warnings.length, checks }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    for (const check of checks) {
      const location = check.path ? ` (${check.path})` : ''
      console.log(`${check.level.toUpperCase()} ${check.code}${location}: ${check.message}`)
    }
    console.log(`Checked: ${errors.length} error(s), ${warnings.length} warning(s)`)
  }

  return errors.length === 0
}

export async function runText(command: string[], cwd: string) {
  const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}
