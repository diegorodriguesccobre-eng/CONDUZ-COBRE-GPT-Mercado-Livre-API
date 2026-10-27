import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('work',{recursive:true});
await build({stdin:{contents:"export {classifyReadFailure} from './integration/read-failure.ts'; export {AppError} from '../../src/errors.ts'; export {ReadDependencyFailure, ReadTokenFailure} from './vault/read-core.ts'; export {IntegrationFailure} from './integration/contracts.ts'; export {TokenCoordinator} from '../../src/b3/token-service.ts'; export {CandidateAdapter} from '../../src/b3/adapter.ts'; export {createVaultReadHandler} from './vault/server.ts';",resolveDir:process.cwd()},outfile:'work/query-classification-unit.mjs',bundle:true,platform:'browser',format:'esm',conditions:['workerd','browser']});
const {classifyReadFailure:classify,AppError,ReadDependencyFailure,ReadTokenFailure,IntegrationFailure,TokenCoordinator,CandidateAdapter,createVaultReadHandler}=await import('../work/query-classification-unit.mjs');
const DEP='INTEGRATION_DEPENDENCY_UNAVAILABLE',TOKEN='INTEGRATION_TOKEN_UNAVAILABLE';
async function assertPublic(result) {
 const handler=createVaultReadHandler(async()=>({isError:true,content:[{type:'text',text:result.code}]}));
 try {
  const response=await handler.fetch(new Request('http://127.0.0.1/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'account',arguments:{account_ref:'account-a'}}})}));
  assert.equal(response.status,200);const text=await response.text();
  const envelope=response.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(text.split('\n').find(x=>x.startsWith('data: ')).slice(6)):JSON.parse(text);
  assert.equal(envelope.result.isError,true);assert.equal(envelope.result.structuredContent,undefined);
  assert.deepEqual(envelope.result.content,[{type:'text',text:result.code}]);assert.ok(!text.includes('SYNTHETIC_PRIVATE_CAUSE'));
 } finally {await handler.close();}
}

for(const [source,expected,cause] of [['VAULT_UNAVAILABLE',TOKEN],['CONFIG_INVALID',TOKEN],['CIPHERTEXT_INVALID',TOKEN],['QUERY_AUTH_REQUIRED',TOKEN],['REAUTH_REQUIRED',TOKEN],['QUERY_DENIED',TOKEN],['QUERY_CONTRACT',TOKEN],['SELLER_MISMATCH',TOKEN],['QUERY_TIMEOUT',DEP,'timeout'],['QUERY_UNAVAILABLE',DEP,'upstream'],['UPSTREAM_TIMEOUT',DEP,'timeout'],['UPSTREAM_UNAVAILABLE',DEP,'upstream'],['QUERY_UNRECOGNIZED',DEP,'upstream']]) {
 test('typed error mapping '+source,async()=>{const result=classify(new AppError(source,503,'SYNTHETIC_PRIVATE_CAUSE'));assert.deepEqual(result,cause?{code:expected,cause}:{code:expected});await assertPublic(result);});
}
for(const kind of ['transport','timeout'])test('typed first local cause '+kind,()=>assert.deepEqual(classify(new ReadDependencyFailure(kind)),{code:DEP,cause:kind}));
test('typed local read validation stays a token failure before coordinator sanitization',()=>assert.deepEqual(classify(new ReadTokenFailure()),{code:TOKEN}));
test('only a valid typed internal failure preserves the authorization code',()=>{
 assert.deepEqual(classify(new IntegrationFailure('INTEGRATION_READ_DENIED')),{code:'INTEGRATION_READ_DENIED'});
 assert.deepEqual(classify(new IntegrationFailure('SYNTHETIC_PRIVATE_CAUSE')),{code:DEP});
 assert.deepEqual(classify({code:'INTEGRATION_READ_DENIED',message:'SYNTHETIC_PRIVATE_CAUSE'}),{code:TOKEN});
});
for(const code of ['ECONNRESET','ETIMEDOUT','ECONNREFUSED','UNAVAILABLE'])test('generic '+code+' cannot prove authorization denial',()=>{
 const error=Object.assign(new Error('SYNTHETIC_PRIVATE_CAUSE'),{code});const result=classify(error);
 assert.deepEqual(result,{code:TOKEN});assert.notEqual(result.code,'INTEGRATION_READ_DENIED');assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_CAUSE'));
});
const cases=[
 ['401','REAUTH_REQUIRED',TOKEN,undefined],['403','QUERY_DENIED',TOKEN,undefined],['429','QUERY_UNAVAILABLE',DEP,'upstream'],['503','QUERY_UNAVAILABLE',DEP,'upstream'],
 ['400','QUERY_CONTRACT',TOKEN,undefined],['302','QUERY_CONTRACT',TOKEN,undefined],['invalid-json','QUERY_CONTRACT',TOKEN,undefined],
 ['seller-mismatch','SELLER_MISMATCH',TOKEN,undefined],['body-timeout','QUERY_TIMEOUT',DEP,'timeout'],['transport','QUERY_UNAVAILABLE',DEP,'upstream']
];
for(const [mode,transformed,expected,cause] of cases)test('real B3.1 adapter/coordinator transformation '+mode,async()=>{
 const row={ciphertext:'SYNTHETIC_CIPHERTEXT',status:'ready'},record={sellerId:'10001',accessToken:'SYNTHETIC_ACCESS',refreshToken:'SYNTHETIC_REFRESH',generation:1,expiresAt:Date.now()+600000};
 let calls=0,writes=0,refresh=0,cancelled=false;
 const store={getTokens:()=>row,putTokens:()=>{writes++;throw new Error('WRITE_FORBIDDEN');},putState:()=>{writes++;throw new Error('WRITE_FORBIDDEN');},takeState:()=>{writes++;throw new Error('WRITE_FORBIDDEN');}};
 const transport={send:async()=>{calls++;
  if(mode==='transport')throw Object.assign(new Error('SYNTHETIC_PRIVATE_CAUSE'),{code:'ECONNRESET'});
  if(mode==='body-timeout')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}});
  if(mode==='invalid-json')return new Response('{bad-json',{status:200});
  if(mode==='seller-mismatch')return Response.json({id:20002,nickname:'SYNTHETIC',site_id:'MLB'});
  return new Response('SYNTHETIC_PRIVATE_CAUSE',{status:Number(mode)});
 }};
 const adapter=new CandidateAdapter('10001','SYNTHETIC_DISABLED','SYNTHETIC_DISABLED',transport,50);
 const coordinator=new TokenCoordinator(store,{open:async()=>record},{exchange:async()=>{throw new Error('EXCHANGE_FORBIDDEN');},refresh:async()=>{refresh++;throw new Error('REFRESH_FORBIDDEN');},identity:async()=>({sellerId:'10001'})},'10001');
 let caught;try{await coordinator.withAccess(token=>adapter.identity(token));assert.fail('Expected a real typed provider error');}catch(e){caught=e;}
 assert.ok(caught instanceof AppError);assert.equal(caught.code,transformed);
 const result=classify(caught);assert.deepEqual(result,cause?{code:expected,cause}:{code:expected});
 await assertPublic(result);assert.equal(calls,1);assert.equal(writes,0);assert.equal(refresh,0);assert.equal(row.status,'ready');assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_CAUSE'));
 if(mode==='body-timeout')assert.equal(cancelled,true);
});
