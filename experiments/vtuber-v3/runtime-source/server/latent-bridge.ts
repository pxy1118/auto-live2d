import { randomUUID } from 'node:crypto';
import { Controller, type Manifest } from '../src/controller';

export class LatentBridge {
  private predictions=new Map<string,{result:any;time:number}>();
  constructor(private manifest:Manifest,private capabilities:()=>any,private invoke:(cmd:any)=>Promise<any>){}
  private async worker(path:string,body?:any){
    const response=await fetch((process.env.LATENT_URL||'http://127.0.0.1:8768')+path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(body===undefined?2500:60000)});
    const data:any=await response.json();if(!response.ok)throw new Error(data.error??'动作专家请求失败');return data;
  }
  async status(){try{return await this.worker('/health')}catch{return{ready:false,message:'动作专家未启动，请运行 start.ps1'}}}
  async predict(input:any){
    const result=await this.worker('/predict',input);
    if(result.profile_sha256!==this.manifest.actionProfile.sha256||result.asset_hash!==this.manifest.assetHash)throw new Error('模型与角色不匹配');
    const cap=this.capabilities();
    if(cap)new Controller(cap.parameters,this.manifest,cap.parts.map((p:any)=>p.id)).execute('trajectory.play',result.command.params);
    const id=randomUUID();this.predictions.set(id,{result,time:Date.now()});while(this.predictions.size>20)this.predictions.delete(this.predictions.keys().next().value!);
    return{...result,prediction_id:id};
  }
  async execute(input:any){
    const saved=this.predictions.get(input?.prediction_id);if(!saved||Date.now()-saved.time>300000)throw new Error('预测不存在或已过期');
    const state=(await this.invoke({method:'state.get'})).result;if(state.recording)throw new Error('请先保存当前录制，再从初始姿态演示');
    this.predictions.delete(input.prediction_id);
    await this.invoke({method:'engine.reset',params:{paused:!!input.paused,preserve_background:true}});
    await this.invoke({method:'behavior.set',params:{idle:true,breath:true,blink:true,physicsEnabled:true}});
    return this.invoke(saved.result.command);
  }
}
