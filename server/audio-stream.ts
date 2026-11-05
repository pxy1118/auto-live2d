import {jsonLines} from './ndjson';
/** Begin draining TTS immediately, including while this unit waits in lookahead. */
export function bufferedAudio(body:ReadableStream<Uint8Array>,ready:Promise<unknown>,observe:(event:any)=>void,cancel:()=>void){
  const queue:any[]=[];let bytes=0,done=false,error:unknown,wake:()=>void=()=>{};
  const producer=(async()=>{try{
    for await(const event of jsonLines(body)){
      if(event.type==='error')throw new Error(event.error);
      const size=JSON.stringify(event).length;bytes+=size;if(bytes>32000000)throw new Error('语音缓冲超过限制');
      observe(event);queue.push({event,size});wake();
    }
  }catch(value){error=value;cancel();}finally{done=true;wake();}})();
  async function* events(){
    await ready;
    for(;;){
      if(error)throw error;
      if(queue.length){const next=queue.shift();bytes-=next.size;yield next.event;continue;}
      if(done)return;
      await new Promise<void>(resolve=>{wake=resolve;});
    }
  }
  return {events:events(),close:async()=>{if(!done)cancel();await producer;}};
}
