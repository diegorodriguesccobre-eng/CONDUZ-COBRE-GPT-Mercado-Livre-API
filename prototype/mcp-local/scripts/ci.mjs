import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const sub=fileURLToPath(new URL('..',import.meta.url)),root=resolve(sub,'../..');
export const suites={
 mcp:{files:['hardening.test.mjs','interoperability.test.mjs'],commands:[['npm','run','typecheck'],['npm','run','build:local'],['node','--test','tests/interoperability.test.mjs','tests/hardening.test.mjs']]},
 persistence:{files:['persistence.test.mjs'],typecheck:'tsconfig.persistence.json',commands:[['node','--test','tests/persistence.test.mjs']]},
 recovery:{files:['recovery.test.mjs'],typecheck:'tsconfig.recovery.json',commands:[['node','--test','tests/recovery.test.mjs']]},
 vault:{files:['vault-isolation.test.mjs'],typecheck:'tsconfig.vault.json',commands:[['node','--test','tests/vault-isolation.test.mjs']]},
 integration:{files:['integration.test.mjs','query-classification.test.mjs','homologation.test.mjs'],typecheck:'tsconfig.integration.json',commands:[['node','--test','tests/integration.test.mjs','tests/query-classification.test.mjs'],['npm','exec','--','tsc','--noEmit','-p','tsconfig.homologation.json'],['node','--test','tests/homologation.test.mjs']]},
 buffering:{files:[],typecheck:'tsconfig.integration.json',commands:[['node','scripts/prove-buffering.mjs']]},
 regression:{files:[],commands:[['npm','run','typecheck'],['npm','test'],['node','scripts/tooling.mjs','test','--config','vitest.b3.config.ts'],['npm','run','test:registry'],['node','--test','tests/b4/preservation.node.mjs'],['node','scripts/verify-b4-preservation.mjs'],['node','scripts/audit-cloudflare-bundles.mjs'],['npm','run','audit:workspace']]}
};
export function verifyInventory(){
 assert.equal(process.version,'v24.22.1','Unreviewed Node runtime');assert.equal(process.versions.undici,'7.30.1');
 const expected=Object.values(suites).flatMap(s=>s.files).sort();assert.equal(new Set(expected).size,expected.length);
 const actual=readdirSync(resolve(sub,'tests'),{recursive:true}).filter(n=>n.endsWith('.test.mjs')).map(n=>n.replaceAll('\\','/')).sort();assert.deepEqual(actual,expected);
 for(const [name,s] of Object.entries(suites))for(const file of s.files)assert.ok(s.commands.some(args=>args.includes('tests/'+file)),'Missing execution: '+name+'/'+file);
 assert.ok(suites.integration.commands.some(args=>JSON.stringify(args)==='["npm","exec","--","tsc","--noEmit","-p","tsconfig.homologation.json"]'),'Missing M1 typecheck');
 assert.ok(suites.integration.commands.some(args=>JSON.stringify(args)==='["node","--test","tests/homologation.test.mjs"]'),'Missing M1 execution');
 for(const n of ['scripts/prove-buffering.mjs','tests/fixtures/buffering-worker.ts'])assert.ok(existsSync(resolve(sub,n)),'Missing independent probe');
 assert.ok(existsSync(resolve(root,'tests/b4/preservation.node.mjs')));
 const workflow=readFileSync(resolve(root,'.github/workflows/b4-mcp-local.yml'),'utf8');
 const matrix=workflow.match(/^\s*suite: \[([^\]]+)\]/m);assert.ok(matrix);assert.deepEqual(matrix[1].split(',').map(x=>x.trim()),Object.keys(suites));
 assert.ok(workflow.includes('run: node scripts/ci.mjs run "${{ matrix.suite }}"'));
 assert.match(workflow,/node-version: '24\.22\.1'/);assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);
 assert.doesNotMatch(workflow,/pull_request_target|secrets\.|(?:contents|id-token):\s*write|wrangler deploy/);
 return {testFiles:actual,suiteGroups:Object.keys(suites),independentBufferingCases:14,rootPreservationTests:true};
}
async function command(args,cwd){
 const [name,...rest]=args,executable=name==='node'?process.execPath:name;
 const exit=await new Promise((ok,reject)=>{const p=spawn(executable,rest,{cwd,env:process.env,stdio:'inherit'});p.on('error',reject);p.on('close',(code,signal)=>ok({code,signal}));});
 if(exit.code!==0||exit.signal)throw new Error('CI_COMMAND_FAILED:'+name);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const action=process.argv[2];const inventory=verifyInventory();
  if(action==='verify'&&process.argv.length===3)console.log(JSON.stringify(inventory));
  else if(action==='run'&&process.argv.length===4&&Object.hasOwn(suites,process.argv[3])){
   const name=process.argv[3],s=suites[name];if(s.typecheck)await command(['npm','exec','--','tsc','--noEmit','-p',s.typecheck],sub);
   for(const args of s.commands)await command(args,name==='regression'?root:sub);
  }else throw new Error('UNKNOWN_CI_GROUP');
 }catch(e){console.error(e instanceof Error?e.message:'CI_FAILED');process.exitCode=1;}
}
