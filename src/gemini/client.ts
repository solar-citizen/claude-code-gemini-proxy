import { config } from "../config";
import { stripModelSuffix } from "./tier";

export async function callGeminiRaw(
  body: GeminiRequestBody,
  model: string,
  timeoutMs: number,
  apiKey?: string,
): Promise<Response> {
  const key = apiKey ?? config.geminiApiKey;
  const strippedModel = stripModelSuffix(model);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${strippedModel}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// Closed diagnostic vocabulary: never include exception text, URLs, headers or bodies.
export type StrictStage = 'local_validation'|'request_prepared'|'transport_invocation'|'transport'|'http_response'|'response_body'|'response_validation'|'diagnostic_persistence';
export type StrictCode = 'local_validation_failed'|'request_prepared'|'invocation_attempted'|'transport_exception'|'request_timeout'|'request_aborted'|'status_received'|'http_error'|'body_failure'|'invalid_json'|'diagnostic_persistence_failed';
export type StrictDiagnostic =
  | {stage:'request_prepared';code:'request_prepared'}
  | {stage:'transport_invocation';code:'invocation_attempted'}
  | {stage:'http_response';code:'status_received';upstream_status:number};

// Exact runtime reports only; these tokens do not prove remote receipt or cause.
const STRICT_RUNTIME_CODES = new Set(['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','ENOTFOUND','EAI_AGAIN',
  'ConnectionRefused','ConnectionClosed','FailedToOpenSocket','CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
function strictRuntimeCode(error:unknown):string {
  try {
    // Never read message/stack/cause or invoke a code getter.
    const code=error instanceof Error?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;
    return typeof code==='string'&&STRICT_RUNTIME_CODES.has(code)?code:'unknown';
  }catch{return 'unknown';}
}
export class StrictTransportError extends Error {
  constructor(public outcome: 'rejected'|'completed_failure'|'uncertain', public send_started: boolean,
              public upstream_status?: number, public stage:StrictStage='transport',
              public code:StrictCode='transport_exception', public runtime_code:string='unknown') { super('strict_transport'); }
}

export function raceStrictAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new StrictTransportError('uncertain',true));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    if(signal.aborted)abort();
  });
}

export async function readBoundedBody(body: ReadableStream<Uint8Array>|null, maxBytes:number, signal:AbortSignal):Promise<Uint8Array> {
  if(!body) throw new StrictTransportError('uncertain',true);
  const reader=body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){
      const next=await raceStrictAbort(reader.read(),signal);
      if(next.done)break;
      size+=next.value.byteLength;
      if(size>maxBytes)throw new StrictTransportError('uncertain',true);
      chunks.push(next.value);
    }
    const result=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
    return result;
  } finally { void reader.cancel().catch(()=>{}); }
}

export async function callGeminiStrict(body:unknown,model:string,options:{signal:AbortSignal;deadlineMs:number;maxBytes:number;diagnostic?:(event:StrictDiagnostic)=>void}):Promise<unknown>{
  if(model!=='gemini-3.5-flash-lite'||options.signal.aborted||!Number.isInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>2097152||options.deadlineMs<=0||options.deadlineMs>30000)
    throw new StrictTransportError('rejected',false,undefined,'local_validation','local_validation_failed');
  const controller=new AbortController();const abort=()=>controller.abort();
  options.signal.addEventListener('abort',abort,{once:true});
  let timedOut=false;let diagnosticFailed=false;
  const timer=setTimeout(()=>{timedOut=true;abort();},options.deadlineMs);
  let started=false;let status:number|undefined;
  let outcome:StrictTransportError['outcome']='rejected';
  let stage:StrictStage='local_validation';let code:StrictCode='local_validation_failed';
  const diagnostic=(event:StrictDiagnostic)=>{
    try{options.diagnostic?.(event);}
    catch{diagnosticFailed=true;stage='diagnostic_persistence';code='diagnostic_persistence_failed';throw Error('strict_transport');}
  };
  try {
    // Complete local request preparation before the durable send boundary.
    const request:RequestInit={method:'POST',redirect:'error',headers:{'content-type':'application/json','x-goog-api-key':config.geminiApiKey},body:JSON.stringify(body),signal:controller.signal};
    diagnostic({stage:'request_prepared',code:'request_prepared'});
    if(controller.signal.aborted)throw Error('strict_transport');
    // Synchronous observer must finish (including fsync) before entering fetch.
    // This is a conservative local boundary, never proof of remote receipt/billing.
    diagnostic({stage:'transport_invocation',code:'invocation_attempted'});
    started=true;outcome='uncertain';stage='transport';code='transport_exception';
    const response=await raceStrictAbort(fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',request),controller.signal);
    status=response.status;
    diagnostic({stage:'http_response',code:'status_received',upstream_status:status});
    stage='response_body';code='body_failure';
    if(status!==200){
      // A known HTTP rejection is definitive only after its bounded body ends.
      if(response.body)await readBoundedBody(response.body,options.maxBytes,controller.signal);
      if(controller.signal.aborted)throw Error('strict_transport');
      outcome=[400,401,403,404,429].includes(status)?'completed_failure':'uncertain';
      stage='http_response';code='http_error';throw Error('strict_transport');
    }
    const bytes=await readBoundedBody(response.body,options.maxBytes,controller.signal);
    stage='response_validation';code='invalid_json';
    const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(controller.signal.aborted)throw Error('strict_transport');
    return result;
  }catch(error){
    let runtime_code='unknown';
    if(started&&controller.signal.aborted&&!diagnosticFailed)code=timedOut?'request_timeout':'request_aborted';
    else if(stage==='transport'||stage==='response_body')runtime_code=strictRuntimeCode(error);
    controller.abort();throw new StrictTransportError(outcome,started,status,stage,code,runtime_code);
  }
  finally{clearTimeout(timer);options.signal.removeEventListener('abort',abort);}
}
