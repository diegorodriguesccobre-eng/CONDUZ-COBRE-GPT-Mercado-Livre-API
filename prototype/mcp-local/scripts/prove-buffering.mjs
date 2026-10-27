import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = root + 'work/buffering/';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild'); const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = require('miniflare');
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
await mkdir(directory, { recursive: true });
await build({ entryPoints: [root+'tests/fixtures/buffering-worker.ts'], outfile: directory+'buffering-worker.mjs', bundle:true, platform:'browser',format:'esm',conditions:['workerd','browser'],external:['cloudflare:workers'] });
const cases=[]; const marker='SYNTHETIC_COMMERCIAL_CANARY';
async function scenario(mode,kind) {
 console.log('START',mode,kind);
 let mf, req; let received=false, text='', transportError; let responseStatus; let outbound=0; let url;
 try {
  mf=new Miniflare({...convertV4MiniflareOptions({rootPath:directory,modulesRoot:directory,modules:true,scriptPath:directory+'buffering-worker.mjs',host:'127.0.0.1',port:0,inspectorHost:'127.0.0.1',inspectorPort:0,compatibilityDate:'2026-10-01',cf:false,bindings:{MODE:mode,STREAM_FAULT:['infinite','broken'].includes(kind)?kind:''},durableObjects:{GATE:{className:'ProbeGate',useSQLite:true}},outboundService:()=>{outbound++;return new Response('DENIED',{status:503})}}),telemetry:{enabled:false},log:new Log(LogLevel.NONE)});
  url=await mf.ready;const ns=await mf.getDurableObjectNamespace('GATE');const gate=ns.get(ns.idFromName('probe'));
  let contentType, toolRequest;
  let completeWire; const wireDone=new Promise(resolve=>{completeWire=resolve});
  const client=new Client({name:'independent-buffering-client',version:'0.0.1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
  const tr=new StreamableHTTPClientTransport(new URL('/mcp',url),{fetch:async(input,init)=>{
   const parsed=typeof init?.body==='string'?JSON.parse(init.body):{};
   if(parsed.method!=='tools/call')return fetch(input,init);
   const body=init.body;toolRequest={body,headers:Object.fromEntries(new Headers(init.headers))};
   return new Promise((resolve,reject)=>{
    req=httpRequest(input instanceof Request?input.url:input,{method:'POST',agent:false,headers:{...toolRequest.headers,'Content-Length':Buffer.byteLength(body)}},r=>{
     received=true;responseStatus=r.statusCode;contentType=r.headers['content-type'];
     r.on('data',c=>{text+=c});r.on('end',()=>{completeWire();resolve(new Response(text,{status:r.statusCode,headers:r.headers}))});r.on('error',e=>{completeWire();reject(e)});
    });req.once('error',e=>{transportError=e;completeWire();reject(e)});req.end(body);
   });
  }});
  try {
   await client.connect(tr);assert.deepEqual((await client.listTools()).tools.map(x=>x.name),['account']);
   const done=client.callTool({name:'account',arguments:kind==='tool-error'?{fail:true}:{}});done.catch(()=>{});
  if(['infinite','broken'].includes(kind)) {await done.catch(()=>{});await wireDone;assert.equal(responseStatus,503);assert.ok(!text.includes(marker));}
  else {
   let status;
   for(let n=0;n<200;n++){status=await gate.status();if(status.phase==='buffered')break;await new Promise(r=>setTimeout(r,5));}
   assert.equal(status.phase,'buffered');assert.ok(status.bytes>0);assert.equal(status.contained,kind!=='tool-error');
   assert.equal(received,false,'No HTTP headers/data before final authorization');assert.equal(text,'');
   await gate.change(kind);
   if(kind==='disconnect')req.destroy(new Error('INJECTED_CLIENT_DISCONNECT'));
   await gate.release();await done.catch(e=>{if(!['revoke','revision','disconnect'].includes(kind))throw e});await wireDone;
   if(['revoke','revision'].includes(kind)){assert.equal(responseStatus,403);assert.equal(text,'BUFFER_FINAL_DENIED');}
   else if(kind==='disconnect'){assert.equal(received,false);assert.equal(text,'');assert.ok(transportError);}
   else {assert.equal(responseStatus,200);assert.equal(text.includes(marker),kind!=='tool-error');assert.ok(contentType.includes(mode==='sse'?'text/event-stream':'application/json'));}
  }
  } finally {try {await client.close();} finally {await tr.close();}}
  assert.equal(outbound,0);console.log('PASS',mode,kind);cases.push({mode,kind,passed:true,status:responseStatus??'client-disconnected',contentType:contentType??null,deliveredCanary:text.includes(marker)});
 }finally{
  req?.destroy();if(mf)await mf.dispose();
  if(url)await new Promise((resolve,reject)=>{const s=connect({host:'127.0.0.1',port:Number(url.port)});s.once('connect',()=>{s.destroy();reject(new Error('PORT_LEFT_OPEN'))});s.once('error',e=>{s.destroy();e.code==='ECONNREFUSED'?resolve():reject(e)});});
 }
}
for(const mode of ['json','sse'])for(const kind of ['allow','revoke','revision','tool-error','infinite','broken','disconnect'])await scenario(mode,kind);
await writeFile(directory+'buffering-results.json',JSON.stringify({cases,passed:cases.length,syntheticOnly:true,productionReady:false,guarantee:'No response headers or payload before the final decision; already authorized bytes in flight cannot be recalled.'},null,2)+'\n');console.log(JSON.stringify({passed:cases.length,cases}));
