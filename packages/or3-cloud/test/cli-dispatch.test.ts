import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { parseFlags } from '../src/cli/args';
import { MUTATING_COMMANDS, mutationDirectory, requiresMutationLease } from '../src/cli/dispatch';

const lease = (argv: string[]) => {
  const [command, ...rest] = argv;
  return requiresMutationLease(command, parseFlags(rest));
};

test('every mutating command holds the deployment lease', () => {
  for (const argv of [
    ['init', 'target', '--local'],
    ['adopt', '--from', 'old'],
    ['update'],
    ['update', '--to', '0.1.75'],
    ['backup'],
    ['backup', 'prune'],
    ['backup', 'export', 'id', 'destination'],
    ['verify'],
    ['verify', '--public'],
    ['restore', 'backup-id', '--yes'],
    ['rollback', '--yes'],
    ['credentials', 'reset', '--yes'],
    ['recover'],
    ['recover', '--finish'],
    ['recover', '--restore', '--yes'],
    ['start'],
    ['stop'],
    ['restart'],
    ['remove'],
    ['remove', '--purge-data', '--yes'],
  ]) {
    expect(lease(argv), argv.join(' ')).toBe(true);
  }
});

test('only read-only invocations and observation commands bypass the lease', () => {
  for (const argv of [
    ['update', '--dry-run'],
    ['update', '--dry-run', '--json'],
    ['recover', '--dry-run'],
    ['recover', '--dry-run', '--json'],
    ['backup', 'list'],
    ['backup', 'list', '--json'],
    ['verify', '--read-only'],
    ['verify', '--read-only', '--json'],
    ['status'],
    ['status', '--json'],
    ['doctor'],
    ['logs'],
    ['logs', 'or3', '--tail', '10'],
    ['frobnicate'],
  ]) {
    expect(lease(argv), argv.join(' ')).toBe(false);
  }
});

test('the lease policy table lists exactly the commands that can change a deployment', () => {
  expect([...MUTATING_COMMANDS].sort()).toEqual([
    'adopt', 'backup', 'credentials', 'init', 'recover', 'remove', 'restart', 'restore',
    'rollback', 'start', 'stop', 'update', 'verify',
  ]);
});

test('init and adopt lock the directory they will create; every other command locks the working directory', () => {
  const flags = (argv: string[]) => parseFlags(argv);
  expect(mutationDirectory('init', [], flags([]).flags)).toBe(resolve(process.cwd(), 'or3-cloud'));
  expect(mutationDirectory('init', ['target'], flags([]).flags)).toBe(resolve(process.cwd(), 'target'));
  const adopt = flags(['--from', '/srv/or3-v1']);
  expect(mutationDirectory('adopt', [], adopt.flags)).toBe(resolve(process.cwd(), 'or3-v1-managed'));
  expect(mutationDirectory('adopt', ['managed'], adopt.flags)).toBe(resolve(process.cwd(), 'managed'));
  expect(() => mutationDirectory('adopt', [], {})).toThrow('--from requires a value.');
  for (const command of ['update', 'backup', 'restore', 'remove', 'stop']) {
    expect(mutationDirectory(command, ['ignored'], {})).toBe(process.cwd());
  }
});
