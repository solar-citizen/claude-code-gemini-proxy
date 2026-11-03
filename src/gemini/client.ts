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

export class StrictTransportError extends Error {
  constructor(public outcome: 'rejected'|'completed_failure'|'uncertain', public send_started: boolean,
              public upstream_status?: number) { super('strict_transport'); }
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

export async function callGeminiStrict(body:unknown,model:string,options:{signal:AbortSignal;deadlineMs:number;maxBytes:number}):Promise<unknown>{
  if(model!=='gemini-3.5-flash-lite'||options.signal.aborted||!Number.isInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>2097152||options.deadlineMs<=0||options.deadlineMs>30000)
    throw new StrictTransportError('rejected',false);
  const controller=new AbortController();const abort=()=>controller.abort();
  options.signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,options.deadlineMs);let started=false;
  try {
    if(options.signal.aborted)throw new StrictTransportError('rejected',false);
    started=true;
    const response=await raceStrictAbort(fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',{
      method:'POST',redirect:'error',headers:{'content-type':'application/json','x-goog-api-key':config.geminiApiKey},
      body:JSON.stringify(body),signal:controller.signal,
    }),controller.signal);
    if(response.status!==200){
      // A known HTTP rejection is definitive only after its bounded body ends.
      if(response.body)await readBoundedBody(response.body,options.maxBytes,controller.signal);
      throw new StrictTransportError([400,401,403,404,429].includes(response.status)?'completed_failure':'uncertain',true,response.status);
    }
    const bytes=await readBoundedBody(response.body,options.maxBytes,controller.signal);
    const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(controller.signal.aborted)throw new StrictTransportError('uncertain',true);
    return result;
  }catch(error){controller.abort();if(error instanceof StrictTransportError)throw error;throw new StrictTransportError(started?'uncertain':'rejected',started);}
  finally{clearTimeout(timer);options.signal.removeEventListener('abort',abort);}
}
