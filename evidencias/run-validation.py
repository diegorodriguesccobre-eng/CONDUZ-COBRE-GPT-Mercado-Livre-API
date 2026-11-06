import hashlib, json, os, re, signal, subprocess, sys, time
from pathlib import Path

root = Path('/workspace/conduz-i2-identity')
out = Path('/tmp/conduz-i2-fixture-fix')
state = json.loads((out / 'reviewed-state.json').read_text())
mode = sys.argv[1]
assert mode in ['directed', 'homologation']
if mode == 'homologation':
    prior = json.loads((out / 'directed-result.json').read_text())
    assert prior['exit'] == 0 and prior['unchanged'] and prior['counts']['pass'] == 1
assert not (out / (mode + '.log')).exists(), 'No repeated execution permitted'

def git(repo, *args):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(repo), *args])

def digest(data):
    return hashlib.sha256(data).hexdigest()

def snapshot(repo):
    names = sorted(set(filter(None, (git(repo, 'ls-files', '-z') + git(repo, 'ls-files', '--others', '--exclude-standard', '-z')).decode().split('\0'))))
    return {'head': git(repo, 'rev-parse', 'HEAD').decode().strip(),
            'refs': git(repo, 'show-ref').decode(),
            'status': git(repo, 'status', '--porcelain=v1', '--untracked-files=all').decode(),
            'indexDiffSHA256': digest(git(repo, 'diff', '--cached', '--binary')),
            'files': {p: digest((repo / p).read_bytes()) for p in names}}

def patch():
    data = git(root, 'diff', '--binary', '--full-index', '--', *state['modifiedFiles'])
    for name in state['newFiles']:
        result = subprocess.run(['git', 'diff', '--no-index', '--binary', '--full-index', '--', '/dev/null', name], cwd=root, capture_output=True)
        assert result.returncode == 1
        data += result.stdout
    return data

repos = [root, Path('/workspace/CONDUZ-COBRE-GPT-Mercado-Livre-API'), Path('/workspace/conduz-i1-handle-fix')]
before = {str(p): snapshot(p) for p in repos}
assert before[str(root)]['head'] == state['base']
assert len(before[str(root)]['files']) == 184
assert all(before[str(root)]['files'][p] == h for p, h in state['SHA256'].items())
assert digest(patch()) == state['patchSHA256']
assert patch() == (out / 'complete.patch').read_bytes()
subprocess.run(['git', '-C', str(root), 'diff', '--check'], check=True)
(out / (mode + '-before.json')).write_text(json.dumps(before, indent=2) + '\n')
command = (['node', '--test', '--test-name-pattern=^I2 fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant$', 'tests/homologation.test.mjs']
           if mode == 'directed' else ['node', 'scripts/ci.mjs', 'run', 'homologation'])
started = time.monotonic()
with (out / (mode + '.log')).open('w') as log:
    process = subprocess.Popen(command, cwd=root / 'prototype/mcp-local', stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        code = process.wait(timeout=300)
        timed_out = False
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        code = process.wait()
        timed_out = True
elapsed = round(time.monotonic() - started, 3)
after = {str(p): snapshot(p) for p in repos}
(out / (mode + '-after.json')).write_text(json.dumps(after, indent=2) + '\n')
text = (out / (mode + '.log')).read_text()
counts = {}
for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
    values = re.findall(r'^ℹ ' + key + r' (\d+)\s*$', text, re.M)
    counts[key] = int(values[-1]) if len(values) == 1 else values
children = [json.loads(row) for row in re.findall(r'^I1Q_CI_SUITE (.+)$', text, re.M)]
report = {'command': command, 'attempts': 1, 'exit': code, 'seconds': elapsed,
          'timeout': timed_out, 'limitSeconds': 300, 'counts': counts, 'children': children,
          'unchanged': before == after, 'patchUnchanged': digest(patch()) == state['patchSHA256'],
          'patchSHA256': digest(patch())}
(out / (mode + '-result.json')).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2), flush=True)
raise SystemExit(0 if code == 0 and not timed_out and before == after and report['patchUnchanged'] else 1)
