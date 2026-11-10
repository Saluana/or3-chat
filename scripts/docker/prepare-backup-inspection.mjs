import { readFileSync, writeFileSync } from 'node:fs';
import { INSPECTION_PROFILE, S3_INSPECTION_PROFILE, assertInspectionProfile, assertS3InspectionProfile } from './backup-inspect.mjs';
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
writeFileSync('scripts/docker/backup-inspection-profile.json', JSON.stringify(profile) + '\n');
