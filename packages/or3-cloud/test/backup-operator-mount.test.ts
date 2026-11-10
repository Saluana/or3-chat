import { expect, test } from 'bun:test';
import { assertBackupContainerDiff, assertBackupOperatorMount } from '../src/backup/references';

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

test('backup accepts Docker-created mountpoint directories but rejects other writable-layer changes', () => {
  const mounts = [{ Destination: '/run/or3-secrets' }, { Destination: '/vault-data' }];
  expect(() => assertBackupContainerDiff('', mounts)).not.toThrow();
  expect(() => assertBackupContainerDiff('C /run\nA /run/or3-secrets\nA /vault-data\n', mounts)).not.toThrow();
  expect(() => assertBackupContainerDiff('A /run/or3-secrets-client', mounts)).toThrow();
  expect(() => assertBackupContainerDiff('C /run/or3-secrets', mounts)).toThrow();
  expect(() => assertBackupContainerDiff('A /app/server.js', mounts)).toThrow();
  expect(() => assertBackupContainerDiff('A /run/or3-secrets/extra', mounts)).toThrow();
  expect(() => assertBackupContainerDiff('C /run', [])).toThrow();
});
