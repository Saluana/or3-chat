"""Create local Git review exports and check against the pinned base; no remote actions."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
os.chdir(root)
evidence = root / 'audit-evidence/workspace-isolation-20261011'
base = 'df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5'
latest_runtime = '3f024d9c4107ac9743cedee419c83f4360ee2cef'

def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.STDOUT)

head = git('rev-parse', 'HEAD').decode().strip()
count = git('rev-list', '--count', f'{base}..{head}').decode().strip()
patch = evidence / 'workspace-isolation-source.patch'
patch.write_bytes(git('diff', '--binary', base, head, '--', 'app', 'server', 'public', 'vitest.config.ts'))
fd, name = tempfile.mkstemp(prefix='review-', suffix='.bundle', dir=evidence)
os.close(fd)
os.unlink(name)
try:
    git('bundle', 'create', name, f'{base}..HEAD')
    verified = '\n'.join(line.rstrip() for line in git('bundle', 'verify', name).decode().splitlines()) + '\n'
    os.replace(name, evidence / 'workspace-isolation-source.bundle')
finally:
    if os.path.exists(name):
        os.unlink(name)
worktree = Path(tempfile.mkdtemp(prefix='or3-review-check-'))
worktree.rmdir()
try:
    git('worktree', 'add', '--detach', str(worktree), base)
    subprocess.check_call(['git', 'apply', '--check', str(patch)], cwd=worktree)
finally:
    git('worktree', 'remove', '--force', str(worktree))
(evidence / 'review-export-check.txt').write_text(
    f'Source/test export head: {head}\nRequired base: {base}\n'
    f'Local commits: {count}\nPatch applies cleanly at exact base in disposable worktree.\n'
    f'Disposable worktree removed.\n{verified}')
lines = [f'Host source/test review head: {head}', f'Latest runtime fix: {latest_runtime}',
         f'Required base: {base}', f'Git bundle verify: passed; HEAD ref {head}; {count} local commits; SHA-1 object format.',
         'Local review exports only; no publication/package release. Includes all committed host SDK isolation fixes.',
         'SHA-256 file checksums:']
for filename in ['workspace-isolation-source.patch', 'workspace-isolation-source.bundle']:
    lines.append(hashlib.sha256((evidence / filename).read_bytes()).hexdigest() + '  ' + filename)
(evidence / 'artifact-checksums.txt').write_text('\n'.join(lines) + '\n')
p = evidence / 'README.md'
s = re.sub(r'Current source/test review export head: `[^`]+`', f'Current source/test review export head: `{head}`', p.read_text())
s = re.sub(r'(source, test and documentation changes.*? through )`[^`]+`', rf'\g<1>`{head}`', s)
s = re.sub(r'carries the \d+ local commits', f'carries the {count} local commits', s)
p.write_text(s)
print(f'Local review exports verified at {head}; {count} commits. No remote actions.')
