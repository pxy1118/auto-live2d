import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {PerformanceService} from './performance-service';
import {jsonLines} from './ndjson';
import {REVIEW_CANDIDATES,type ReviewCandidate} from './review-candidates';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';
import {FACE_CHANNELS} from '../src/emotion-profiles';
import {streamChannels} from '../src/performance-profile';
import {gestureFingerChannels} from '../src/gesture-library';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const uid=()=>randomUUID().replaceAll('-','');
const fail=(message:string):never=>{throw new Error(message);};
const id=(value:any)=>{if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))fail('样本 ID 不合法');return value;};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
const atomic=(file:string,value:any)=>{const temp=file+'.'+uid()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temp,file);};
export const REVIEW_ISSUES=['动作太少','动作太多','动作僵硬','情绪不对','时机不对','表情不自然'] as const;

export class ReviewStore{
 constructor(readonly root:string){mkdirSync(root,{recursive:true});}
 folder(caseId:string){return join(this.root,id(caseId));}
 get(caseId:string){return read(join(this.folder(caseId),'case.json'));}
 put(value:any){mkdirSync(this.folder(value.id),{recursive:true});atomic(join(this.folder(value.id),'case.json'),value);}
 list(){return readdirSync(this.root).filter(name=>/^[a-f0-9]{32}$/.test(name)&&existsSync(join(this.root,name,'case.json'))).map(name=>this.get(name)).sort((a,b)=>b.created_at.localeCompare(a.created_at));}
 rate(p:any){
  const row=this.get(p.case_id);
  if(![...REVIEW_CANDIDATES,'neither','tie'].includes(p.choice))fail('请选择更喜欢的版本、都不合适或差不多');
  if(typeof p.note!=='string'||p.note.length>1000||!Array.isArray(p.issues)||p.issues.some(x=>!REVIEW_ISSUES.includes(x)))fail('评分备注不合法');
  for(const c of REVIEW_CANDIDATES){
   if(!row.takes[c]?.complete||p.takes?.[c]!==row.takes[c].id)fail('请完整观看三个候选；播放记录已变化时需重新确认');
   const score=p.scores?.[c];if(score!==null&&(!Number.isInteger(score)||score<1||score>5))fail('评分必须是 1～5 或留空');
  }
  const rating={schema:'performance.preference.v1',id:uid(),case_id:row.id,at:new Date().toISOString(),source:'human',choice:p.choice,scores:p.scores,issues:[...new Set(p.issues)],note:p.note,takes:p.takes,audio_sha256:row.audio.sha256,provenance:row.provenance,training_ready:false};
  // Every vote refers to immutable completed takes; later replays never alter it.
  atomic(join(this.folder(row.id),'rating-'+rating.id+'.json'),rating);
  row.latest_rating={id:rating.id,choice:rating.choice,at:rating.at};this.put(row);return rating;
 }
}

/** Local review collection. A frozen audio artifact is reused by all candidates;
 * the normal runtime still performs inference and renders the actual character. */
export class PerformanceReview{
 readonly store:ReviewStore;private preparing:{id:string;abort:AbortController}|null=null;
 private active:{caseId:string;candidate:ReviewCandidate;takeId:string;sessionId:string;stopped:boolean}|null=null;
 private starting=false;private startCancelled=false;private source:any;
 constructor(private performance:PerformanceService,private invoke:(c:any)=>Promise<any>,root:string,private project:string){
  this.store=new ReviewStore(root);
  const files=[...readdirSync(join(project,'src')).filter(n=>n.endsWith('.ts')).map(n=>'src/'+n),...readdirSync(join(project,'contracts')).filter(n=>n.endsWith('.json')).map(n=>'contracts/'+n),'server/performance-service.ts','server/review-candidates.ts','server/performance-review.ts'];
  const hashes=Object.fromEntries(files.map(f=>[f,hash(readFileSync(join(project,f),'utf8'))]));this.source={runtime_version:PERFORMANCE_RUNTIME_VERSION,source_sha256:hash(JSON.stringify(hashes)),files:hashes};
  for(const row of this.store.list()){
   let changed=false;if(row.status==='preparing'){row.status='interrupted';row.error='上次音频准备被中断，请重新准备';changed=true;}
   for(const take of Object.values(row.takes) as any[])if(take.status==='playing'){take.status='interrupted';take.complete=false;take.error='服务重启，请重新播放';changed=true;}
   if(changed)this.store.put(row);
  }
 }
 get busy(){return !!(this.active||this.starting||this.preparing);}
 handles(method:string){return method.startsWith('review.');}
 private view(row:any){return {...row,provenance:{runtime_version:row.provenance.runtime_version,source_sha256:row.provenance.source_sha256},active:this.active?.caseId===row.id?this.active:null,preparing:this.preparing?.id===row.id};}
 async command(method:string,p:any){
  if(!p||typeof p!=='object'||Array.isArray(p))fail('参数不合法');
  if(method==='review.list')return {cases:this.store.list().map(row=>this.view(row)),busy:this.busy,active:this.active};
  if(method==='review.get')return this.view(this.store.get(p.case_id));
  if(method==='review.create')return this.create(p);
  if(method==='review.play')return this.play(p);
  if(method==='review.stop'){await this.stop();return {stopped:true};}
  if(method==='review.rate'){if(this.busy)fail('请先等待播放结束');return this.store.rate(p);}
  fail('未知评分方法');
 }
 private async create(p:any){
  if(this.busy)fail('已有候选正在准备或播放');
  if(typeof p.text!=='string'||!p.text.trim()||p.text.length>180||typeof p.context!=='string'||p.context.length>800)fail('台词需要 1～180 字，语境最多 800 字');
  const caseId=uid(),abort=new AbortController();this.preparing={id:caseId,abort};
  const row:any={schema:'performance.review.case.v1',id:caseId,created_at:new Date().toISOString(),text:p.text.trim(),context:p.context,scenario_id:typeof p.scenario_id==='string'?p.scenario_id.slice(0,80):null,status:'preparing',takes:{},provenance:this.source};
  this.store.put(row);
  try{
   const url=process.env.TTS_URL??'http://127.0.0.1:8769';
   const [tts,model,appearance]=await Promise.all([fetch(url+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()),this.performance.status(),this.invoke({method:'appearance.get'}).then(r=>r.result)]);
   if(!tts.ready||tts.busy||!model.ready)fail('语音或表演模型尚未就绪，或正在使用中');
   const response=await fetch(url+'/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:row.text,seed:41}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)])});
   if(!response.ok||!response.body)fail('准备对比音频失败');
   const events:any[]=[];let bytes=0;
   for await(const e of jsonLines(response.body)){if(e.type==='error')fail(e.error??'语音错误');bytes+=JSON.stringify(e).length;if(bytes>32000000)fail('音频超过限制');events.push(e);}
   const end=events.at(-1);if(events[0]?.type!=='start'||end?.type!=='end'||!events.some(e=>e.type==='chunk'))fail('对比音频不完整');
   const duration=end.total_samples/end.sample_rate*1000;if(!Number.isFinite(duration)||duration<=0||duration>90000)fail('音频时长不合法');
   const content=events.map(e=>JSON.stringify(e)).join('\n')+'\n';writeFileSync(join(this.store.folder(caseId),'audio.ndjson'),content,{flag:'wx'});
   row.status='ready';row.audio={sha256:hash(content),duration_ms:duration,seed:41};row.appearance=appearance;row.provenance={...this.source,model,tts};this.store.put(row);return this.view(row);
  }catch(e:any){row.status=abort.signal.aborted?'cancelled':'error';row.error=e.message;this.store.put(row);throw e;}finally{this.preparing=null;}
 }
 private async play(p:any){
  if(this.busy)fail('请先等待当前播放完成或停止');
  const row=this.store.get(p.case_id),candidate=p.candidate as ReviewCandidate;
  if(row.status!=='ready'||!REVIEW_CANDIDATES.includes(candidate))fail('候选尚未准备好');
  if(row.provenance.source_sha256!==this.source.source_sha256)fail('表演配置已更新，请重新生成这条样本，避免混用版本');
  const content=readFileSync(join(this.store.folder(row.id),'audio.ndjson'),'utf8');if(hash(content)!==row.audio.sha256)fail('音频文件校验失败');
  this.starting=true;this.startCancelled=false;let sessionId:string|undefined;
  try{
   const state=(await this.performance.command({method:'performance.state'})).result;
   if(state.queue&&!['finished','error','cancelled'].includes(state.queue.phase))fail('请先停止当前说话会话');
   const model=await this.performance.status();
   if(!model.ready||model.runtime_version!==row.provenance.model.runtime_version||hash(JSON.stringify(model.run?.models))!==hash(JSON.stringify(row.provenance.model.run?.models)))fail('模型版本已变化或未就绪，请重新准备样本');
   // Wait for the actual native exit; an interrupted arm gesture can take
   // longer than a body beat. Fixed waits can reject the next take as busy.
   await this.invoke({method:'engine.pause',params:{paused:false}});
   await this.invoke({method:'performance.end',params:{}});
   const settle=Date.now();
   for(;;){
    if(this.startCancelled)fail('播放已停止');
    const pose=(await this.invoke({method:'performance.state'})).result;
    if(!pose.motion_actions?.active&&!pose.body_action?.active&&!pose.action_plan?.pending&&!pose.action_plan?.active_segment)break;
    if(Date.now()-settle>8000)fail('上一个动作尚未收回，请稍后重试');
    await sleep(80);
   }
   await sleep(200);
   if(this.startCancelled)fail('播放已停止');
   await this.invoke({method:'appearance.update',params:row.appearance});
   const started=await this.performance.startReview(row.context,{events:content.trim().split('\n').map(s=>JSON.parse(s)),duration:row.audio.duration_ms,candidate});
   sessionId=started.session_id;
   if(this.startCancelled){await this.performance.command({method:'performance.cancel',params:{session_id:started.session_id}});fail('播放已停止');}
   const active={caseId:row.id,candidate,takeId:uid(),sessionId:started.session_id,stopped:false};this.active=active;
   row.takes[candidate]={id:active.takeId,complete:false,status:'playing'};this.store.put(row);
   await this.performance.command({method:'performance.finish',params:{session_id:started.session_id,seq:0,text:row.text}});
   void this.collect(active).catch(()=>{});return this.view(row);
  }catch(e:any){
   if(sessionId)await this.performance.command({method:'performance.cancel',params:{session_id:sessionId}}).catch(()=>{});
   if(row.takes[candidate]?.status==='playing'){row.takes[candidate].status='interrupted';row.takes[candidate].error=e.message;this.store.put(row);}
   this.active=null;throw e;
  }finally{this.starting=false;}
 }
 private async collect(active:NonNullable<PerformanceReview['active']>){
  const take:any={schema:'performance.review.take.v1',id:active.takeId,case_id:active.caseId,candidate:active.candidate,session_id:active.sessionId,started_at:new Date().toISOString(),sample_interval_ms:100,samples:[],complete:false};
  try{
   const begin=Date.now();
   while(Date.now()-begin<150000){
    if(active.stopped)break;
    const [state,performance]=await Promise.all([this.invoke({method:'state.get'}).then(r=>r.result),this.performance.command({method:'performance.state'}).then(r=>r.result)]);
    if(performance.session_id!==active.sessionId)throw Error('播放会话已切换');
    const channels=[...new Set([...FACE_CHANNELS,...streamChannels,...gestureFingerChannels,'ParamMouthOpenY'])];
    if(take.audio_origin_actor_ms===undefined&&state.speech.phase==='playing')take.audio_origin_actor_ms=performance.actor_ms-state.speech.audio_time_ms;
    take.samples.push({wall_ms:Date.now()-begin,audio_ms:state.speech.audio_time_ms,playback_phase:state.speech.phase,actor_ms:performance.actor_ms,clause:performance.clause,affect:performance.affect,affect_vector:performance.affect_vector,planner_state:performance.planner_state,expression:performance.expression,body:performance.body_action,gesture:performance.motion_actions,actual:Object.fromEntries(channels.map(k=>[k,state.values[k]]))});
    take.plans=performance.plan_history;take.actions=performance.action_history;take.metrics=performance.queue?.metrics;
    if(performance.queue?.error)throw Error(performance.queue.error);
    if(performance.queue?.phase==='finished'&&!state.speech.active){take.complete=!active.stopped&&take.samples.some(s=>s.playback_phase==='playing');break;}
    if(performance.queue?.phase==='cancelled')break;
    await sleep(100);
   }
   if(!take.complete)take.error=active.stopped?'播放被停止':'未完整播放';
  }catch(e:any){take.error=e.message;}finally{
   if(!take.complete)await this.performance.command({method:'performance.cancel',params:{session_id:active.sessionId}}).catch(()=>{});
   take.finished_at=new Date().toISOString();const row=this.store.get(active.caseId);take.audio_sha256=row.audio.sha256;take.provenance=row.provenance;
   atomic(join(this.store.folder(row.id),'take-'+take.id+'.json'),take);
   row.takes[active.candidate]={id:take.id,complete:take.complete,status:take.complete?'completed':'interrupted',error:take.error,samples:take.samples.length};this.store.put(row);
   if(this.active===active)this.active=null;
  }
 }
 async stop(){this.startCancelled=true;if(this.preparing)this.preparing.abort.abort();const a=this.active;if(a){a.stopped=true;await this.performance.command({method:'performance.cancel',params:{session_id:a.sessionId}}).catch(()=>{});}}
 disconnect(){this.startCancelled=true;if(this.preparing)this.preparing.abort.abort();if(this.active)this.active.stopped=true;}
}
