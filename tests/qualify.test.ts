import {test,expect,beforeEach,afterEach} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync,readdirSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {discover,parseArguments} from '../scripts/qualify';
const original=globalThis.fetch;let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'qualify-'));globalThis.fetch=(async()=>{throw Error('UNEXPECTED OUTBOUND');}) as unknown as typeof fetch;});
afterEach(()=>{globalThis.fetch=original;rmSync(root,{recursive:true,force:true});});
test('discovery consumes one durable intent, preserves HIGH/32000, never retries or approves version',async()=>{
 let calls=0;const dir=join(root,'d');
 globalThis.fetch=(async(url: string|URL|Request,init?: RequestInit)=>{calls++;expect(readFileSync(join(dir,'intent.json'),'utf8')).toContain('consumed');expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');expect(JSON.parse(String(init?.body)).generationConfig).toEqual({maxOutputTokens:32000,thinkingConfig:{thinkingLevel:'HIGH'}});return Response.json({modelVersion:'synthetic-version',candidates:[{content:{role:'model',parts:[{text:'OK'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:2}});}) as unknown as typeof fetch;
 const r=await discover(dir,'offline-test');expect(r.modelVersion).toBe('synthetic-version');expect(calls).toBe(1);
 await expect(discover(dir,'offline-test')).rejects.toThrow();expect(calls).toBe(1);expect(readFileSync(join(dir,'result.json'),'utf8')).not.toContain('synthetic-test-key');
});
test('missing version and ambiguous response consume request without retry',async()=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;return Response.json({candidates:[]});}) as unknown as typeof fetch;
 await expect(discover(join(root,'d'),'offline-test')).rejects.toThrow();expect(calls).toBe(1);expect(readFileSync(join(root,'d','intent.json'),'utf8')).toContain('consumed');
});
test('operator arguments fail closed before credential imports',()=>{
 for(const args of [[],['serve','--port','8787'],['discover','--authorization-ref','x'],['serve','--authorization-ref','x','--evidence-dir','/tmp/x','--port','8788','--model-version','']])expect(()=>parseArguments(args)).toThrow();
});

test('serve is strict-only on 8788, collision never falls back, shutdown aborts and leaves proof',async()=>{
 const {serve}=await import('../scripts/qualify');const real=Bun.serve;let options:any;let stopped=0;
 try{
  Bun.serve=((o:any)=>{options=o;return {stop(){stopped++;}};}) as typeof Bun.serve;
  const state=await serve(join(root,'s'),'offline-test','observed-test-version');
  expect(options.hostname).toBe('127.0.0.1');expect(options.port).toBe(8788);
  expect((await options.fetch(new Request('http://local/v1/messages',{method:'POST',body:'{}'}))).status).toBe(404);
  state.stop();expect(stopped).toBe(1);expect(JSON.parse(readFileSync(join(root,'s','stopped.json'),'utf8')).aborted).toBe(true);
  Bun.serve=(()=>{throw Error('occupied');}) as typeof Bun.serve;
  await expect(serve(join(root,'collision'),'offline-test','observed-test-version')).rejects.toThrow();expect(stopped).toBe(1);
 }finally{Bun.serve=real;}
});

// Each case runs fresh: configuration import side effects and filesystem faults
// cannot contaminate the parent or use an inherited credential environment.
const canary='synthetic-test-key';
async function diagnosticCase(scenario:string){
 const dir=join(root,'d');const child=join(root,'case.ts');
 writeFileSync(child,`
 import {spyOn} from 'bun:test';
 import * as fs from 'node:fs';
 import {discover} from ${JSON.stringify(resolve(import.meta.dir,'../scripts/qualify.ts'))};
 const dir=process.argv[2],scenario=process.argv[3];let calls=0;
 const secret='synthetic-test-key';
 const valid={modelVersion:'synthetic-version',candidates:[{content:{role:'model',parts:[{text:secret}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:2}};
 globalThis.fetch=(async()=>{calls++;
  if(scenario==='fetch_rejection')throw Error('https://upstream.invalid/?key='+secret);
  if(scenario==='timeout')return await new Promise(()=>{});
  if(scenario==='http_error')return new Response(secret,{status:403});
  if(scenario==='incomplete_error')return new Response(new ReadableStream({start(c){c.error(Error(secret));}}),{status:400});
  if(scenario==='body_failure')return new Response(new ReadableStream({start(c){c.error(Error(secret));}}));
  if(scenario==='invalid_json')return new Response('{'+secret);
  if(scenario==='credential_version')return Response.json({...valid,modelVersion:secret});
  if(scenario==='bad_version')return Response.json({...valid,modelVersion:{credential:secret}});
  if(scenario==='bad_usage')return Response.json({...valid,usageMetadata:{secret}});
  if(!fs.existsSync(dir+'/send_started.json'))throw Error('missing send boundary');
  return Response.json(valid);
 }) as unknown as typeof fetch;
 if(scenario==='timeout'){
  const real=setTimeout;
  globalThis.setTimeout=((fn:any,ms:any,...args:any[])=>real(fn,ms===30000?5:ms,...args)) as typeof setTimeout;
 }
 if(scenario==='local_failure'){
  const real=JSON.stringify;
  spyOn(JSON,'stringify').mockImplementation(((v:any,...args:any[])=>{
   if(v?.contents&&fs.existsSync(dir+'/intent.json'))throw Error(secret);
   return (real as any)(v,...args);
  }) as typeof JSON.stringify);
 }
 if(['publish_fsync','diagnostic_fsync','status_fsync','failure_fsync','diagnostic_dir_fsync','publish_dir_fsync','observation_fsync','observation_dir_fsync'].includes(scenario)){
  const real=fs.fsyncSync;let injected=false;
  spyOn(fs,'fsyncSync').mockImplementation((fd:any)=>{
   const path=fs.readlinkSync('/proc/self/fd/'+fd);
   const target=scenario.startsWith('observation')?'response_observation.json':scenario.startsWith('publish')?'result.json':scenario==='status_fsync'?'http_response.json':scenario==='failure_fsync'?'failure.json':'send_started.json';
   if(!injected&&(scenario.endsWith('dir_fsync')?path===dir&&fs.existsSync(dir+'/'+target):path===dir+'/'+target)){injected=true;throw Error(secret);}
   real(fd);
  });
 }
 if(scenario==='diagnostic_collision'){
  const real=fs.fsyncSync;
  spyOn(fs,'fsyncSync').mockImplementation((fd:any)=>{
   real(fd);
   if(fs.readlinkSync('/proc/self/fd/'+fd)===dir+'/intent.json')fs.mkdirSync(dir+'/send_started.json');
  });
 }
 if(scenario==='failure_fsync')globalThis.fetch=(async()=>{calls++;throw Error(secret);}) as unknown as typeof fetch;
 try{await discover(dir,'offline-test');console.log('RETURNED');}catch(error){console.error(String(error));}
 console.log('CALLS='+calls);
 `);
 const env:Record<string,string>={PATH:'/usr/bin:/bin',GEMINI_API_KEY:canary};
 if(scenario==='configuration_import')env.HARNESS_MAX_REQUEST_TOKENS='invalid';
 if(scenario==='missing_configuration')delete env.GEMINI_API_KEY;
 const proc=Bun.spawn([process.execPath,'--no-env-file',child,dir,scenario],{env,stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,exit]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
 expect(exit).toBe(0);expect(stdout+stderr).not.toContain(canary);
 const files=Object.fromEntries(readdirSync(dir,{withFileTypes:true}).filter(f=>f.isFile()).map(f=>[f.name,readFileSync(join(dir,f.name),'utf8')]));
 expect(JSON.stringify(files)).not.toContain(canary);
 return {dir,files,stdout,stderr,failure:files['failure.json']?JSON.parse(files['failure.json']):undefined};
}
const failures:[string,string,string,string,number|null,number,string][]=[
 ['configuration_import','configuration_import','configuration_import_failed','not_observed',null,0,'UNCERTAIN'],
 ['missing_configuration','configuration_import','configuration_import_failed','not_observed',null,0,'UNCERTAIN'],
 ['local_failure','local_validation','local_validation_failed','not_observed',null,0,'UNCERTAIN'],
 ['fetch_rejection','transport','transport_exception','invocation_attempted',null,1,'UNCERTAIN'],
 ['timeout','transport','request_timeout','invocation_attempted',null,1,'UNCERTAIN'],
 ['http_error','http_response','http_error','http_status_observed',403,1,'completed_failure'],
 ['incomplete_error','response_body','body_failure','http_status_observed',400,1,'UNCERTAIN'],
 ['body_failure','response_body','body_failure','http_status_observed',200,1,'UNCERTAIN'],
 ['invalid_json','response_validation','invalid_json','http_status_observed',200,1,'UNCERTAIN'],
 ['bad_version','response_validation','invalid_model_version','http_status_observed',200,1,'UNCERTAIN'],
 ['credential_version','response_validation','invalid_model_version','http_status_observed',200,1,'UNCERTAIN'],
 ['diagnostic_dir_fsync','diagnostic_persistence','diagnostic_persistence_failed','not_observed',null,0,'UNCERTAIN'],
 ['publish_dir_fsync','result_publication','result_publication_failed','http_status_observed',200,1,'UNCERTAIN'],
 ['observation_fsync','diagnostic_persistence','diagnostic_persistence_failed','http_status_observed',200,1,'UNCERTAIN'],
 ['observation_dir_fsync','diagnostic_persistence','diagnostic_persistence_failed','http_status_observed',200,1,'UNCERTAIN'],
 ['bad_usage','response_validation','invalid_usage','http_status_observed',200,1,'UNCERTAIN'],
 ['publish_fsync','result_publication','result_publication_failed','http_status_observed',200,1,'UNCERTAIN'],
 ['diagnostic_fsync','diagnostic_persistence','diagnostic_persistence_failed','not_observed',null,0,'UNCERTAIN'],
 ['diagnostic_collision','diagnostic_persistence','diagnostic_persistence_failed','not_observed',null,0,'UNCERTAIN'],
 ['status_fsync','diagnostic_persistence','diagnostic_persistence_failed','http_status_observed',200,1,'UNCERTAIN'],
];
for(const [scenario,stage,code,observation,status,calls,outcome] of failures)test('discovery retains sanitized diagnostics: '+scenario,async()=>{
 const value=await diagnosticCase(scenario);
 expect(value.stdout).toContain('CALLS='+calls);expect(value.stdout).not.toContain('RETURNED');
 expect(value.failure).toMatchObject({diagnostic_version:1,stage,code,transport_observation:observation,upstream_status:status,outcome,consumed:true});
 if(calls){expect(JSON.parse(value.files['send_started.json'])).toMatchObject({stage:'transport_invocation',code:'invocation_attempted'});}
 if(status!==null&&scenario!=='status_fsync')expect(JSON.parse(value.files['http_response.json']).upstream_status).toBe(status);
 // Consumed attempts remain immutable, including files left by failed fsync.
 const before=value.files;await expect(discover(value.dir,'offline-test')).rejects.toThrow();
 for(const [name,raw] of Object.entries(before))expect(readFileSync(join(value.dir,name),'utf8')).toBe(raw);
});
test('failed failure-evidence fsync still returns a sanitized consumed failure',async()=>{
 const value=await diagnosticCase('failure_fsync');expect(value.stdout).toContain('CALLS=1');
 expect(value.stdout).not.toContain('RETURNED');expect(value.stderr).toContain('authority consumed, no replay');
});
test('send boundary is present inside fetch, never proof of provider receipt',async()=>{
 const dir=join(root,'d');let calls=0;
 globalThis.fetch=(async()=>{calls++;expect(JSON.parse(readFileSync(join(dir,'send_started.json'),'utf8'))).toMatchObject({diagnostic_version:1,stage:'transport_invocation',code:'invocation_attempted'});throw Error(canary);}) as unknown as typeof fetch;
 await expect(discover(dir,'offline-test')).rejects.toThrow('authority consumed, no replay');expect(calls).toBe(1);
 expect(JSON.parse(readFileSync(join(dir,'failure.json'),'utf8')).transport_observation).toBe('invocation_attempted');
});
test('legacy consumed UNCERTAIN evidence cannot be replayed, modified or upgraded',async()=>{
 const dir=join(root,'legacy');mkdirSync(dir);let calls=0;
 globalThis.fetch=(async()=>{calls++;throw Error('unexpected legacy send');}) as unknown as typeof fetch;
 const original={'intent.json':'{"state":"consumed"}','failure.json':'{"outcome":"UNCERTAIN","consumed":true}'};
 for(const [name,raw] of Object.entries(original))writeFileSync(join(dir,name),raw);
 await expect(discover(dir,'offline-test')).rejects.toThrow();
 for(const [name,raw] of Object.entries(original))expect(readFileSync(join(dir,name),'utf8')).toBe(raw);
 expect(calls).toBe(0);expect(existsSync(join(dir,'result.json'))).toBe(false);expect(readdirSync(dir)).toHaveLength(2);
});

test('offline fetch guard disables redirects even for Request inputs, with no real network',async()=>{
 const code=`
  let calls=0;
  globalThis.fetch=(async(_input:any,init:any)=>{calls++;if(init?.redirect!=='error')throw Error('redirect policy bypass');return new Response('OK');}) as typeof fetch;
  await import(${JSON.stringify(resolve(import.meta.dir,'./offline-fetch.ts'))});
  await fetch('http://127.0.0.1:12345',{redirect:'follow'});
  await fetch(new Request('http://127.0.0.1:12345',{redirect:'follow'}));
  try{await fetch('https://external.invalid');throw Error('external request allowed');}catch(e){if(String(e).includes('external request allowed'))throw e;}
  if(calls!==2)throw Error('external fetch was not blocked');
 `;
 const proc=Bun.spawn([process.execPath,'--no-env-file','--eval',code],{env:{PATH:'/usr/bin:/bin'},stdout:'pipe',stderr:'pipe'});
 const [exit,stderr]=await Promise.all([proc.exited,new Response(proc.stderr).text()]);
 expect(stderr).toBe('');expect(exit).toBe(0);
});


import {validUsageCases, invalidUsageCases} from './fixtures/usage';
for (const [name, usageMetadata] of validUsageCases) {
 test('documented discovery usage: ' + name, async () => {
  const dir = join(root, 'usage'); let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({modelVersion: 'synthetic-version', candidates: [{content: {role: 'model', parts: [{text: 'OK'}]}, finishReason: 'STOP'}], usageMetadata}); }) as unknown as typeof fetch;
  const result = await discover(dir, 'offline-test');
  expect(result).toMatchObject({outcome: 'observed_only', modelVersion: 'synthetic-version', finish: 'STOP', usage: usageMetadata ?? null});
  expect(calls).toBe(1);
 });
}
for (const [name, usageMetadata, field, rule] of invalidUsageCases) {
 test('unqualified discovery usage failure: ' + name, async () => {
  const dir = join(root, 'usage'); let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({modelVersion: 'synthetic-version', candidates: [{content: {role: 'model', parts: [{text: 'private-canary'}]}, finishReason: 'STOP'}], usageMetadata}); }) as unknown as typeof fetch;
  await expect(discover(dir, 'offline-test')).rejects.toThrow('authority consumed, no replay');
  const failure = JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8'));
  expect(failure).toMatchObject({outcome: 'UNCERTAIN', consumed: true, code: 'invalid_usage', upstream_status: 200, transport_observation: 'http_status_observed'});
  const observation = JSON.parse(readFileSync(join(dir, 'response_observation.json'), 'utf8'));
  expect(observation).toMatchObject({diagnostic_version: 2, qualification: 'UNQUALIFIED', model_version: 'synthetic-version', finish_reason: 'STOP', usage: {failure: {field, rule}}});
  expect(existsSync(join(dir, 'result.json'))).toBe(false);
  const before = readdirSync(dir).map(name => readFileSync(join(dir, name), 'utf8')).join('');
  expect(before).not.toContain('private-canary'); expect(before).not.toContain('synthetic-test-key');
  expect(Buffer.byteLength(JSON.stringify(observation))).toBeLessThan(4096);
  await expect(discover(dir, 'offline-test')).rejects.toThrow(); expect(calls).toBe(1);
  expect(readdirSync(dir).map(name => readFileSync(join(dir, name), 'utf8')).join('')).toBe(before);
 });
}
test('usage diagnostics retain only allowlisted types and individually valid scalar counts', async () => {
 const dir = join(root, 'usage');
 globalThis.fetch = (async () => Response.json({modelVersion: 'synthetic-version', candidates: [{content: {role: 'model', parts: [{text: 'private-canary'}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 0, candidatesTokenCount: 'private-canary', thoughtsTokenCount: 7, totalTokenCount: 20, promptTokensDetails: [{tokenCount: -1, extra: 'private-canary'}], 'synthetic-test-key': 'private-canary'}})) as unknown as typeof fetch;
 await expect(discover(dir, 'offline-test')).rejects.toThrow();
 const raw = readFileSync(join(dir, 'response_observation.json'), 'utf8');
 expect(JSON.parse(raw).usage).toMatchObject({type: 'object', fields: [{name: 'promptTokenCount', type: 'number'}, {name: 'candidatesTokenCount', type: 'string'}, {name: 'thoughtsTokenCount', type: 'number'}, {name: 'totalTokenCount', type: 'number'}, {name: 'promptTokensDetails', type: 'array'}], token_counts: {promptTokenCount: 0, thoughtsTokenCount: 7, totalTokenCount: 20}, unknown_fields: true, failure: {field: 'candidatesTokenCount', rule: 'nonnegative_safe_integer'}});
 expect(raw).not.toContain('private-canary'); expect(raw).not.toContain('synthetic-test-key');
});
