import {jsonLines} from './ndjson';

/** Read TTS concurrently with planning, then release PCM as soon as the plan is valid. */
export async function* semanticAudio(body:ReadableStream<Uint8Array>,ready:Promise<unknown>,observe:(event:any)=>void,cancel:()=>void){
 const queue:any[]=[];let bytes=0,done=false,error:unknown,wake:()=>void=()=>{};
 const producer=(async()=>{try{
  for await(const event of jsonLines(body)){
   if(event.type==='error')throw new Error(event.error);
   bytes+=JSON.stringify(event).length;if(bytes>32000000)throw new Error('语音缓冲超过限制');
   observe(event);queue.push(event);wake();
  }
 }catch(e){error=e;cancel();}finally{done=true;wake();}})();
 try{
  await ready;
  for(;;){
   if(error)throw error;
   if(queue.length){yield queue.shift();continue;}
   if(done)break;
   await new Promise<void>(resolve=>{wake=resolve;});
  }
 }finally{if(!done)cancel();await producer;}
}
