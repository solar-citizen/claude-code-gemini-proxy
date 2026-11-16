/** Operator-only qualification. An audit reference never grants live authority. */
import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {StrictStage,StrictCode,StrictDiagnostic} from '../src/gemini/client';
import {inspectUsageMetadata} from '../src/gemini/usage';
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
 const body={contents:[{role:'user',parts:[{text:'Reply OK.'}]}],generationConfig:{maxOutputTokens:32000,thinkingConfig:{thinkingLevel:'HIGH'}}};
 let write:ReturnType<typeof writer>;
 try{
  const record=intent(reference,'discovery');write=writer(resolve(dir));
  write('intent.json',{...record,request_sha256:hash(JSON.stringify(body)),endpoint_model:model});
 }catch{throw Error('discovery refused; evidence unavailable, no replay');}
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),35000);
 const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 let stage:StrictStage|'configuration_import'|'result_publication'='configuration_import';
 let code:StrictCode|'configuration_import_started'|'configuration_import_failed'|'invalid_model_version'|'invalid_response'|'invalid_usage'|'result_publication_failed'='configuration_import_failed';
 let observation:'not_observed'|'invocation_attempted'|'http_status_observed'='not_observed';
 let status:number|null=null;
 let client:typeof import('../src/gemini/client')|undefined;
 const diagnostic=(event:StrictDiagnostic)=>{
  // Receipt of status is observable even if its durable publication fails.
  if(event.stage==='http_response'){status=event.upstream_status;observation='http_status_observed';}
  try{
   const name=event.stage==='request_prepared'?'request_prepared.json':event.stage==='transport_invocation'?'send_started.json':'http_response.json';
   write(name,{diagnostic_version:1,...event});
  }catch{stage='diagnostic_persistence';code='diagnostic_persistence_failed';throw Error('discovery diagnostic persistence failed');}
  if(event.stage==='transport_invocation')observation='invocation_attempted';
 };
 try{
  try{write('configuration_import.json',{diagnostic_version:1,stage,code:'configuration_import_started'});}
  catch{stage='diagnostic_persistence';code='diagnostic_persistence_failed';throw Error('discovery diagnostic persistence failed');}
  // config's interactive missing-key path exits the process. Refuse it here so
  // discovery can retain a consumed failure, without changing interactive defaults.
  if(!(process.env.GEMINI_API_KEYS?process.env.GEMINI_API_KEYS.split(',').some(k=>k.trim()):process.env.GEMINI_API_KEY))throw Error('discovery configuration missing');
  client=await import('../src/gemini/client');
  const {config}=await import('../src/config');
  const value:any=await client.callGeminiStrict(body,model,{signal:controller.signal,deadlineMs:30000,maxBytes:2097152,diagnostic});
  stage='response_validation';code='invalid_model_version';
  if(typeof value?.modelVersion!=='string'||! /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.modelVersion)||config.geminiApiKeys.some(key=>value.modelVersion.includes(key)))throw Error('unqualified discovery version');
  code='invalid_response';
  if(controller.signal.aborted||value.promptFeedback?.blockReason||value.candidates?.length!==1||value.candidates[0].finishReason!=='STOP'||value.candidates[0].safetyRatings?.some((r:any)=>r.blocked)||value.candidates[0].content?.role!=='model'||!value.candidates[0].content?.parts?.some((p:any)=>typeof p.text==='string'&&p.text.trim()))throw Error('unqualified discovery response');
  code='invalid_usage';
  const inspected=inspectUsageMetadata(value.usageMetadata);
  // Separate partial observation is never qualification or permission to replay.
  try {
   write('response_observation.json',{diagnostic_version:2,qualification:'UNQUALIFIED',model_version:value.modelVersion,finish_reason:'STOP',usage:inspected.observation});
  } catch {
   stage='diagnostic_persistence';code='diagnostic_persistence_failed';throw Error('discovery diagnostic persistence failed');
  }
  if(inspected.observation.failure)throw Error('invalid discovery usage');
  stage='result_publication';code='result_publication_failed';
  const result={outcome:'observed_only',endpoint_model:model,modelVersion:value.modelVersion,finish:'STOP',usage:inspected.usage,response_sha256:hash(JSON.stringify(value))};write('result.json',result);return result;
 }catch(error){
  let outcome='UNCERTAIN';
  if(client&&error instanceof client.StrictTransportError){
   stage=error.stage;code=error.code;status=error.upstream_status??status;
   if(error.send_started&&observation==='not_observed')observation='invocation_attempted';
   if(error.outcome==='completed_failure')outcome='completed_failure';
  }
  try{write('failure.json',{diagnostic_version:1,outcome,consumed:true,stage,code,transport_observation:observation,upstream_status:status});}
  catch{throw Error('discovery failed; authority consumed, no replay; failure evidence unavailable');}
  throw Error('discovery failed; authority consumed, no replay');
 }
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
