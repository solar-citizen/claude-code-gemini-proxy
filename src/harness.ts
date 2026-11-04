/** Opt-in Harness protocol. No durable job or spending authority lives here.
 * Exact JSON schemas are preserved via FunctionDeclaration.parametersJsonSchema:
 * https://ai.google.dev/api/generate-content#FunctionDeclaration
 * Real model/version/signature support requires separate live qualification.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {config} from './config';
import {translateHarnessGeneration} from './gemini/effort';
import {callGeminiStrict,StrictTransportError,readBoundedBody} from './gemini/client';
import {buildSseStream} from './anthropic/sse';
import {inspectUsageMetadata} from './gemini/usage';

const SCHEMAS: Record<string,unknown> = {
  "Edit": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "file_path": {
        "description": "The absolute path to the file to modify",
        "type": "string"
      },
      "old_string": {
        "description": "The text to replace",
        "type": "string"
      },
      "new_string": {
        "description": "The text to replace it with (must be different from old_string)",
        "type": "string"
      },
      "replace_all": {
        "description": "Replace all occurrences of old_string (default false)",
        "default": false,
        "type": "boolean"
      }
    },
    "required": [
      "file_path",
      "old_string",
      "new_string"
    ],
    "additionalProperties": false
  },
  "Read": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "file_path": {
        "description": "The absolute path to the file to read",
        "type": "string"
      },
      "offset": {
        "description": "The line number to start reading from. Only provide if the file is too large to read at once",
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "limit": {
        "description": "The number of lines to read. Only provide if the file is too large to read at once.",
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "pages": {
        "description": "Page range for PDF files (e.g., \"1-5\", \"3\", \"10-20\"). Only applicable to PDF files. Maximum 20 pages per request.",
        "type": "string"
      },
      "allow_large": {
        "description": "Set to true to read a text file, or a line range of one, that is over the usual size limits, up to what still fits in your context. Only use this when you genuinely need all of it or the user asked for the whole file; otherwise read it in parts with offset and limit, or search it.",
        "type": "boolean"
      }
    },
    "required": [
      "file_path"
    ],
    "additionalProperties": false
  }
};
type ObjectValue=Record<string,unknown>;
type Outcome='rejected'|'completed_failure'|'uncertain';
class ContractError extends Error { constructor(public code:string,public outcome:Outcome='rejected'){super(code);} }
function reject(code:string,outcome:Outcome='rejected'):never{throw new ContractError(code,outcome);}
function object(value:unknown):ObjectValue{if(!value||typeof value!=='object'||Array.isArray(value))reject('invalid_object');return value as ObjectValue;}
function keys(value:ObjectValue,allowed:string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))reject('unsupported_field');}
function text(value:unknown):string{if(typeof value!=='string')reject('invalid_text');return value;}
function array(value:unknown):unknown[]{if(!Array.isArray(value))reject('invalid_array');return value;}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as ObjectValue)[key])).join(',')+'}';
 return JSON.stringify(value);
}
export const strictDigest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function semanticSchema(value:unknown):unknown{
 if(Array.isArray(value))return value.map(semanticSchema);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='description').map(([key,item])=>[key,semanticSchema(item)]));
 return value;
}
function cache(value:unknown){if(value===undefined)return;const record=object(value);keys(record,['type']);if(record.type!=='ephemeral')reject('unsupported_cache_hint');}
function cleanText(value:unknown):ObjectValue{const record=object(value);keys(record,['type','text','cache_control']);cache(record.cache_control);if(record.type!=='text')reject('unsupported_content');return {type:'text',text:text(record.text)};}
function argumentsFor(name:string,value:unknown):ObjectValue {
 if(!Object.hasOwn(SCHEMAS,name))reject('unsupported_tool');
 const schema=object(SCHEMAS[name]);const args=object(value);const properties=object(schema.properties);
 keys(args,Object.keys(properties));
 if(array(schema.required).some(key=>!(text(key) in args)))reject('missing_tool_argument');
 for(const [key,value]of Object.entries(args)){
  const rule=object(properties[key]);
  if(rule.type==='string'&&typeof value!=='string'||rule.type==='boolean'&&typeof value!=='boolean'
    ||rule.type==='integer'&&(typeof value!=='number'||!Number.isSafeInteger(value)))reject('invalid_tool_argument');
  if(typeof value==='number'&&(typeof rule.minimum==='number'&&value<rule.minimum||typeof rule.maximum==='number'&&value>rule.maximum||typeof rule.exclusiveMinimum==='number'&&value<=rule.exclusiveMinimum))reject('invalid_tool_argument');
 }
 // The pinned CLI materializes the captured schema's explicit default in history.
 // Normalize only that declared default; never mutate the signed upstream part.
 return name==='Edit'?{replace_all:false,...args}:{...args};
}
function normalizeMessages(value:unknown):ObjectValue[]{
 return array(value).map(message=>{
  const m=object(message);keys(m,['role','content']);if(m.role!=='user'&&m.role!=='assistant')reject('unsupported_role');
  const content=typeof m.content==='string'?[{type:'text',text:m.content}]:array(m.content).map(block=>{
   const b=object(block);cache(b.cache_control);
   if(b.type==='text')return cleanText(b);
   if(b.type==='tool_use'){
    keys(b,['type','id','name','input']);if(m.role!=='assistant'||!['Read','Edit'].includes(text(b.name)))reject('unsupported_tool');
    return {type:'tool_use',id:text(b.id),name:b.name,input:argumentsFor(text(b.name),b.input)};
   }
   if(b.type==='tool_result'){
    keys(b,['type','tool_use_id','content','is_error','cache_control']);if(m.role!=='user'||b.is_error!==undefined&&typeof b.is_error!=='boolean')reject('invalid_tool_result');
    if(b.is_error===true)reject('failed_tool_result');
    const content=typeof b.content==='string'?b.content:array(b.content).map(cleanText);
    return {type:'tool_result',tool_use_id:text(b.tool_use_id),content,is_error:false};
   }
   return reject('unsupported_content');
  });
  if(!content.length)reject('empty_message');return {role:m.role,content};
 });
}
function validateRequest(value:unknown){
 const q=object(value);keys(q,['model','messages','system','tools','metadata','max_tokens','thinking','context_management','output_config','stream']);
 if(!['gemini-3.5-flash-lite','gemini-3.5-flash-lite[1m]'].includes(text(q.model))||q.stream!==true)reject('unsupported_model_or_stream');
 if(q.metadata!==undefined){const m=object(q.metadata);keys(m,['user_id']);text(m.user_id);} // Identification only, never forwarded.
 if(q.context_management!==undefined&&canonical(q.context_management)!==canonical({edits:[{type:'clear_thinking_20251015',keep:'all'}]}))reject('unsupported_context_management'); // Retain all; strict emits no thought blocks.
 const system=typeof q.system==='string'?[{type:'text',text:q.system}]:array(q.system).map(cleanText);
 const tools=array(q.tools);if(tools.length!==2)reject('unsupported_tools');const names=new Set<string>();
 const declarations=tools.map(tool=>{
  const t=object(tool);keys(t,['name','description','input_schema','cache_control']);cache(t.cache_control);
  const name=text(t.name);if(!Object.hasOwn(SCHEMAS,name)||names.has(name))reject('unsupported_tools');names.add(name);
  if(canonical(semanticSchema(t.input_schema))!==canonical(semanticSchema(SCHEMAS[name])))reject('unsupported_schema');
  return {name,description:text(t.description),parametersJsonSchema:t.input_schema};
 });
 return {q,messages:normalizeMessages(q.messages),system,tools:[{functionDeclarations:declarations}],context:strictDigest(canonical({model:q.model,system,tools:declarations,thinking:q.thinking,output:q.output_config,max_tokens:q.max_tokens}))};
}
function startupIdentity():string{
 const root=import.meta.dir;const hash=createHash('sha256');
 function visit(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(entry.isDirectory())visit(path);else if(entry.isFile()&&entry.name.endsWith('.ts'))hash.update(relative(root,path)).update('\0').update(readFileSync(path));}}
 visit(root);for(const file of ['package.json','global.d.ts'])hash.update(file).update(readFileSync(join(root,'..',file)));
 return hash.digest('hex');
}
type Call={block:ObjectValue;part:ObjectValue};
type Attempt={id:string;created:number;sequence:number;closed:boolean;busy:boolean;history:string;historyLength:number;context:string;calls:Map<string,Call>;modelParts:Map<number,ObjectValue[]>;pending:string[];inputBytes:number;outputBytes:number;callBytes:number;};
export type HarnessOptions={enabled:boolean;versions:string[];qualificationObserver?:(phase:"before_send"|"after_response",evidence:Record<string,unknown>)=>void;maxRequestTokens?:number;maxUpstreamTokens?:number;deadlineMs?:number;now?:()=>number};
export function createHarnessHandler(options:HarnessOptions){
 const enabled=options.enabled, deadlineMs=options.deadlineMs??30000;
 const policy=Object.freeze({max_request_tokens:options.maxRequestTokens??32000,max_upstream_tokens:options.maxUpstreamTokens??32000});
 const versions=Object.freeze([...options.versions]);const instance=randomUUID();const source=startupIdentity();const now=options.now??(()=>performance.now());
 let active:Attempt|undefined;
 const limits=Object.freeze({max_requests:6,wall_seconds:180,max_bytes:2097152,total_bytes:12582912,max_calls:32,call_bytes:262144,state_seconds:240});
 const presentation={requested:'updates',effective:'unavailable',degraded:true};
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 return async function handle(req:Request):Promise<Response>{
  const url=new URL(req.url);
  const refuse=(error:string,status:number)=>json({error,receipt:{protocol:'harness-gemini-v1',instance,source_sha256:source,outcome:'rejected',send_started:false,send_count:0}},status);
  if(!enabled)return refuse('strict_disabled',404);
  if(req.headers.has('origin'))return refuse('origin_forbidden',403);
  if(url.pathname==='/harness/capabilities'&&req.method==='GET'&&!url.search)return json({protocol:'harness-gemini-v1',instance,source_sha256:source,models:['gemini-3.5-flash-lite','gemini-3.5-flash-lite[1m]'],upstream_versions:versions,limits,translation:{version:'claude-adaptive-high-gemini-high-v1',caps:policy},presentation});
  if(url.pathname!=='/harness/v1/messages'||req.method!=='POST'||url.search)return refuse('strict_route_not_found',404);
  let started=false;let requestHash:string|null=null;let state:Attempt|undefined;let translation:ReturnType<typeof translateHarnessGeneration>|undefined;let upstreamVersion:string|null=null;let requestedModel:unknown=null;let finish:unknown=null;
  const rawAttempt=req.headers.get('x-harness-attempt');
  const attempt=rawAttempt&&/^[a-zA-Z0-9_-]{1,128}$/.test(rawAttempt)?rawAttempt:null;const sequence=Number(req.headers.get('x-harness-sequence'));
  const baseReceipt=()=>({protocol:'harness-gemini-v1',instance,source_sha256:source,attempt_id:attempt,sequence,request_sha256:requestHash,requested_model:requestedModel,endpoint_model:'gemini-3.5-flash-lite',upstream_model_version:upstreamVersion,finish_reason:finish,send_started:started,send_count:started?1:0,translation:translation??null});
  try{
   if(active&&now()-active.created>=240000){active=undefined;}
   if(!attempt||! /^[a-zA-Z0-9_-]{1,128}$/.test(attempt)||!Number.isInteger(sequence)||sequence<1||sequence>6||req.headers.get('x-harness-instance')!==instance||req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')reject('invalid_binding');
   if(active?.id===attempt){state=active;if(state.closed||state.busy)reject('attempt_closed_or_busy');}
   else {
    if(sequence!==1||active&&!active.closed)reject('attempt_not_available');
    state={id:attempt,created:now(),sequence:0,closed:false,busy:false,history:'',historyLength:0,context:'',calls:new Map(),modelParts:new Map(),pending:[],inputBytes:0,outputBytes:0,callBytes:0};active=state;
   }
   if(sequence!==state.sequence+1||now()-state.created>=180000)reject('sequence_or_wall_limit');
   state.busy=true;
   const controller=new AbortController();const abort=()=>controller.abort();req.signal.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(abort,Math.min(30000,Math.max(1,180000-(now()-state.created))));if(req.signal.aborted)abort();let bytes:Uint8Array;
   try{bytes=await readBoundedBody(req.body,limits.max_bytes,controller.signal);}catch{reject('invalid_request_body');}finally{clearTimeout(timer);req.signal.removeEventListener('abort',abort);}
   requestHash=strictDigest(bytes);if(req.headers.get('x-harness-input-sha256')!==requestHash)reject('request_digest_mismatch');
   state.inputBytes+=bytes.length;if(state.inputBytes>limits.total_bytes)reject('request_capacity');
   const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   const valid=validateRequest(input);requestedModel=valid.q.model;
   try{translation=translateHarnessGeneration(valid.q,policy);}catch{reject('unsupported_generation_contract');}
   if(!versions.length)reject('upstream_version_unqualified');
   if(sequence===1){if(valid.messages.length!==1||valid.messages[0].role!=='user'||array(valid.messages[0].content).some(b=>object(b).type!=='text'))reject('invalid_initial_history');state.context=valid.context;}
   else {
    if(valid.context!==state.context||strictDigest(canonical(valid.messages.slice(0,state.historyLength)))!==state.history||valid.messages.length!==state.historyLength+1)reject('mutated_history');
    const newest=valid.messages.at(-1)!;if(newest.role!=='user')reject('missing_tool_results');const seen=new Set<string>();
    for(const b of array(newest.content).map(object)){
     if(b.type==='text')continue;
     const id=text(b.tool_use_id);if(b.type!=='tool_result'||!state.pending.includes(id)||seen.has(id))reject('unknown_or_duplicate_tool_result');seen.add(id);
    }
    if(seen.size!==state.pending.length)reject('missing_tool_results');
   }
   const contents=valid.messages.map((m,index)=>({role:m.role==='assistant'?'model':'user',parts:state!.modelParts.get(index)??array(m.content).map(block=>{
    const b=object(block);if(b.type==='text')return {text:b.text};
    if(b.type==='tool_use'){const call=state!.calls.get(text(b.id));if(!call||canonical(call.block)!==canonical(b))reject('unknown_or_mutated_tool_call');return call.part;}
    const call=state!.calls.get(text(b.tool_use_id));if(!call)reject('unknown_tool_result');
    const fc=object(call.part.functionCall);
    return {functionResponse:{...(fc.id!==undefined?{id:fc.id}:{}),name:fc.name,response:{content:b.content,is_error:false}}};
   })}));
   if(req.signal.aborted)reject('client_disconnected');
   if(now()-state.created>=180000)reject('wall_limit');
   const exchangeEnd=now()+Math.min(deadlineMs,Math.max(1,180000-(now()-state.created)));
   const upstreamBody={contents,generationConfig:translation.generationConfig,systemInstruction:{parts:valid.system.map(b=>({text:b.text}))},tools:valid.tools};
   const observed={attempt_id:attempt,sequence,request_sha256:requestHash,instance,source_sha256:source};
   options.qualificationObserver?.('before_send',{...observed,body:upstreamBody});
   if(now()>=exchangeEnd||req.signal.aborted)reject('exchange_deadline');
   started=true;
   const response=await callGeminiStrict(upstreamBody,'gemini-3.5-flash-lite',{signal:req.signal,deadlineMs:Math.min(30000,Math.max(1,exchangeEnd-now())),maxBytes:limits.max_bytes});
   if(now()-state.created>=180000)reject('wall_limit','uncertain');
   if(state.closed||req.signal.aborted)reject('attempt_interrupted','uncertain');
   options.qualificationObserver?.('after_response',{...observed,body:response});
   if(now()>=exchangeEnd||req.signal.aborted)reject('exchange_deadline','uncertain');
   const result=object(response);keys(result,['modelVersion','candidates','usageMetadata','promptFeedback','responseId','createTime']);upstreamVersion=typeof result.modelVersion==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(result.modelVersion)?result.modelVersion:null;
   if(object(result.promptFeedback??{}).blockReason)reject('blocked_generation','completed_failure');
   const candidates=array(result.candidates);if(candidates.length!==1)reject('candidate_count','uncertain');
   const candidate=object(candidates[0]);keys(candidate,['content','finishReason','index','safetyRatings','avgLogprobs']);finish=typeof candidate.finishReason==='string'&&/^[A-Z_]{1,64}$/.test(candidate.finishReason)?candidate.finishReason:null;
   if(['MAX_TOKENS','SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','MALFORMED_FUNCTION_CALL','UNEXPECTED_TOOL_CALL','IMAGE_SAFETY'].includes(String(finish)))reject('generation_failed','completed_failure');
   if(finish!=='STOP')reject('missing_or_unknown_finish','uncertain');
   if(!upstreamVersion||!versions.includes(upstreamVersion))reject('upstream_identity','uncertain');
   if(candidate.safetyRatings!==undefined)for(const rating of array(candidate.safetyRatings)){if(object(rating).blocked===true)reject('blocked_generation','completed_failure');}
   const content=object(candidate.content);keys(content,['role','parts']);if(content.role!=='model')reject('unsupported_response_role','uncertain');
   const parts=array(content.parts).map(object);if(!parts.length)reject('empty_response','uncertain');
   const blocks:AnthropicOutputBlock[]=[];const pending:string[]=[];
   for(const part of parts){
    keys(part,['text','functionCall','thoughtSignature']);
    if(part.thoughtSignature!==undefined&&(typeof part.thoughtSignature!=='string'||!part.thoughtSignature||part.thoughtSignature.length>65536))reject('invalid_signature','uncertain');
    if(typeof part.text==='string'&&part.functionCall===undefined){if(!part.text.trim())reject('empty_response','uncertain');blocks.push({type:'text',text:part.text});}
    else if(part.functionCall!==undefined&&part.text===undefined){
     const call=object(part.functionCall);keys(call,['name','args','id']);const name=text(call.name);if(!Object.hasOwn(SCHEMAS,name)||typeof part.thoughtSignature!=='string')reject('unsupported_call_or_signature','uncertain');
     if(call.id!==undefined&&(typeof call.id!=='string'||!call.id||call.id.length>256))reject('invalid_function_id','uncertain');
     if(call.id!==undefined&&[...state.calls.values()].some(previous=>object(previous.part.functionCall).id===call.id))reject('duplicate_function_id','uncertain');
     const args=argumentsFor(name,call.args);const id='toolu_'+randomUUID().replaceAll('-','');const block={type:'tool_use' as const,id,name,input:args};
     state.calls.set(id,{block,part});state.callBytes+=new TextEncoder().encode(canonical({block,part})).length;
     if(state.calls.size>32||state.callBytes>262144)reject('tool_state_limit','uncertain');blocks.push(block);pending.push(id);
    }else reject('malformed_response_part','uncertain');
   }
   const inspected=inspectUsageMetadata(result.usageMetadata);
   if(inspected.observation.failure)reject('invalid_usage','uncertain');
   const usage=inspected.usage;
   const sse=await new Response(buildSseStream(blocks,pending.length?'tool_use':'end_turn',text(valid.q.model),{input_tokens:Number(usage?.promptTokenCount??0),output_tokens:Number(usage?.candidatesTokenCount??0)})).text();
   const envelope={receipt:{...baseReceipt(),outcome:'completed',response_sha256:strictDigest(sse),usage},anthropic_sse:sse};
   const serialized=JSON.stringify(envelope);const size=new TextEncoder().encode(serialized).length;
   if(size>limits.max_bytes||state.outputBytes+size>limits.total_bytes)reject('response_capacity','uncertain');
   state.outputBytes+=size;state.sequence=sequence;state.pending=pending;state.busy=false;state.closed=!pending.length;
   state.modelParts.set(valid.messages.length,parts);
   state.historyLength=valid.messages.length+1;state.history=strictDigest(canonical([...valid.messages,{role:'assistant',content:blocks}]));
   if(now()>=exchangeEnd||req.signal.aborted)reject('exchange_deadline','uncertain');
   return new Response(serialized,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(error){
   if(state){state.closed=true;state.busy=false;}
   let outcome:Outcome=started?'uncertain':'rejected';let code='strict_contract';let status:number|undefined;
   if(error instanceof StrictTransportError){outcome=error.outcome;started=error.send_started;status=error.upstream_status;code='strict_transport';}
   else if(error instanceof ContractError){code=error.code;outcome=started&&error.outcome==='rejected'?'uncertain':error.outcome;}
   return json({error:code,receipt:{...baseReceipt(),outcome,...(status!==undefined?{upstream_status:status}:{})}},outcome==='rejected'?400:502);
  }
 };
}
export const handleHarnessRequest=createHarnessHandler({enabled:config.harnessStrictEnabled,versions:config.harnessModelVersions,maxRequestTokens:config.harnessMaxRequestTokens,maxUpstreamTokens:config.harnessMaxUpstreamTokens});
