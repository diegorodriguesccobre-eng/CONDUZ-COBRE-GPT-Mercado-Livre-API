import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const mf=['dist/src/index.js','dist/src/plugins/artifacts/git-sidecar.js','dist/src/workers/shared/zod.worker.js'];
const mfHashes=['c2ef894fbc028d2d05ee51b7b596fd83df7ab4f8cc9ea7649bfaec3add84fdad','753d7269b520423e1de30b3396717540fe8457ccdf3fe062a54ee4adbf8c1856','5a9d4cf976995e6d128213b12d7ed7fa41d2df5e9af442afba479df45196af17'];
const entries=[
 ['node_modules/@cloudflare/vitest-plugin','1.4.8','dist/pool/index.mjs','312edd6cd759d0bbf774d921f5a849294e425aae9b637c268605861f4088277c'],
 ['node_modules/wrangler','4.153.0','wrangler-dist/cli.js','18dbf242b542e171c993d68cc41a4e58bc4f533392fc91b71e29ffeee7bf6c0c'],
 ...['node_modules/miniflare','prototype/mcp-local/node_modules/miniflare'].flatMap(base=>mf.map((file,i)=>[base,'5.20261023.0-beta',file,mfHashes[i]]))
];
const must=(v,code)=>{if(!v)throw new Error(code);};
export function auditBundles(){
 must(process.version==='v24.22.1'&&process.versions.undici==='7.30.1','UNREVIEWED_NODE_RUNTIME');
 const results=[];
 for(const [base,version,file,expected] of entries){
  must(JSON.parse(readFileSync(resolve(root,base,'package.json'),'utf8')).version===version,'PARENT_VERSION_CHANGED');
  const bytes=readFileSync(resolve(root,base,file)),text=bytes.toString(),sha256=createHash('sha256').update(bytes).digest('hex');
  must(sha256===expected,'BUNDLE_BYTES_CHANGED:'+base+'/'+file);
  const cores=[...text.matchAll(/major:\s*4,\s*minor:\s*(\d+),\s*patch:\s*(\d+)\b/g)];
  must(cores.length>0&&cores.every(m=>m[1]==='6'&&m[2]==='6'),'ZOD_CORE_UNREVIEWED');
  for(const kind of ['array','map','set'])must([...text.matchAll(new RegExp('capSize\\w*\\(inst, '+kind+'Size','g'))].length>=cores.length,'ZOD_EARLY_CAP_MISSING');
  let undici=false;
  if(text.includes('undici@')){
   const versions=[...new Set([...text.matchAll(/undici@(\d+\.\d+\.\d+)/g)].map(m=>m[1]))];must(versions.length===1&&versions[0]==='7.30.1','UNDICI_CORE_UNREVIEWED');
   const valid=text.slice(text.indexOf('isValidSRIHashAlgorithm ='),text.indexOf('isValidSRIHashAlgorithm =')+220);
   const sri=text.slice(text.indexOf('function parseMetadata'),text.indexOf('function parseMetadata')+1300);
   must(valid.includes('asciiLowercase(algorithm)')&&/alg:\s*asciiLowercase\(algorithm\)/.test(sri),'SRI_NORMALIZATION_MISSING');
   const es=text.search(/EventSourceStream(?:\$\d+)? = class extends Transform/),event=text.slice(es,es+10000);
   must(es>=0&&event.includes('maxBufferedChunks')&&event.includes('maxEventSize'),'EVENTSOURCE_CAP_MISSING');
   const at=text.indexOf('if (codings.length > maxContentEncodings)'),branch=text.slice(at,at+700),before=text.slice(text.lastIndexOf('onHeaders',at),at);
   must(at>=0&&branch.includes('this.abort(')&&branch.includes('return true')&&!/new (?:Readable|ReadableStream)\b/.test(before),'ENCODING_ABORT_ORDER_CHANGED');undici=true;
  }
  results.push({file:base+'/'+file,version,sha256,zodCoreBlocks:cores.length,undiciCorrected:undici});
 }
 const roots=[...new Set(entries.map(e=>e[0]))];let scanned=0;
 const walk=dir=>{for(const f of readdirSync(dir,{withFileTypes:true})){const p=resolve(dir,f.name);if(f.isDirectory())walk(p);else if(/\.(?:mjs|cjs|js)$/.test(f.name)){
  scanned++;const t=readFileSync(p,'utf8');must(!/undici@7\.29\.1|major:\s*4,\s*minor:\s*6,\s*patch:\s*5\b/.test(t),'OLD_RUNTIME_IMPLEMENTATION_REMAINS');
 }}};
 roots.forEach(x=>walk(resolve(root,x)));
 return {runtime:{node:process.version,undici:process.versions.undici},files:results,scannedJavaScriptFiles:scanned,knownAdvisoryBodiesReplaced:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(auditBundles(),null,2));}catch(e){console.error(e instanceof Error?e.message:'BUNDLE_AUDIT_FAILED');process.exitCode=1;}
}
