"""Verify final clean HEAD and export local portable source/evidence; no remote actions."""
import hashlib
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parents[2]
os.chdir(root)
evidence = root / 'audit-evidence/workspace-isolation-20261011'
base = 'df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5'


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.STDOUT)


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


head = git('rev-parse', 'HEAD').decode().strip()
if git('status', '--porcelain').strip():
    raise RuntimeError('Final exports require a clean committed worktree')
receipts = ['final-head-verification-runner.txt', 'final-head-typecheck-runner.txt',
            'final-head-lint-runner.txt', 'final-head-browser-runner.txt']
for name in receipts:
    receipt = (evidence / name).read_text()
    if not receipt.startswith(f'Commit: {head}\n') or not receipt.rstrip().endswith('Exit status: 0'):
        raise RuntimeError(f'{name} does not qualify this exact HEAD successfully')

patch = evidence / 'workspace-isolation-source.patch'
patch.write_bytes(git('diff', '--binary', base, head, '--', 'app', 'server', 'public', 'vitest.config.ts'))
fd, bundle_name = tempfile.mkstemp(prefix='final-review-', suffix='.bundle', dir=evidence)
os.close(fd)
os.unlink(bundle_name)
try:
    git('bundle', 'create', bundle_name, f'{base}..HEAD')
    bundle_receipt = git('bundle', 'verify', bundle_name).decode()
    os.replace(bundle_name, evidence / 'workspace-isolation-source.bundle')
finally:
    if os.path.exists(bundle_name):
        os.unlink(bundle_name)
worktree = Path(tempfile.mkdtemp(prefix='or3-final-review-check-'))
worktree.rmdir()
try:
    git('worktree', 'add', '--detach', str(worktree), base)
    subprocess.check_call(['git', 'apply', '--check', str(patch)], cwd=worktree)
finally:
    git('worktree', 'remove', '--force', str(worktree))

count = git('rev-list', '--count', f'{base}..{head}').decode().strip()
(evidence / 'final-commits-runner.txt').write_bytes(
    f'Base: {base}\nFinal HEAD: {head}\nLocal commits: {count}\n'.encode() +
    git('log', '--reverse', '--format=%H %s', f'{base}..{head}'))
(evidence / 'final-changed-files-runner.txt').write_bytes(
    f'Base: {base}\nFinal HEAD: {head}\nSource/test/docs map:\n'.encode() +
    git('diff', '--name-status', base, head, '--', 'app', 'server', 'public', 'vitest.config.ts') +
    b'\nComplete file statistics, including reproducible evidence:\n' +
    git('diff', '--stat', base, head))
snapshot = evidence / 'final-review-export-runner.txt'
snapshot.write_text(f'Base: {base}\nFinal HEAD: {head}\nLocal commits: {count}\n'
    'Worktree clean; all four exact-HEAD receipts exit0.\n'
    'Patch applies cleanly at exact base; disposable worktree removed.\n'
    'No push, merge, deployment, release or external publication.\n' + bundle_receipt)

tracked = git('ls-files', 'audit-evidence/workspace-isolation-20261011').decode().splitlines()
files = [root / name for name in tracked]
files += [evidence / name for name in receipts + ['final-commits-runner.txt',
    'final-changed-files-runner.txt', 'final-review-export-runner.txt']]
archive = evidence / 'workspace-isolation-evidence.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for path in sorted(set(files)):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f'Unexpected evidence input: {path}')
        tar.add(path, arcname=str(path.relative_to(root)), recursive=False)
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    if len(members) != len(set(files)):
        raise RuntimeError('Archive input/member count mismatch')
    for member in members:
        content = tar.extractfile(member)
        if not member.isfile() or content is None or content.read() != (root / member.name).read_bytes():
            raise RuntimeError(f'Evidence archive verification failed: {member.name}')

lines = [f'Base: {base}', f'Final HEAD: {head}', f'Local commits: {count}',
         f'Evidence archive: {len(members)} verified file members', 'SHA-256:']
for name in ['workspace-isolation-source.patch', 'workspace-isolation-source.bundle', archive.name]:
    lines.append(checksum(evidence / name) + '  ' + name)
(evidence / 'final-artifact-checksums-runner.txt').write_text('\n'.join(lines) + '\n')
if git('status', '--porcelain').strip():
    raise RuntimeError('Finalization changed tracked worktree state')
print(f'Verified final clean HEAD {head}; {count} commits; {len(members)} evidence files. Local exports only.')
