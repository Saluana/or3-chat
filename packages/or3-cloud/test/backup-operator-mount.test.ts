import { expect, test } from 'bun:test';
import { assertBackupOperatorMount } from '../src/backup/references';

test('backup accepts only the managed read-only dashboard socket mount', () => {
  const directory = '/tmp/or3-managed';
  const source = `${directory}/.or3-cloud/operator-ipc`;
  const configured = { target: '/run/or3-operator', type: 'bind', source, read_only: true };
  const actual = { Destination: '/run/or3-operator', Type: 'bind', Source: source, RW: false };
  expect(() => assertBackupOperatorMount(directory, true, [configured], [actual])).not.toThrow();
  expect(() => assertBackupOperatorMount(directory, false, [], [])).not.toThrow();
  expect(() => assertBackupOperatorMount(directory, false, [configured], [actual])).toThrow();
  expect(() => assertBackupOperatorMount(directory, true, [], [])).toThrow();
  expect(() => assertBackupOperatorMount(directory, true, [{ ...configured, source: '/tmp/other' }], [actual])).toThrow();
  expect(() => assertBackupOperatorMount(directory, true, [configured], [{ ...actual, Source: '/tmp/other' }])).toThrow();
  expect(() => assertBackupOperatorMount(directory, true, [{ ...configured, read_only: false }], [actual])).toThrow();
  expect(() => assertBackupOperatorMount(directory, true, [configured], [{ ...actual, RW: true }])).toThrow();
  expect(() => assertBackupOperatorMount(directory, true, [configured, configured], [actual])).toThrow();
});
