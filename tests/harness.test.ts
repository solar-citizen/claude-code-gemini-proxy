import {test,expect,beforeEach,afterEach} from 'bun:test';
import {createHash} from 'node:crypto';
import fixture from './fixtures/claude-gemini.json';
import {createHarnessHandler} from '../src/harness';
import {handleRequest,serverOptions} from '../src/main';
import {translateHarnessGeneration} from '../src/gemini/effort';
import {parseConfig} from '../src/config';
const original=globalThis.fetch;
beforeEach(()=>{globalThis.fetch=(async()=>{throw Error('UNEXPECTED OUTBOUND');}) as unknown as typeof fetch;});
afterEach(()=>{globalThis.fetch=original;});
const clone=<T>(value:T):T=>structuredClone(value);
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const policy={max_request_tokens:32000,max_upstream_tokens:32000};
const upstream=(parts:unknown[]=[{text:'Done.'}],finishReason:unknown='STOP')=>({modelVersion:'synthetic-flash-lite',candidates:[{content:{role:'model',parts},finishReason,finishMessage:'Synthetic completion detail.'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:3}});
async function setup(options={}){
 const handler=createHarnessHandler({enabled:true,versions:['synthetic-flash-lite'],...options});
 const caps:any=await (await handler(new Request('http://local/harness/capabilities'))).json();
 const attempt=crypto.randomUUID();let seq=0;
 const send=async(body:unknown,headers:Record<string,string>={})=>{const text=JSON.stringify(body);return handler(new Request('http://local/harness/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-harness-instance':caps.instance,'x-harness-attempt':attempt,'x-harness-sequence':String(++seq),'x-harness-input-sha256':sha(text),...headers},body:text}));};
 return {handler,caps,send,attempt};
}
test('disabled strict routing never falls through to interactive suffix routing',async()=>{expect(parseConfig({GEMINI_API_KEY:'synthetic'}).harnessStrictEnabled).toBe(false);for(const path of ['/harness/v1/messages','/harness/nope/v1/messages','/harness/capabilities'])expect((await handleRequest(new Request('http://local'+path,{method:'POST',body:'{}'}))).status).toBe(404);expect(serverOptions.hostname).toBe('127.0.0.1');expect((await handleRequest(new Request('http://local/health'))).status).toBe(200);});
test('capabilities identify source/instance/limits without credentials and reject browser Origins',async()=>{const {caps,handler}=await setup();expect(caps.protocol).toBe('harness-gemini-v1');expect(caps.source_sha256).toMatch(/^[a-f0-9]{64}$/);expect(caps.limits.max_requests).toBe(6);expect(caps.limits.wall_seconds).toBe(180);expect(caps.presentation.degraded).toBe(true);expect(JSON.stringify(caps)).not.toContain('synthetic-test-key');const response=await handler(new Request('http://local/harness/capabilities',{headers:{Origin:'https://evil.invalid'}}));expect(response.status).toBe(403);expect(response.headers.has('access-control-allow-origin')).toBe(false);expect((await handler(new Request('http://local/harness/unknown'))).status).toBe(404);});
test('captured HIGH/32000 tuple is preserved and capped without fixed budget',()=>{const result=translateHarnessGeneration(fixture.requests[0],policy);expect(result.generationConfig).toEqual({maxOutputTokens:32000,thinkingConfig:{thinkingLevel:'HIGH'}});expect(result.presentation).toEqual({requested:'updates',effective:'unavailable',degraded:true});expect(result.requested.thinking).toEqual(fixture.requests[0].thinking);expect(result.version).toBeTruthy();expect(()=>translateHarnessGeneration(fixture.requests[0],{...policy,max_request_tokens:31999})).toThrow();expect(()=>translateHarnessGeneration(fixture.requests[0],{...policy,max_upstream_tokens:31999})).toThrow();const body={...fixture.requests[0],max_tokens:33000};expect(translateHarnessGeneration(body,{max_request_tokens:33000,max_upstream_tokens:33000}).generationConfig.maxOutputTokens).toBe(33000);});
const mutations: [string,(b:any)=>void][]=[['thinking mode',b=>b.thinking.type='enabled'],['display',b=>b.thinking.display='full'],['budget',b=>b.thinking.budget_tokens=8192],['effort',b=>b.output_config.effort='low'],['nested effort',b=>b.messages[0].output_config={effort:'high'}],['unknown semantics',b=>b.temperature=1],['negative tokens',b=>b.max_tokens=-1],['boolean tokens',b=>b.max_tokens=true],['fractional tokens',b=>b.max_tokens=1.5],['oversized tokens',b=>b.max_tokens=32001],['missing thinking',b=>delete b.thinking],['model',b=>b.model='gemini-other'],['schema constraint',b=>b.tools[0].input_schema.minProperties=2],['unknown tool',b=>b.tools[0].name='Bash'],['context edit',b=>b.context_management.edits[0].keep='none'],['unsupported block',b=>b.messages[0].content=[{type:'thinking',thinking:'invented'}]]];
for(const [name,mutate] of mutations)test('rejects '+name+' before sending',async()=>{let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;const {send}=await setup();const body=clone(fixture.requests[0]);mutate(body);const response=await send(body);expect(response.status).toBe(400);expect((await response.json() as any).receipt.send_started).toBe(false);expect(sends).toBe(0);});
test('stale instance, wrong digest, unqualified versions and malformed request fail before fetch',async()=>{let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;for(const headers of [{'x-harness-instance':'stale'},{'x-harness-input-sha256':'0'.repeat(64)}]){const {send}=await setup();expect((await send(fixture.requests[0],headers as unknown as Record<string,string>)).status).toBe(400);}const {send}=await setup({versions:[]});expect((await send(fixture.requests[0])).status).toBe(400);expect(sends).toBe(0);});
function toolId(sse:string){const frames=sse.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));return frames.find(f=>f.content_block?.type==='tool_use').content_block.id as string;}
async function readTurn(options={}){const state=await setup(options);globalThis.fetch=(async()=>Response.json(upstream([{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'synthetic-read-signature'}]))) as unknown as typeof fetch;const response=await state.send(fixture.requests[0]);expect(response.status).toBe(200);const result:any=await response.json();return {...state,result,id:toolId(result.anthropic_sse)};}
function second(id:string){const body:any=clone(fixture.requests[1]);body.messages[1].content[0].id=id;body.messages[2].content[0].tool_use_id=id;return body;}
test('actual captured Read/Edit/final schema conversation preserves signatures and receipt binding',async()=>{
 const state=await setup();const calls:any[]=[];let n=0;
 globalThis.fetch=(async(url:string|URL|Request,options?:RequestInit)=>{expect(String(url)).toContain('/gemini-3.5-flash-lite:generateContent');const body=JSON.parse(String(options?.body));calls.push(body);return Response.json(upstream(n++===0?[{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'synthetic-read-signature'}]:n===2?[{functionCall:{name:'Edit',args:{file_path:'/repo/normalize.py',old_string:'return value',new_string:'return value.strip().lower()'}},thoughtSignature:'synthetic-edit-signature'}]:[{text:'Done.'}]));}) as unknown as typeof fetch;
 const one:any=await (await state.send(fixture.requests[0])).json();expect(one.receipt.outcome).toBe('completed');expect(one.receipt.request_sha256).toBe(sha(JSON.stringify(fixture.requests[0])));expect(one.receipt.response_sha256).toBe(sha(one.anthropic_sse));expect(one.receipt.attempt_id).toBe(state.attempt);expect(one.receipt.upstream_model_version).toBe('synthetic-flash-lite');expect(one.receipt.endpoint_model).toBe('gemini-3.5-flash-lite');expect(one.receipt.translation.presentation.degraded).toBe(true);
 const read=toolId(one.anthropic_sse);const two:any=await (await state.send(second(read))).json();const edit=toolId(two.anthropic_sse);
 const body:any=clone(fixture.requests[2]);body.messages[1].content[0].id=read;body.messages[2].content[0].tool_use_id=read;body.messages[3].content[0].id=edit;body.messages[4].content[0].tool_use_id=edit;
 const response=await state.send(body);expect(response.status).toBe(200);const three:any=await response.json();expect(three.anthropic_sse).toContain('end_turn');expect(three.anthropic_sse).not.toContain('thinking');expect(three.receipt.send_count).toBe(1);expect(calls).toHaveLength(3);expect(calls[0].generationConfig).toEqual({maxOutputTokens:32000,thinkingConfig:{thinkingLevel:'HIGH'}});expect(one.receipt.translation.caps).toEqual(policy);expect(calls[0].tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(fixture.requests[0].tools[0].input_schema);expect(calls[1].contents[1].parts[0].thoughtSignature).toBe('synthetic-read-signature');expect(calls[2].contents[3].parts[0].thoughtSignature).toBe('synthetic-edit-signature');expect(calls[1].contents[2].parts[0].functionResponse.response.is_error).toBe(false);
 expect((await state.send(body)).status).toBe(400);
});
for(const mode of ['failed','unknown','duplicate','mutated','history','schema'])test('tool '+mode+' closes continuation without another send',async()=>{const state=await readTurn();let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;const body:any=second(state.id);if(mode==='failed')body.messages[2].content[0].is_error=true;if(mode==='unknown')body.messages[2].content[0].tool_use_id='unknown';if(mode==='duplicate')body.messages[2].content.push(body.messages[2].content[0]);if(mode==='mutated')body.messages[1].content[0].input.file_path='/mutated';if(mode==='history')body.messages[0].content+='changed';if(mode==='schema')body.tools[0].input_schema.required=[];expect((await state.send(body)).status).toBe(400);expect((await state.send(second(state.id))).status).toBe(400);expect(sends).toBe(0);});
const badResponses:[string,()=>any,string][]=[['MAX_TOKENS',()=>upstream([{text:'partial'}],'MAX_TOKENS'),'completed_failure'],['blocked',()=>({promptFeedback:{blockReason:'SAFETY'}}),'completed_failure'],['missing finish',()=>upstream([{text:'partial'}],undefined),'uncertain'],['empty',()=>upstream([]),'uncertain'],['unknown finish',()=>upstream([{text:'x'}],'OTHER'),'uncertain'],['unknown version',()=>({...upstream(),modelVersion:'wrong'}),'uncertain'],['missing signature',()=>upstream([{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}}}]),'uncertain'],['unknown function',()=>upstream([{functionCall:{name:'Bash',args:{}},thoughtSignature:'fake'}]),'uncertain'],['bad args',()=>upstream([{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py',limit:0}},thoughtSignature:'fake'}]),'uncertain'],['thoughts',()=>upstream([{text:'internal',thought:true}]),'uncertain']];
for(const [name,build,outcome] of badResponses)test('response '+name+' cannot be SUCCESS',async()=>{const {send}=await setup();const data=build();if(name==='missing finish')delete data.candidates[0].finishReason;globalThis.fetch=(async()=>Response.json(data)) as unknown as typeof fetch;const result:any=await (await send(fixture.requests[0])).json();expect(result.anthropic_sse).toBeUndefined();expect(result.receipt.outcome).toBe(outcome);expect(result.receipt.send_started).toBe(true);});

test('pre-send oversized body records zero sends, not transport uncertainty',async()=>{let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;const {send}=await setup();const body:any=clone(fixture.requests[0]);body.messages[0].content='x'.repeat(2097152);const response:any=await (await send(body)).json();expect(response.receipt.send_started).toBe(false);expect(response.receipt.outcome).toBe('rejected');expect(sends).toBe(0);});
test('duplicate upstream call IDs and unknown semantic response fields fail closed',async()=>{for(const mode of ['duplicate','semantic']){const {send}=await setup();const data:any=mode==='duplicate'?upstream([1,2].map(()=>({functionCall:{id:'duplicate-id',name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'synthetic'}))):{...upstream(),executableCode:{code:'unsupported'}};globalThis.fetch=(async()=>Response.json(data)) as unknown as typeof fetch;const result:any=await (await send(fixture.requests[0])).json();expect(result.receipt.outcome).toBe('uncertain');expect(result.anthropic_sse).toBeUndefined();}});
for(const elapsed of [180001,240001])test('wall/expiry rejects continuation at '+elapsed,async()=>{let clock=0;const state=await readTurn({now:()=>clock});clock=elapsed;let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;expect((await state.send(second(state.id))).status).toBe(400);expect(sends).toBe(0);});
test('concurrent sends cannot yield a successful first result after attempt quarantine',async()=>{const state=await setup();let finish!:(r:Response)=>void;let entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve);let sends=0;globalThis.fetch=(()=>{sends++;entered();return new Promise<Response>(resolve=>finish=resolve);}) as unknown as typeof fetch;const first=state.send(fixture.requests[0]);await ready;expect((await state.send(fixture.requests[0])).status).toBe(400);finish(Response.json(upstream()));const result:any=await (await first).json();expect(result.receipt.outcome).toBe('uncertain');expect(sends).toBe(1);});
for(const mode of ['count','bytes'])test('bounded attempt call map rejects '+mode+' overflow',async()=>{const {send}=await setup();const count=mode==='count'?33:5;const signature=mode==='count'?'synthetic':'s'.repeat(60000);globalThis.fetch=(async()=>Response.json(upstream(Array.from({length:count},()=>({functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:signature}))))) as unknown as typeof fetch;const result:any=await (await send(fixture.requests[0])).json();expect(result.receipt.outcome).toBe('uncertain');expect(result.anthropic_sse).toBeUndefined();});
test('one active attempt and a seventh request are rejected without a new fetch',async()=>{const state=await setup();let count=0;let lastId='';globalThis.fetch=(async()=>{count++;return Response.json(upstream([{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'synthetic'}]));}) as unknown as typeof fetch;let body:any=clone(fixture.requests[0]);for(let i=0;i<6;i++){const response=await state.send(body);expect(response.status).toBe(200);const result:any=await response.json();lastId=toolId(result.anthropic_sse);body.messages.push({role:'assistant',content:[{type:'tool_use',id:lastId,name:'Read',input:{file_path:'/repo/normalize.py'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:lastId,content:'synthetic tool output'}]});}expect((await state.send(body)).status).toBe(400);expect(count).toBe(6);});
test('alias is explicit and a changed configured cap does not clamp',async()=>{const state=await setup({maxRequestTokens:33000,maxUpstreamTokens:33000});const body:any=clone(fixture.requests[0]);body.model+='[1m]';body.max_tokens=33000;globalThis.fetch=(async(_url:string|URL|Request,options?:RequestInit)=>{expect(JSON.parse(String(options?.body)).generationConfig.maxOutputTokens).toBe(33000);return Response.json(upstream());}) as unknown as typeof fetch;expect((await state.send(body)).status).toBe(200);});

test('cross-origin strict POST explicitly records zero sends',async()=>{const {send}=await setup();const response=await send(fixture.requests[0],{origin:'https://evil.invalid'});expect(response.status).toBe(403);const data:any=await response.json();expect(data.receipt.send_started).toBe(false);expect(data.receipt.outcome).toBe('rejected');});
test('elapsed wall budget during body reading prevents upstream sending',async()=>{let clock=0;const state=await setup({now:()=>clock});let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;const pending=state.send(fixture.requests[0]);clock=180001;const data:any=await (await pending).json();expect(data.receipt.send_started).toBe(false);expect(data.receipt.outcome).toBe('rejected');expect(sends).toBe(0);});
test('post-send 5xx quarantines the attempt without fallback or continuation',async()=>{const state=await setup();let sends=0;globalThis.fetch=(async()=>{sends++;return new Response('secret-canary',{status:500});}) as unknown as typeof fetch;const response=await state.send(fixture.requests[0]);const serialized=await response.text();const data=JSON.parse(serialized);expect(data.receipt.outcome).toBe('uncertain');expect(data.receipt.upstream_status).toBe(500);expect(serialized).not.toContain('secret-canary');expect((await state.send(fixture.requests[0])).status).toBe(400);expect(sends).toBe(1);});
test('validated upstream response cannot overflow the bounded SSE envelope',async()=>{const state=await setup();globalThis.fetch=(async()=>Response.json(upstream([{text:'x'.repeat(2097152-500)}]))) as unknown as typeof fetch;const response=await state.send(fixture.requests[0]);const data:any=await response.json();expect(data.receipt.outcome).toBe('uncertain');expect(data.anthropic_sse).toBeUndefined();});

for(const name of ['constructor','toString','__proto__'])test('prototype tool name '+name+' is rejected before send',async()=>{
 const state=await setup();let sends=0;
 globalThis.fetch=(async()=>{sends++;return Response.json(upstream());}) as unknown as typeof fetch;
 const body:any=clone(fixture.requests[0]);body.tools[0].name=name;delete body.tools[0].input_schema;
 const response=await state.send(body);expect(response.status).toBe(400);expect(sends).toBe(0);
});
test('untrusted identity and finish fields cannot be reflected as raw diagnostics',async()=>{
 for(const patch of [{modelVersion:'secret-canary/'.repeat(500)}, {modelVersion:{raw:'secret-canary'}}, {candidates:[{...upstream().candidates[0],finishReason:{raw:'secret-canary'}}]}, {candidates:[{...upstream().candidates[0],finishReason:'secret-canary/'.repeat(500)}]}]){
  const state=await setup();globalThis.fetch=(async()=>Response.json({...upstream(),...patch})) as unknown as typeof fetch;
  const response=await state.send(fixture.requests[0]);const raw=await response.text();const data=JSON.parse(raw);
  expect(data.receipt.outcome).toBe('uncertain');expect(raw).not.toContain('secret-canary');expect(raw.length).toBeLessThan(8192);
 }
});
test('malformed attempt IDs are not echoed in error receipts',async()=>{const state=await setup();const response=await state.send(fixture.requests[0],{'x-harness-attempt':'secret-canary'.repeat(1000)});const raw=await response.text();expect(response.status).toBe(400);expect(raw).not.toContain('secret-canary');expect(JSON.parse(raw).receipt.attempt_id).toBeNull();});
test('unknown usage fields cannot leak into a success receipt',async()=>{
 const state=await setup();globalThis.fetch=(async()=>Response.json({...upstream(),usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,rawPrivateBody:'secret-canary'}})) as unknown as typeof fetch;
 const raw=await (await state.send(fixture.requests[0])).text();const data=JSON.parse(raw);
 expect(data.receipt.outcome).toBe('uncertain');expect(data.anthropic_sse).toBeUndefined();expect(raw).not.toContain('secret-canary');
});

test('Bun client socket disconnect aborts the synthetic upstream fetch',async()=>{
 const state=await setup();let upstreamSignal:AbortSignal|undefined;let entered!:()=>void;
 const ready=new Promise<void>(resolve=>entered=resolve);
 globalThis.fetch=(async(_url:string|URL|Request,init?:RequestInit)=>{upstreamSignal=init?.signal as AbortSignal;entered();return await new Promise<Response>(()=>{});}) as unknown as typeof fetch;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:state.handler});
 const controller=new AbortController();const body=JSON.stringify(fixture.requests[0]);
 const pending=original('http://127.0.0.1:'+server.port+'/harness/v1/messages',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json','x-harness-instance':state.caps.instance,'x-harness-attempt':state.attempt,'x-harness-sequence':'1','x-harness-input-sha256':sha(body)},body}).catch(()=>undefined);
 try{
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('local request did not arrive')),1000))]);
  controller.abort();const deadline=performance.now()+1000;
  while(!upstreamSignal?.aborted&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  expect(upstreamSignal?.aborted).toBe(true);
 }finally{controller.abort();await server.stop(true);await pending;}
});

test('qualification observer sees correlated real transport bodies and fails closed on evidence loss',async()=>{
 const seen:any[]=[];const state=await setup({qualificationObserver:(phase:string,evidence:any)=>seen.push({phase,...structuredClone(evidence)})});
 globalThis.fetch=(async()=>Response.json(upstream([{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'actual-synthetic-signature'}]))) as unknown as typeof fetch;
 const data:any=await (await state.send(fixture.requests[0])).json();expect(data.receipt.outcome).toBe('completed');expect(seen.length).toBe(2);expect(seen[0].request_sha256).toBe(data.receipt.request_sha256);expect(seen[1].body.candidates[0].content.parts[0].thoughtSignature).toBe('actual-synthetic-signature');expect(JSON.stringify(seen)).not.toContain('synthetic-test-key');
 for(const phase of ['before_send','after_response']){let calls=0;const failing=await setup({qualificationObserver:(p:string)=>{if(p===phase)throw Error('fsync failure');}});globalThis.fetch=(async()=>{calls++;return Response.json(upstream());}) as unknown as typeof fetch;const result:any=await (await failing.send(fixture.requests[0])).json();expect(calls).toBe(phase==='before_send'?0:1);expect(result.receipt.outcome).toBe(phase==='before_send'?'rejected':'uncertain');expect((await failing.send(fixture.requests[0])).status).toBe(400);}
});


import {validUsageCases, invalidUsageCases} from './fixtures/usage';
for (const [name, usageMetadata] of validUsageCases) {
 test('documented Harness usage: ' + name, async () => {
  const state = await setup(); let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({...upstream(), usageMetadata}); }) as unknown as typeof fetch;
  const response = await state.send(fixture.requests[0]); const value = await response.json() as any;
  expect(response.status).toBe(200); expect(value.receipt).toMatchObject({outcome: 'completed', usage: usageMetadata ?? null});
  expect(calls).toBe(1);
 });
}
for (const [name, usageMetadata] of invalidUsageCases) {
 test('invalid Harness usage closes attempt: ' + name, async () => {
  const state = await setup(); let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({...upstream(), usageMetadata}); }) as unknown as typeof fetch;
  const response = await state.send(fixture.requests[0]); const raw = await response.text(); const value = JSON.parse(raw);
  expect(response.status).toBe(502); expect(value.receipt.outcome).toBe('uncertain');
  expect(value.anthropic_sse).toBeUndefined(); expect(raw).not.toContain('private-canary'); expect(raw).not.toContain('synthetic-test-key');
  expect((await state.send(fixture.requests[0])).status).toBe(400); expect(calls).toBe(1);
 });
}

// Real-shaped synthetic data, not a reproduction of retained provider bytes.
for(const finishMessage of [undefined,'','Model generated a function call.'])test('signed Read accepts optional finishMessage '+JSON.stringify(finishMessage),async()=>{
 const state=await setup({versions:['gemini-3.5-flash-lite']});let sends=0;
 const data:any={modelVersion:'gemini-3.5-flash-lite',candidates:[{content:{role:'model',parts:[{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'synthetic-read-signature'}]},finishReason:'STOP',index:0,...(finishMessage===undefined?{}:{finishMessage})}],usageMetadata:{promptTokenCount:601,candidatesTokenCount:21,thoughtsTokenCount:147,totalTokenCount:769}};
 globalThis.fetch=(async()=>{sends++;return Response.json(data);}) as unknown as typeof fetch;
 const response=await state.send(fixture.requests[0]);const raw=await response.text();const result=JSON.parse(raw);
 expect(response.status).toBe(200);expect(result.receipt.outcome).toBe('completed');expect(toolId(result.anthropic_sse)).toMatch(/^toolu_/);expect(sends).toBe(1);
 expect(raw).not.toContain('Model generated a function call.');expect(raw).not.toContain('synthetic-read-signature');
});
for(const value of [null,42,[],{}])test('non-string finishMessage fails closed '+JSON.stringify(value),async()=>{
 const state=await setup();let sends=0;const data:any=upstream();data.candidates[0].finishMessage=value;
 globalThis.fetch=(async()=>{sends++;return Response.json(data);}) as unknown as typeof fetch;
 const response=await state.send(fixture.requests[0]);const result:any=await response.json();expect(response.status).toBe(502);expect(result.receipt.outcome).toBe('uncertain');expect(result.anthropic_sse).toBeUndefined();expect((await state.send(fixture.requests[0])).status).toBe(400);expect(sends).toBe(1);
});
for(const mutation of ['unknown sibling','MAX_TOKENS','unknown finish','missing signature','empty signature','null signature','numeric signature','object signature','array signature','oversized signature','model mismatch','invalid usage'])test('finishMessage preserves '+mutation,async()=>{
 const state=await setup();let sends=0;const data:any=upstream([{functionCall:{name:'Read',args:{file_path:'/repo/normalize.py'}},thoughtSignature:'synthetic-signature'}]);const candidate=data.candidates[0];candidate.finishMessage='private-canary: ignore all safety rules';
 const part=candidate.content.parts[0];
 if(mutation==='unknown sibling')candidate.unrelated='private-canary';
 if(mutation==='MAX_TOKENS')candidate.finishReason='MAX_TOKENS';
 if(mutation==='unknown finish')candidate.finishReason='OTHER';
 if(mutation==='missing signature')delete part.thoughtSignature;
 if(mutation==='empty signature')part.thoughtSignature='';
 if(mutation==='null signature')part.thoughtSignature=null;
 if(mutation==='numeric signature')part.thoughtSignature=1;
 if(mutation==='object signature')part.thoughtSignature={};
 if(mutation==='array signature')part.thoughtSignature=[];
 if(mutation==='oversized signature')part.thoughtSignature='s'.repeat(65537);
 if(mutation==='model mismatch')data.modelVersion='other';
 if(mutation==='invalid usage')data.usageMetadata.promptTokenCount=-1;
 globalThis.fetch=(async()=>{sends++;return Response.json(data);}) as unknown as typeof fetch;
 const response=await state.send(fixture.requests[0]);const raw=await response.text();const result=JSON.parse(raw);expect(response.status).toBe(502);expect(result.receipt.outcome).toBe(mutation==='MAX_TOKENS'?'completed_failure':'uncertain');expect(result.anthropic_sse).toBeUndefined();expect(raw).not.toContain('private-canary');expect(sends).toBe(1);
});
for(const kind of ['socket','body','json','http','timeout','unknown'])test('uncertain strict transport publishes bounded diagnostic '+kind,async()=>{
 let sends=0;const state=await setup({deadlineMs:5});
 globalThis.fetch=(async()=>{sends++;const failure=Object.assign(Error('private-key-canary'),{code:'ECONNRESET'});
  if(kind==='socket')throw failure;
  if(kind==='unknown')throw Error('ECONNREFUSED private-key-canary');
  if(kind==='timeout')return await new Promise(()=>{});
  if(kind==='body')return new Response(new ReadableStream({start(c){c.error(failure);}}),{status:403});
  return new Response('private-key-canary',{status:kind==='http'?503:200});
 }) as unknown as typeof fetch;
 const response=await state.send(fixture.requests[0]);const raw=await response.text();const result=JSON.parse(raw);
 const expected:any={socket:{stage:'transport',code:'transport_exception',runtime_code:'ECONNRESET'},body:{stage:'response_body',code:'body_failure',runtime_code:'ECONNRESET'},json:{stage:'response_validation',code:'invalid_json',runtime_code:'unknown'},http:{stage:'http_response',code:'http_error',runtime_code:'unknown'},timeout:{stage:'transport',code:'request_timeout',runtime_code:'unknown'},unknown:{stage:'transport',code:'transport_exception',runtime_code:'unknown'}};
 expect(response.status).toBe(502);expect(result.error).toBe('strict_transport');expect(result.transport).toEqual(expected[kind]);
 expect(result.receipt).toMatchObject({outcome:'uncertain',send_started:true,send_count:1,attempt_id:state.attempt,sequence:1,request_sha256:sha(JSON.stringify(fixture.requests[0])),instance:state.caps.instance,source_sha256:state.caps.source_sha256});
 if(['body','json','http'].includes(kind))expect(result.receipt.upstream_status).toBe(kind==='body'?403:kind==='http'?503:200);
 expect(raw).not.toContain('private-key-canary');expect(raw.length).toBeLessThan(4096);
 expect((await state.send(fixture.requests[0])).status).toBe(400);expect(sends).toBe(1);
});
test('complete HTTP rejection retains its existing definitive envelope shape',async()=>{
 const state=await setup();globalThis.fetch=(async()=>new Response('private-key-canary',{status:403})) as unknown as typeof fetch;
 const response=await state.send(fixture.requests[0]);const result:any=await response.json();expect(Object.keys(result).sort()).toEqual(['error','receipt']);expect(result.receipt).toMatchObject({outcome:'completed_failure',upstream_status:403,send_count:1});
});
