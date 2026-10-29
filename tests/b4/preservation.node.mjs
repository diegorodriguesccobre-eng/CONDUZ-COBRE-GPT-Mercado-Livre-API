import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot,validateSnapshot,EXCEPTIONS} from '../../scripts/verify-b4-preservation.mjs';
const original=collectSnapshot();
const expectedRefusal={"fourth historical exception": "HISTORICAL_CHANGED:src/b3/adapter.ts", "historical deletion": "CANDIDATE_INVENTORY", "unexpected publication file": "CANDIDATE_INVENTORY", "unapproved direct dependency": "APPROVED_DEPENDENCY_CHANGED:package.json", "package script injection": "APPROVED_DEPENDENCY_CHANGED:package.json", "unapproved override": "APPROVED_DEPENDENCY_CHANGED:package.json", "root lock drift": "APPROVED_DEPENDENCY_CHANGED:package-lock.json", "MCP lock drift": "APPROVED_DEPENDENCY_CHANGED:prototype/mcp-local/package-lock.json", "SQLite test removal": "SQLITE_CHANGE_NOT_ALLOWED", "SQLite branch bypass": "SQLITE_CHANGE_NOT_ALLOWED", "original verifier modification": "HISTORICAL_CHANGED:scripts/verify-b3-preservation.mjs", "production activation": "HISTORICAL_CHANGED:src/preparation/config.ts", "readiness activation": "HISTORICAL_CHANGED:config/b3-readiness.json", "divergent base": "BASE_DIVERGED"};
const copy=()=>({...original,current:new Map(original.current),historical:new Map(original.historical),base:new Map(original.base)});
test('B4 preservation accepts only the approved 94/97 and three exceptions',()=>{
 const r=validateSnapshot(copy());assert.equal(r.byteIdentical,94);assert.deepEqual(r.exceptions,EXCEPTIONS);assert.equal(r.activationBlocked,true);
});
for(const [label,mutate] of [
 ['fourth historical exception',s=>s.current.set('src/b3/adapter.ts',s.current.get('src/b3/adapter.ts')+'\n')],
 ['historical deletion',s=>s.current.delete('src/b3/adapter.ts')],
 ['unexpected publication file',s=>s.current.set('private-backup.zip','synthetic')],
 ['unapproved direct dependency',s=>s.current.set('package.json',s.current.get('package.json').toString().replace('4.153.0','4.154.0'))],
 ['package script injection',s=>s.current.set('package.json',s.current.get('package.json').toString().replace('"scripts": {','"scripts": {"postinstall":"unexpected",'))],
 ['unapproved override',s=>{const p=JSON.parse(s.current.get('package.json'));p.overrides={undici:'7.29.1'};s.current.set('package.json',JSON.stringify(p));}],
 ['root lock drift',s=>s.current.set('package-lock.json',s.current.get('package-lock.json')+'\n')],
 ['MCP lock drift',s=>s.current.set('prototype/mcp-local/package-lock.json',s.current.get('prototype/mcp-local/package-lock.json')+'\n')],
 ['SQLite test removal',s=>s.current.set('.github/workflows/b3-sqlite.yml',s.current.get('.github/workflows/b3-sqlite.yml').toString().replace('      - run: node scripts/tooling.mjs test --config vitest.b3.config.ts\n',''))],
 ['SQLite branch bypass',s=>s.current.set('.github/workflows/b3-sqlite.yml',s.current.get('.github/workflows/b3-sqlite.yml').toString().replace('if [[ "$B4_PRESERVATION" == "true" ]]','if [[ "true" == "true" ]]'))],
 ['original verifier modification',s=>s.current.set('scripts/verify-b3-preservation.mjs','process.exit(0)')],
 ['production activation',s=>s.current.set('src/preparation/config.ts',s.current.get('src/preparation/config.ts').toString().replace('LIVE_TRANSPORT_ENABLED = false','LIVE_TRANSPORT_ENABLED = true'))],
 ['readiness activation',s=>{const p=JSON.parse(s.current.get('config/b3-readiness.json'));p.deploymentAuthorized=true;s.current.set('config/b3-readiness.json',JSON.stringify(p));}],
 ['divergent base',s=>{s.ancestor=false;}]
]) test('B4 preservation rejects '+label,()=>{const s=copy();mutate(s);assert.throws(()=>validateSnapshot(s),e=>e instanceof Error && e.constructor.name==='PreservationFailure' && e.message===expectedRefusal[label]);});

test('B4 preservation compares raw bytes rather than UTF-8 replacement characters',()=>{
 const s=copy(),p='src/b3/adapter.ts',original=Buffer.from(s.historical.get(p));
 const valid=Buffer.concat([original,Buffer.from([0xef,0xbf,0xbd])]);
 const invalid=Buffer.concat([original,Buffer.from([0xff])]);
 assert.equal(valid.toString(),invalid.toString());
 s.historical.set(p,valid);s.base.set(p,valid);s.current.set(p,invalid);
 assert.throws(()=>validateSnapshot(s),/HISTORICAL_CHANGED/);
});
