import {test,expect,beforeEach,afterEach} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
