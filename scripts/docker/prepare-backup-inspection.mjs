import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { INSPECTION_PROFILE, S3_INSPECTION_PROFILE, HISTORY_SQLITE_VERSION, HISTORY_MIGRATIONS, assertInspectionProfile, assertS3InspectionProfile } from './backup-inspect.mjs';
import { dockerProfile } from './prepare-manifest.mjs';

const installed = name => JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
const selected = dockerProfile();
let profile;
if (selected === 'basic-sqlite-fs') {
  profile = { contract: INSPECTION_PROFILE.contract,
    sqlite: installed('or3-provider-sqlite'), filesystem: installed('or3-provider-fs') };
  assertInspectionProfile(profile);
} else {
  const versions = JSON.parse(readFileSync(new URL('../../packages/create-or3-chat/first-party-versions.json', import.meta.url), 'utf8'));
  const sqlite = installed('or3-provider-sqlite');
  const s3 = installed('or3-provider-s3');
  if (sqlite !== INSPECTION_PROFILE.sqlite || s3 !== versions['or3-provider-s3']) {
    throw new Error('Unsupported launch backup inspection provider versions');
  }
  // This describes the image's inspection capability; managed S3 operations
  // remain gated until their complete restore path is qualified.
  profile = { contract: S3_INSPECTION_PROFILE.contract, sqlite, s3 };
  assertS3InspectionProfile(profile);
}
// Describe the exact testable runtime; mandatory candidate/browser lifecycle
// qualification still gates publication. A receipt cannot be required to enable
// the capability that the same candidate workflow must exercise.
const historyReady = selected === 'basic-sqlite-fs' && profile.sqlite === HISTORY_SQLITE_VERSION;
profile.historyIncarnation = historyReady ? 'v1' : 'unqualified';
if (historyReady) {
  profile.historyMigrations = HISTORY_MIGRATIONS;
  profile.legacySnapshotRollback = 'legacy-033-rollback-v1';
}
profile.healthValidation = selected === 'basic-sqlite-fs' ? 'health-only-v1' : 'unqualified';
writeFileSync('scripts/docker/backup-inspection-profile.json', JSON.stringify(profile) + '\n');

// Target-owned plain-Node reader: build from the same schemas/classifier as the
// runtime, including legacy normalization and its payload ceiling. No TS loader
// or developer aliases are needed in the offline image.
await build({
  stdin: {
    contents: `export { incomingRecordDefect, isSyncTable } from './shared/sync/incoming-records';
      export { ChangeStampSchema, SnapshotRevisionSchema, SyncRecordIdentifierSchema } from './shared/sync/schemas';`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    sourcefile: 'backup-read-classifier.ts', loader: 'ts',
  },
  bundle: true, platform: 'node', target: 'node24', format: 'cjs',
  outfile: 'scripts/docker/backup-read-classifier.cjs',
});
