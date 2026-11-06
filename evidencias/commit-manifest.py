import hashlib, json, re, subprocess
from pathlib import Path

out = Path('/tmp/conduz-i2-id-fix')
records = {}
trace_sources = sorted(out.glob('*-git-trace.jsonl'))
for path in trace_sources:
    events = [json.loads(line) for line in path.read_text().splitlines()]
    exits = {row['sid']: row['code'] for row in events if row.get('event') == 'exit'}
    successful_args = [row.get('argv', []) for row in events if row.get('event') == 'start' and exits.get(row['sid']) == 0]
    for event in events:
        args = event.get('argv', [])
        if event.get('event') != 'start' or 'commit-tree' not in args: continue
        assert exits[event['sid']] == 0
        n = args.index('commit-tree'); tree = args[n+1]; parents = []; message = None; n += 2
        while n < len(args):
            if args[n] == '-p':
                if args[n+1] not in parents: parents.append(args[n+1])
                n += 2
            elif args[n] == '-m': message = args[n+1]; n += 2
            else: raise RuntimeError('Unexpected commit-tree argument')
        assert message.startswith('SYNTHETIC ')
        body = ('tree '+tree+'\n'+''.join('parent '+p+'\n' for p in parents)
                +'author Synthetic M2.0 Fixture <m20@example.invalid> 978307200 +0000\n'
                +'committer Synthetic M2.0 Fixture <m20@example.invalid> 978307200 +0000\n\n'+message+'\n').encode()
        oid = hashlib.sha1(b'commit '+str(len(body)).encode()+b'\0'+body).hexdigest()
        # A successful later Git operation must actually refer to this object.
        assert any(oid in argv for argv in successful_args), 'Derived commit not corroborated by Git use'
        record = records.setdefault(oid, {'sha':oid,'tree':tree,'parents':parents,'message':message,
            'identity':'Synthetic M2.0 Fixture <m20@example.invalid>','timestamp':'2001-01-01T00:00:00Z',
            'provenance':'SHA reconstructed from native successful Git Trace2 commit-tree arguments and fixed fixture identity/date; corroborated by successful Git references and snapshot reports where available.',
            'traces':[]})
        if path.name not in record['traces']: record['traces'].append(path.name)
setup = json.loads((out/'setup.json').read_text())
repo = Path(setup['repos']['committed'])
raw = subprocess.check_output(['git','--no-optional-locks','-C',str(repo),'cat-file','commit',setup['syntheticCommit']])
assert hashlib.sha1(b'commit '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == setup['syntheticCommit']
records[setup['syntheticCommit']] = {'sha':setup['syntheticCommit'],'tree':setup['syntheticTree'],'parents':[setup['base']],
    'message':'SYNTHETIC I2-ID-FIX COMMITTED CANDIDATE ONLY','provenance':'Direct git commit-tree result, rev-parse and cat-file object validation in isolated candidate repository.'}
for path in out.glob('*-test-evidence.json'):
    evidence=json.loads(path.read_text())
    for row in evidence.get('preservationRouting',[]):
        snapshot=row.get('candidateSnapshot')
        if snapshot:
            record=records[snapshot['commit']]
            assert record['tree']==snapshot['tree'] and record['parents']==[snapshot['parent']]
            record.setdefault('snapshotReports',[]).append(path.name)
    for row in evidence.get('i2CommittedFixtureEvidence',[]):
        record=records[row['sourceHead']]
        assert record['tree']==row['sourceTree'] and record['parents']==[row['sourceParent']]
manifest={'allRepositoriesDisposable':True,'noDevelopmentCommit':True,'records':list(records.values())}
(out/'synthetic-commits.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'uniqueSyntheticCommits':len(records),'records':list(records.values())},indent=2))
