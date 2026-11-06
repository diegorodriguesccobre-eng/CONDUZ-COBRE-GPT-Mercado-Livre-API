import hashlib, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

out=Path('/tmp/conduz-r1-45-evidence');root=Path('/workspace/conduz-r1-45-fix')
state=json.loads((out/'candidate-state.json').read_text());base=state['base'];mode=sys.argv[1]
def sha(data):return hashlib.sha256(data).hexdigest()
def git(repo,*args,input=None,env=None):return subprocess.check_output(['git','--no-optional-locks','-C',str(repo),*args],input=input,env=env,stderr=subprocess.PIPE)
def snapshot(repo):
    names=sorted(set(filter(None,(git(repo,'ls-files','-z')+git(repo,'ls-files','--others','--exclude-standard','-z')).decode().split('\0'))))
    return {'HEAD':git(repo,'rev-parse','HEAD').decode().strip(),'refs':git(repo,'show-ref').decode(),'status':git(repo,'status','--porcelain=v1','--untracked-files=all').decode(),
      'indexSHA256':sha((repo/'.git/index').read_bytes()),'indexEntriesSHA256':sha(git(repo,'ls-files','--stage','-z')),
      'stagedDiffSHA256':sha(git(repo,'diff','--cached','--binary')),'trackedDiffSHA256':sha(git(repo,'diff','--binary','--full-index')),
      'files':{p:sha((repo/p).read_bytes()) for p in names}}
def original_checkouts():return {p:snapshot(Path(p)) for p in json.loads((out/'previous-checkouts-before.json').read_text())}
def semantic(a,b):return all({k:v for k,v in a[p].items() if k!='indexSHA256'}=={k:v for k,v in b[p].items() if k!='indexSHA256'} for p in a)
def confirm():
    assert snapshot(root)['files']==state['all184SHA256']
    assert sha(git(root,'diff','--binary','--full-index'))==state['patchSHA256']
    assert git(root,'rev-parse','HEAD').decode().strip()==base
    subprocess.run(['git','--no-optional-locks','-C',str(root),'diff','--check'],check=True)
def dependency_links(repo):
    for relative in ['node_modules','prototype/mcp-local/node_modules']:
        target=repo/relative;target.mkdir(parents=True)
        for child in (root/relative).iterdir():(target/child.name).symlink_to(child,target_is_directory=child.is_dir())
confirm()
if mode=='prepare':
    repo=out/'committed';assert not repo.exists()
    subprocess.run(['git','clone','--quiet','--no-hardlinks','--no-checkout',str(root),str(repo)],check=True,capture_output=True,timeout=15)
    git(repo,'checkout','--quiet','--detach',base);patch=(out/'candidate.patch').read_bytes()
    git(repo,'apply','--check','-',input=patch);git(repo,'apply','-',input=patch)
    assert snapshot(repo)['files']==state['all184SHA256']
    git(repo,'add','--',*state['modified']);tree=git(repo,'write-tree').decode().strip()
    env={**os.environ,'GIT_AUTHOR_NAME':'Synthetic R145 Validation','GIT_AUTHOR_EMAIL':'r145-validation@example.invalid',
      'GIT_COMMITTER_NAME':'Synthetic R145 Validation','GIT_COMMITTER_EMAIL':'r145-validation@example.invalid',
      'GIT_AUTHOR_DATE':'2001-01-01T00:00:00Z','GIT_COMMITTER_DATE':'2001-01-01T00:00:00Z'}
    commit=git(repo,'commit-tree',tree,'-p',base,'-m','SYNTHETIC R145 COMMITTED CANDIDATE ONLY',env=env).decode().strip()
    git(repo,'checkout','--quiet','--detach',commit);dependency_links(repo)
    assert git(repo,'status','--porcelain')==b'' and snapshot(repo)['files']==state['all184SHA256']
    setup={'repo':str(repo),'commit':commit,'parent':base,'tree':tree,'files':184,'patchSHA256':state['patchSHA256']}
    (out/'setup.json').write_text(json.dumps(setup,indent=2)+'\n');print(json.dumps(setup,indent=2));raise SystemExit(0)
setup=json.loads((out/'setup.json').read_text());repo=Path(setup['repo']) if mode.endswith('-committed') else root
assert mode in ['preservation','legacy-preservation','directed-local','directed-committed','recovery-local','recovery-committed','integration-local','homologation-local','homologation-committed']
assert not (out/(mode+'.log')).exists(),'No opportunistic retry'
if mode.startswith(('recovery-','integration-','homologation-')):
    for previous in ['preservation','legacy-preservation','directed-local','directed-committed']:
        assert json.loads((out/(previous+'-result.json')).read_text())['passed']
if mode=='preservation':command=['node','--test','tests/b4/m21-preservation.node.mjs'];cwd=repo;expected=63;skipped=0
elif mode=='legacy-preservation':command=['node','--test','tests/b4/preservation.node.mjs'];cwd=repo;expected=16;skipped=0
elif mode.startswith('directed-'):
    pattern='^(?:M2.0-FIX: full published descendant retains the checkpoint and selects B4|I2 fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant|I1 fixture: 178 files mixed with the historical 172-file verifier remain refused|I2 fixture: committed candidate starts from the immutable base and selects its matching verifier|R145 fixture: .*)$'
    command=['node','--test','--test-name-pattern='+pattern,'tests/homologation.test.mjs'];cwd=repo/'prototype/mcp-local';expected=7;skipped=0
else:
    group=mode.split('-')[0];command=['node','scripts/ci.mjs','run',group];cwd=repo/'prototype/mcp-local'
    expected={'recovery':116,'integration':82,'homologation':248}[group];skipped=1 if group=='recovery' else 0
previous=original_checkouts();local_before=snapshot(root);source_before=snapshot(repo)
(out/(mode+'-before.json')).write_text(json.dumps({'originals':previous,'local':local_before,'source':source_before},indent=2)+'\n')
started=time.monotonic();env={**os.environ,'GIT_TRACE2_EVENT':str(out/(mode+'-git-trace.jsonl'))}
with (out/(mode+'.log')).open('w') as log:
    process=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    try:code=process.wait(timeout=300);timed_out=False
    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);code=process.wait();timed_out=True
seconds=round(time.monotonic()-started,3)
after=original_checkouts();local_after=snapshot(root);source_after=snapshot(repo)
(out/(mode+'-after.json')).write_text(json.dumps({'originals':after,'local':local_after,'source':source_after},indent=2)+'\n')
text=(out/(mode+'.log')).read_text();counts={}
for key in ['tests','pass','fail','cancelled','skipped','todo']:
    values=re.findall(r'^ℹ '+key+r' (\d+)\s*$',text,re.M);counts[key]=int(values[0]) if len(values)==1 else values
original_children=[json.loads(row) for row in re.findall(r'^I1Q_CI_SUITE (.+)$',text,re.M)]
i2_children=[json.loads(row) for row in re.findall(r'^I2_ID_FIX_SUITE (.+)$',text,re.M)]
r145_children=[json.loads(row) for row in re.findall(r'^R145_CI_SUITE (.+)$',text,re.M)]
report={'command':command,'cwd':str(cwd),'attempts':1,'exit':code,'seconds':seconds,'timeout':timed_out,'limitSeconds':300,'sourceHEAD':source_after['HEAD'],
 'sourceTree':git(repo,'rev-parse','HEAD^{tree}').decode().strip(),'candidatePatchSHA256':state['patchSHA256'],'counts':counts,
 'originalChildren':original_children,'i2RegressionChildren':i2_children,'r145RegressionChildren':r145_children,
 'originalCheckoutsByteIdentical':previous==after,'originalCheckoutsSemanticIntegrity':semantic(previous,after),'localCheckoutByteIdentical':local_before==local_after,'sourceCheckoutByteIdentical':source_before==source_after}
report['passed']=code==0 and not timed_out and counts.get('tests')==expected and counts.get('pass')==expected-skipped and counts.get('skipped')==skipped and all(counts.get(k)==0 for k in ['fail','cancelled','todo']) and semantic(previous,after) and local_before==local_after and source_before==source_after
if mode.startswith('homologation-'):report['passed']=report['passed'] and [r['tests'] for r in original_children]==[62,63,11] and len(i2_children)==1 and i2_children[0]['tests']==3 and len(r145_children)==1 and r145_children[0]['tests']==5
for relative in ['prototype/mcp-local/work/homologation/test-evidence.json','prototype/mcp-local/work/recovery-audit-evidence.json','prototype/mcp-local/work/recovery-coverage.json','prototype/mcp-local/work/recovery-concurrency-evidence.json',
 'prototype/mcp-local/work/i1q-ci/boundaries.tap','prototype/mcp-local/work/i1q-ci/preservation.tap','prototype/mcp-local/work/i1q-ci/i2-identity.tap','prototype/mcp-local/work/i2-id-fix/committed-fixture.tap','prototype/mcp-local/work/r145/committed-fixture.tap']:
    src=repo/relative
    if src.exists():shutil.copyfile(src,out/(mode+'-'+str(Path(relative).parent.name)+'-'+src.name))
(out/(mode+'-result.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)
raise SystemExit(0 if report['passed'] else 1)
