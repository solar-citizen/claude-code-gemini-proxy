/** Operator-only qualification. An audit reference never grants live authority. */
import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const model='gemini-3.5-flash-lite';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function parseArguments(args:string[]){
 const [mode,...rest]=args;const values:Record<string,string>={};
 if(!['discover','serve'].includes(mode)||rest.length%2)throw Error('invalid qualification arguments');
 for(let i=0;i<rest.length;i+=2){const key=rest[i];if(!['--authorization-ref','--evidence-dir',...(mode==='serve'?['--port','--model-version']:[])].includes(key)||key in values||!rest[i+1])throw Error('invalid qualification arguments');values[key]=rest[i+1];}
 if(!values['--authorization-ref']||values['--authorization-ref'].length>256||!values['--evidence-dir']||!values['--evidence-dir'].startsWith('/'))throw Error('explicit authorization reference and absolute evidence directory required');
 if(mode==='serve'&&(values['--port']!=='8788'||! /^[a-zA-Z0-9_.:-]{1,128}$/.test(values['--model-version']??'')))throw Error('qualification requires port 8788 and approved exact version');
 return {mode,values};
}
function syncDir(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function writer(dir:string){
 mkdirSync(dir,{mode:0o700});syncDir(dirname(dir));let total=0;
 return (name:string,value:unknown)=>{const raw=JSON.stringify(value);const size=Buffer.byteLength(raw);if(size>2097152||total+size>6*2097152+262144)throw Error('qualification evidence bound');const fd=openSync(join(dir,name),'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}syncDir(dir);total+=size;};
}
function intent(reference:string,mode:string){
 if(!reference||reference.length>256)throw Error('authorization reference required');
 return {mode,authorization_ref:reference,state:'consumed',helper_sha256:hash(readFileSync(import.meta.path)),bun_sha256:hash(readFileSync(process.execPath)),created_at:new Date().toISOString()};
}
export async function discover(dir:string,reference:string){
 const record=intent(reference,'discovery');const body={contents:[{role:'user',parts:[{text:'Reply OK.'}]}],generationConfig:{maxOutputTokens:32000,thinkingConfig:{thinkingLevel:'HIGH'}}};
 const write=writer(resolve(dir));write('intent.json',{...record,request_sha256:hash(JSON.stringify(body)),endpoint_model:model});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),35000);
 const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{
  const {callGeminiStrict}=await import('../src/gemini/client');
  const value:any=await callGeminiStrict(body,model,{signal:controller.signal,deadlineMs:30000,maxBytes:2097152});
  if(controller.signal.aborted||! /^[a-zA-Z0-9_.:-]{1,128}$/.test(value?.modelVersion??'')||typeof value.modelVersion!=='string'||value.promptFeedback?.blockReason||value.candidates?.length!==1||value.candidates[0].finishReason!=='STOP'||value.candidates[0].safetyRatings?.some((r:any)=>r.blocked)||value.candidates[0].content?.role!=='model'||!value.candidates[0].content?.parts?.some((p:any)=>typeof p.text==='string'&&p.text.trim()))throw Error('unqualified discovery response');
  const counters=['promptTokenCount','candidatesTokenCount','cachedContentTokenCount','thoughtsTokenCount','totalTokenCount','toolUsePromptTokenCount'];
  if(value.usageMetadata!==undefined&&(!value.usageMetadata||Array.isArray(value.usageMetadata)||typeof value.usageMetadata!=='object'||Object.entries(value.usageMetadata).some(([k,v])=>!counters.includes(k)||!Number.isSafeInteger(v)||Number(v)<0)))throw Error('invalid discovery usage');
  const result={outcome:'observed_only',endpoint_model:model,modelVersion:value.modelVersion,finish:'STOP',usage:value.usageMetadata??null,response_sha256:hash(JSON.stringify(value))};write('result.json',result);return result;
 }catch(error){write('failure.json',{outcome:(error as {outcome?:string}).outcome==='completed_failure'?'completed_failure':'UNCERTAIN',consumed:true});throw Error('discovery failed; authority consumed, no replay');}
 finally{clearTimeout(timer);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
export async function serve(dir:string,reference:string,version:string,port=8788){
 if(port!==8788||! /^[a-zA-Z0-9_.:-]{1,128}$/.test(version))throw Error('invalid qualification binding');
 const write=writer(resolve(dir));write('intent.json',intent(reference,'qualification'));
 process.env.LOG_LEVEL='1';
 const {createHarnessHandler}=await import('../src/harness');
 let records=0;
 const handler=createHarnessHandler({enabled:true,versions:[version],qualificationObserver(phase,evidence){if(++records>6)throw Error('qualification exchange bound');write(`${evidence.attempt_id}-${evidence.sequence}-${phase}.json`,evidence);}});
 const controllers=new Set<AbortController>();
 const server=Bun.serve({hostname:'127.0.0.1',port,async fetch(req){const c=new AbortController();controllers.add(c);const abort=()=>c.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)c.abort();try{return await handler(new Request(req,{signal:c.signal}));}finally{controllers.delete(c);req.signal.removeEventListener('abort',abort);}}});
 try{write('ready.json',{port,hostname:'127.0.0.1',pid:process.pid,start_ticks:readFileSync('/proc/self/stat','utf8').split(')').at(-1)!.trim().split(/\s+/)[19],helper_sha256:hash(readFileSync(import.meta.path))});}catch(error){server.stop(true);throw error;}
 const stop=()=>{for(const c of controllers)c.abort();server.stop(true);clearTimeout(timer);write('stopped.json',{pid:process.pid,aborted:true});process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);};
 const timer=setTimeout(stop,240000);process.once('SIGTERM',stop);process.once('SIGINT',stop);
 return {server,stop};
}
if(import.meta.main){
 try{const {mode,values:v}=parseArguments(process.argv.slice(2));if(mode==='discover')await discover(v['--evidence-dir'],v['--authorization-ref']);else await serve(v['--evidence-dir'],v['--authorization-ref'],v['--model-version']);}
 catch{console.error('qualification refused or failed; inspect private evidence, never retry automatically');process.exitCode=1;}
}
