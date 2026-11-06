import hashlib, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

out = Path('/tmp/conduz-i2-id-fix')
dev = Path('/workspace/conduz-i2-identity')
state = json.loads((out / 'reviewed-state.json').read_text())
base = state['base']

def sha(data): return hashlib.sha256(data).hexdigest()
def git(repo, *args, input=None, env=None):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(repo), *args], input=input, env=env, stderr=subprocess.PIPE)
def snapshot(repo):
    names = sorted(set(filter(None, (git(repo, 'ls-files', '-z') + git(repo, 'ls-files', '--others', '--exclude-standard', '-z')).decode().split('\0'))))
    return {'HEAD': git(repo, 'rev-parse', 'HEAD').decode().strip(), 'refs': git(repo, 'show-ref').decode(),
            'status': git(repo, 'status', '--porcelain=v1', '--untracked-files=all').decode(),
            'indexSHA256': sha((repo / '.git/index').read_bytes()), 'indexEntriesSHA256': sha(git(repo, 'ls-files', '--stage', '-z')),
            'stagedDiffSHA256': sha(git(repo, 'diff', '--cached', '--binary')), 'trackedDiffSHA256': sha(git(repo, 'diff', '--binary', '--full-index')),
            'files': {p: sha((repo / p).read_bytes()) for p in names}}
def monitored():
    return {str(p): snapshot(p) for p in [dev, Path('/workspace/CONDUZ-COBRE-GPT-Mercado-Livre-API'), Path('/workspace/conduz-i1-handle-fix')]}
def differences(a, b):
    return {p: {k: {'before': a[p][k], 'after': b[p][k]} for k in a[p] if a[p][k] != b[p][k]} for p in a}
def semantic_equal(a, b):
    return all({k:v for k,v in a[p].items() if k != 'indexSHA256'} == {k:v for k,v in b[p].items() if k != 'indexSHA256'} for p in a)
def clone(source, target, ref):
    subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(source), str(target)], check=True, capture_output=True, timeout=15)
    git(target, 'checkout', '--quiet', '--detach', ref)
    assert not (target / '.git/objects/info/alternates').exists()
def dependencies(target):
    for relative in ['node_modules', 'prototype/mcp-local/node_modules']:
        installed = dev / relative; destination = target / relative; destination.mkdir(parents=True)
        for child in installed.iterdir(): (destination / child.name).symlink_to(child, target_is_directory=child.is_dir())
def confirm_development():
    s = snapshot(dev)
    assert s['HEAD'] == base and s['files'] == state['all184SHA256'] and len(s['files']) == 184
    assert sha((out / 'complete.patch').read_bytes()) == state['patchSHA256']
    subprocess.run(['git', '--no-optional-locks', '-C', str(dev), 'diff', '--check'], check=True)

mode = sys.argv[1]
confirm_development()
if mode == 'prepare':
    patch = (out / 'complete.patch').read_bytes()
    repos = {n: out / n for n in ['historical-base', 'uncommitted', 'committed']}
    for name, repo in repos.items():
        assert not repo.exists()
        clone(dev, repo, base)
        if name != 'historical-base':
            git(repo, 'apply', '--check', '-', input=patch); git(repo, 'apply', '-', input=patch)
            assert snapshot(repo)['files'] == state['all184SHA256']
        dependencies(repo)
    repo = repos['committed']; paths = state['modifiedFiles'] + state['newFiles']
    git(repo, 'add', '--', *paths)
    assert git(repo, 'diff', '--cached', '--name-only').decode().splitlines() == sorted(paths)
    tree = git(repo, 'write-tree').decode().strip()
    env = {**os.environ, 'GIT_AUTHOR_NAME': 'Synthetic I2-ID-FIX', 'GIT_AUTHOR_EMAIL': 'i2-id-fix@example.invalid',
           'GIT_COMMITTER_NAME': 'Synthetic I2-ID-FIX', 'GIT_COMMITTER_EMAIL': 'i2-id-fix@example.invalid',
           'GIT_AUTHOR_DATE': '2001-01-01T00:00:00Z', 'GIT_COMMITTER_DATE': '2001-01-01T00:00:00Z'}
    commit = git(repo, 'commit-tree', tree, '-p', base, '-m', 'SYNTHETIC I2-ID-FIX COMMITTED CANDIDATE ONLY', env=env).decode().strip()
    git(repo, 'checkout', '--quiet', '--detach', commit)
    assert git(repo, 'rev-parse', 'HEAD^').decode().strip() == base and git(repo, 'status', '--porcelain') == b''
    assert len(git(repo, 'ls-files', '-z').split(b'\0'))-1 == 184 and snapshot(repo)['files'] == state['all184SHA256']
    setup = {'base': base, 'syntheticCommit': commit, 'syntheticParent': base, 'syntheticTree': tree, 'files': 184,
             'paths': paths, 'repos': {n:str(p) for n,p in repos.items()}}
    (out / 'setup.json').write_text(json.dumps(setup, indent=2)+'\n')
    print(json.dumps(setup, indent=2)); raise SystemExit(0)

setup = json.loads((out / 'setup.json').read_text())
assert mode in ['directed-historical-base', 'directed-uncommitted', 'directed-committed', 'homologation-local', 'homologation-committed']
assert not (out / (mode + '.log')).exists(), 'No opportunistic retry'
if mode.startswith('homologation-'):
    for name in ['historical-base','uncommitted','committed']:
        prior=json.loads((out / ('directed-'+name+'-result.json')).read_text()); assert prior['passed']
    if mode == 'homologation-committed': assert json.loads((out / 'homologation-local-result.json').read_text())['passed']
    repo = dev if mode == 'homologation-local' else Path(setup['repos']['committed'])
    command = ['node','scripts/ci.mjs','run','homologation']; expected = 245
else:
    name = mode.removeprefix('directed-'); repo = Path(setup['repos'][name])
    pattern = '^(?:M2.0-FIX: full published descendant retains the checkpoint and selects B4|I[12] fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant|I1 fixture: 178 files mixed with the historical 172-file verifier remain refused|I2 fixture: committed candidate starts from the immutable base and selects its matching verifier)$'
    command = ['node','--test','--test-name-pattern='+pattern,'tests/homologation.test.mjs']; expected = 3 if name == 'historical-base' else 4
before = monitored(); repo_before = snapshot(repo)
(out / (mode+'-before.json')).write_text(json.dumps(before,indent=2)+'\n')
trace = out / (mode+'-git-trace.jsonl'); assert not trace.exists()
env = {**os.environ, 'GIT_TRACE2_EVENT': str(trace)}
started = time.monotonic()
with (out / (mode+'.log')).open('w') as log:
    process = subprocess.Popen(command, cwd=repo/'prototype/mcp-local', env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try: code = process.wait(timeout=300); timed_out=False
    except subprocess.TimeoutExpired:
        os.killpg(process.pid,signal.SIGKILL); code=process.wait(); timed_out=True
seconds=round(time.monotonic()-started,3)
after=monitored(); repo_after=snapshot(repo)
(out/(mode+'-after.json')).write_text(json.dumps(after,indent=2)+'\n')
text=(out/(mode+'.log')).read_text(); counts={}
for key in ['tests','pass','fail','cancelled','skipped','todo']:
    values=re.findall(r'^ℹ '+key+r' (\d+)\s*$',text,re.M); counts[key]=int(values[0]) if len(values)==1 else values
children=[json.loads(row) for row in re.findall(r'^I1Q_CI_SUITE (.+)$',text,re.M)]
nested=[json.loads(row) for row in re.findall(r'^I2_ID_FIX_SUITE (.+)$',text,re.M)]
report={'command':command,'cwd':str(repo/'prototype/mcp-local'),'attempts':1,'exit':code,'timeout':timed_out,'limitSeconds':300,'seconds':seconds,
        'expectedTests':expected,'counts':counts,'children':children,'newNestedRegression':nested,
        'monitoredByteIdentical':before==after,'monitoredSemanticIntegrity':semantic_equal(before,after),'indexVariations':differences(before,after),
        'sourceByteIdentical':repo_before==repo_after,'sourceSemanticIntegrity':semantic_equal({'repo':repo_before},{'repo':repo_after}),
        'sourceHEAD':repo_after['HEAD'],'sourceIndexSHA256':repo_after['indexSHA256']}
report['passed']=code==0 and not timed_out and counts.get('tests')==expected and counts.get('pass')==expected and all(counts.get(k)==0 for k in ['fail','cancelled','skipped','todo']) and report['monitoredSemanticIntegrity'] and report['sourceSemanticIntegrity']
if mode.startswith('homologation-'):
    report['passed']=report['passed'] and [r['tests'] for r in children]==[62,54,11] and len(nested)==1 and nested[0]['tests']==3 and nested[0]['pass']==3
evidence=repo/'prototype/mcp-local/work/homologation/test-evidence.json'
if evidence.exists(): shutil.copyfile(evidence,out/(mode+'-test-evidence.json'))
for relative in ['work/i2-id-fix/committed-fixture.tap','work/i1q-ci/boundaries.tap','work/i1q-ci/preservation.tap','work/i1q-ci/i2-identity.tap']:
    p=repo/'prototype/mcp-local'/relative
    if p.exists(): shutil.copyfile(p,out/(mode+'-'+p.name))
(out/(mode+'-result.json')).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2),flush=True)
raise SystemExit(0 if report['passed'] else 1)
