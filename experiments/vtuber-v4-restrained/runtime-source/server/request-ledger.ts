/** Retain recent responses, and remember retired IDs so a retry can never execute twice. */
export class RequestLedger {
  private recent=new Map<string,{key:string;promise:Promise<any>}>();
  private retired=new Set<string>();
  constructor(private limit=512){}
  execute(id:string,key:string,operation:()=>Promise<any>){
    const old=this.recent.get(id);
    if(old)return old.key===key?old.promise:Promise.reject(Object.assign(new Error('相同 request_id 不得用于不同命令'),{code:'request_id_conflict'}));
    if(this.retired.has(id))return Promise.reject(Object.assign(new Error('request_id 的响应已过期；该请求不会重复执行'),{code:'request_id_expired'}));
    const promise=Promise.resolve().then(operation);this.recent.set(id,{key,promise});
    while(this.recent.size>this.limit){const first=this.recent.keys().next().value!;this.retired.add(first);this.recent.delete(first);}
    return promise;
  }
  retireAll(){for(const id of this.recent.keys())this.retired.add(id);this.recent.clear();}
}
