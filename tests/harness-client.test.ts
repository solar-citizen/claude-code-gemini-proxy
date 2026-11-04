import {test,expect,beforeEach,afterEach} from 'bun:test';
import {callGeminiStrict} from '../src/gemini/client';
const original=globalThis.fetch;
beforeEach(()=>{globalThis.fetch=(async()=>{throw new Error('UNEXPECTED OUTBOUND');}) as unknown as typeof fetch;});
afterEach(()=>{globalThis.fetch=original;});
const invoke=(signal=new AbortController().signal,deadlineMs=30,maxBytes=1000)=>callGeminiStrict({},'gemini-3.5-flash-lite',{signal,deadlineMs,maxBytes});
test('one send uses fixed endpoint, first key, no redirects and HIGH body unchanged',async()=>{
 let count=0;
 globalThis.fetch=(async(url:string|URL|Request,options?:RequestInit)=>{count++;expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');expect(options?.redirect).toBe('error');expect(new Headers(options?.headers).get('x-goog-api-key')).toBe('synthetic-test-key');return Response.json({ok:true});}) as unknown as typeof fetch;
 expect(await invoke()).toEqual({ok:true});expect(count).toBe(1);
});
for(const status of [400,401,403,404,429,408,500,502,302]) test('HTTP '+status+' is sanitized and never retried',async()=>{
 let sends=0;globalThis.fetch=(async()=>{sends++;return new Response('secret-canary',{status});}) as unknown as typeof fetch;
 try{await invoke();throw Error('expected failure');}catch(error){expect(String(error)).not.toContain('secret-canary');expect((error as {outcome:string}).outcome).toBe([400,401,403,404,429].includes(status)?'completed_failure':'uncertain');}
 expect(sends).toBe(1);
});
for(const phase of ['headers','body']) test('absolute deadline includes slow '+phase,async()=>{
 globalThis.fetch=(async()=> phase==='headers'? await new Promise(()=>{}):new Response(new ReadableStream({start(){}}))) as unknown as typeof fetch;
 const start=Date.now();await expect(invoke()).rejects.toThrow('strict_transport');expect(Date.now()-start).toBeLessThan(1000);
});
test('disconnect before send makes zero fetches',async()=>{let sends=0;globalThis.fetch=(async()=>{sends++;return Response.json({});}) as unknown as typeof fetch;const c=new AbortController();c.abort();await expect(invoke(c.signal)).rejects.toThrow();expect(sends).toBe(0);});
test('disconnect while reading aborts the actual fetch signal',async()=>{const c=new AbortController();let actual:AbortSignal|undefined;globalThis.fetch=(async(_url:string|URL|Request,options?:RequestInit)=>{actual=options?.signal as AbortSignal;return new Response(new ReadableStream({start(){}}));}) as unknown as typeof fetch;const pending=invoke(c.signal,1000);setTimeout(()=>c.abort(),10);await expect(pending).rejects.toThrow();expect(actual?.aborted).toBe(true);});
test('oversized bodies, malformed JSON and network errors are bounded sanitized uncertainty',async()=>{
 for(const result of ['x'.repeat(1001),'not-json',null]){globalThis.fetch=(async()=>{if(result===null)throw Error('secret-key-at-secret-url');return new Response(result);}) as unknown as typeof fetch;try{await invoke();throw Error('expected failure');}catch(e){expect((e as {outcome:string}).outcome).toBe('uncertain');expect(String(e)).not.toContain('secret');}}
});

test('immediate abort plus fetch rejection does not escape sanitized transport handling',async()=>{const c=new AbortController();globalThis.fetch=(()=>{c.abort();return Promise.reject(Error('secret-canary'));}) as unknown as typeof fetch;await expect(invoke(c.signal)).rejects.toThrow('strict_transport');await new Promise(r=>setTimeout(r,10));});

test('an incomplete error body cannot establish a completed upstream rejection',async()=>{globalThis.fetch=(async()=>new Response(new ReadableStream({start(){}}),{status:400})) as unknown as typeof fetch;try{await invoke();throw Error('expected failure');}catch(error){expect((error as {outcome:string}).outcome).toBe('uncertain');expect(String(error)).toContain('strict_transport');}});

test('strict diagnostics preserve local validation before invocation',async()=>{
 const circular:any={};circular.self=circular;let calls=0;
 globalThis.fetch=(async()=>{calls++;throw Error('synthetic-test-key');}) as unknown as typeof fetch;
 try{await callGeminiStrict(circular,'gemini-3.5-flash-lite',{signal:new AbortController().signal,deadlineMs:30,maxBytes:1000});throw Error('expected failure');}
 catch(error){expect(error).toMatchObject({send_started:false,outcome:'rejected',stage:'local_validation',code:'local_validation_failed'});expect(String(error)).not.toContain('synthetic-test-key');}
 expect(calls).toBe(0);
});
test('strict diagnostic observer failure prevents fetch without leaking the persistence error',async()=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;return Response.json({});}) as unknown as typeof fetch;
 try{await callGeminiStrict({},'gemini-3.5-flash-lite',{signal:new AbortController().signal,deadlineMs:30,maxBytes:1000,diagnostic(event:any){if(event.stage==='transport_invocation')throw Error('synthetic-test-key');}});throw Error('expected failure');}
 catch(error){expect(error).toMatchObject({send_started:false,outcome:'rejected',stage:'diagnostic_persistence',code:'diagnostic_persistence_failed'});expect(String(error)).not.toContain('synthetic-test-key');}
 expect(calls).toBe(0);
});
for(const phase of ['headers','body'])test('strict timeout records '+phase+' with any observed status',async()=>{
 globalThis.fetch=(async()=>phase==='headers'?await new Promise(()=>{}):new Response(new ReadableStream({start(){}}),{status:403})) as unknown as typeof fetch;
 try{await invoke();throw Error('expected failure');}catch(error){expect(error).toMatchObject({outcome:'uncertain',send_started:true,stage:phase==='headers'?'transport':'response_body',code:'request_timeout',...(phase==='body'?{upstream_status:403}:{})});}
});
test('strict HTTP status survives malformed response JSON',async()=>{
 globalThis.fetch=(async()=>new Response('{synthetic-test-key')) as unknown as typeof fetch;
 try{await invoke();throw Error('expected failure');}catch(error){expect(error).toMatchObject({outcome:'uncertain',stage:'response_validation',code:'invalid_json',upstream_status:200});expect(String(error)).not.toContain('synthetic-test-key');}
});
