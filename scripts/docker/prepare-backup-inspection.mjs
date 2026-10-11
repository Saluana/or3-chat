import { readFileSync, writeFileSync } from 'node:fs';
import { INSPECTION_PROFILE, assertInspectionProfile } from './backup-inspect.mjs';
const profile = { contract: INSPECTION_PROFILE.contract,
  sqlite: JSON.parse(readFileSync('node_modules/or3-provider-sqlite/package.json', 'utf8')).version,
  filesystem: JSON.parse(readFileSync('node_modules/or3-provider-fs/package.json', 'utf8')).version };
assertInspectionProfile(profile);
writeFileSync('scripts/docker/backup-inspection-profile.json', JSON.stringify(profile) + '\n');
