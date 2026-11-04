/** Bounded incremental JSON lines; truncation must never look like success. */
export async function* jsonLines(body:ReadableStream<Uint8Array>){
  const reader=body.getReader(),decoder=new TextDecoder();let pending='';
  try{
    for(;;){
      const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});
      if(pending.length>1024*1024)throw new Error('语音流数据过大');
      let end:number;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(line.trim())yield JSON.parse(line);}
      if(done){if(pending.trim())throw new Error('语音流中断');break;}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
