import { CubismFramework, Option, LogLevel } from '../vendor/cubism/Framework/src/live2dcubismframework';
import { CubismUserModel } from '../vendor/cubism/Framework/src/model/cubismusermodel';
import { CubismMatrix44 } from '../vendor/cubism/Framework/src/math/cubismmatrix44';
import { CubismPhysics, Options } from '../vendor/cubism/Framework/src/physics/cubismphysics';
import { Controller, ControlError, type Manifest, type Parameter } from './controller';
import { SpeechPlayer, type PreparedSpeech } from './speech';
import { speechAccents } from './speech-motion';
import { PerformanceController } from './performance';
import { streamChannels } from './performance-profile';
import {gestureFingerChannels} from './gesture-library';
import { normalizeEyeParameters } from './eye-style';

const FIXED_DT = 1 / 60;
const bytes = (value: any) => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;

export class Live2DEngine extends CubismUserModel {
  control!: Controller;
  performance!: PerformanceController;
  gl!: WebGLRenderingContext;
  ready = false;
  framing: 'full' | 'portrait' = 'full';
  lastRecording: any = null;
  fps = 0;
  private manifest!: Manifest;
  private physicsBytes!: ArrayBuffer;
  private partDefaults: number[] = [];
  private partIds: string[] = [];
  private bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  private queue: { command: any; run?:()=>any; resolve: (value: any) => void; reject: (value: any) => void }[] = [];
  private speech=new SpeechPlayer();
  private speechRequest=0;
  private speechOwnsMotion=false;
  private speechMotion:PreparedSpeech['trajectory']|null=null;
  private accumulator = 0;
  private previous = 0;
  private fpsStart = 0;
  private fpsFrames = 0;

  constructor(public canvas: HTMLCanvasElement, private onProgress: (text: string, percent: number) => void) { super(); }

  async initialize() {
    this.onProgress('初始化 Cubism 运行时', 5);
    for (let i = 0; i < 500; i++) {
      try { if (Live2DCubismCore.Version.csmGetVersion()) break; } catch { /* Core's embedded WASM initializes asynchronously. */ }
      await new Promise(resolve => setTimeout(resolve, 20));
      if (i === 499) throw new Error('Cubism Core 初始化超时');
    }
    const options = new Option();
    options.logFunction = message => console.info('[Cubism]', message);
    options.loggingLevel = LogLevel.LogLevel_Warning;
    CubismFramework.startUp(options); CubismFramework.initialize();
    this.manifest = await (await fetch('/api/manifest')).json();
    const modelSetting = await (await fetch(this.manifest.modelUrl)).json();
    const resolveAsset = (name: string) => this.manifest.baseUrl + name.split('/').map(encodeURIComponent).join('/');
    const moc = await (await fetch(resolveAsset(modelSetting.FileReferences.Moc))).arrayBuffer();
    this.loadModel(moc, true);
    if (!this._model) throw new Error('moc3 一致性校验或模型创建失败');
    this.physicsBytes = bytes(this.manifest.physics);
    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true })!;
    if (!this.gl) throw new Error('浏览器未提供 WebGL；请启用硬件加速');
    const gl = this.gl;
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (maxTexture < 8192) throw new Error(`当前 WebGL 最大纹理为 ${maxTexture}，模型需要 8192`);
    // This model has 49 distinct clipping groups, exceeding the SDK's single-buffer
    // capacity (36). Size buffers for all groups, including currently hidden ones.
    const masks = this._model.getDrawableMasks();
    const maskGroups = new Set(masks.filter(mask => mask.length).map(mask => Array.from(mask).sort((a, b) => a - b).join(',')));
    this.createRenderer(maskGroups.size <= 36 ? 1 : Math.ceil(maskGroups.size / 32));
    this.getRenderer().setClippingMaskBufferSize(1024);
    this.getRenderer().startUp(gl);
    this.getRenderer().setIsPremultipliedAlpha(true);
    const textures: string[] = modelSetting.FileReferences.Textures;
    for (let i = 0; i < textures.length; i++) {
      this.onProgress(`载入贴图 ${i + 1} / ${textures.length}`, 20 + i * 14);
      const image = new Image(); image.src = resolveAsset(textures[i]); await image.decode();
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`贴图 ${i} 上传失败，WebGL 错误 ${error}`);
      this.getRenderer().bindTexture(i, texture);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    const labels = new Map(this.manifest.display.Parameters.map((p: any) => [p.Id, p]));
    const groups = new Map(this.manifest.display.ParameterGroups.map((g: any) => [g.Id, g.Name]));
    const writers = new Set<string>(), readers = new Set<string>();
    for (const setting of this.manifest.physics.PhysicsSettings) {
      setting.Input.forEach((p: any) => readers.add(p.Source.Id));
      setting.Output.forEach((p: any) => writers.add(p.Destination.Id));
    }
    const parameters: Parameter[] = [];
    for (let i = 0; i < this._model.getParameterCount(); i++) {
      const id = this._model.getParameterId(i).getString().s;
      const display: any = labels.get(id);
      parameters.push({
        id, label: display?.Name ?? id, group: (groups.get(display?.GroupId) as string) ?? '未分组',
        min: this._model.getParameterMinimumValue(i), max: this._model.getParameterMaximumValue(i),
        default: this._model.getParameterDefaultValue(i), type: this._model.getParameterType(i),
        physicsOutput: writers.has(id), physicsInput: readers.has(id),
      });
    }
    for (let i = 0; i < this._model.getPartCount(); i++) {
      this.partIds.push(this._model.getPartId(i).getString().s);
      this.partDefaults.push(this._model.getPartOpacityByIndex(i));
    }
    this.control = new Controller(parameters, this.manifest, this.partIds);
    let couplingSettings=[];
    try{
      const configUrl=this.manifest.modelUrl.replace(/\.model3\.json$/,'.vtube.json');
      if(configUrl!==this.manifest.modelUrl){const response=await fetch(configUrl);if(response.ok)couplingSettings=(await response.json()).ParameterSettings??[];}
    }catch{console.info('[Performance] Optional asset coupling configuration unavailable');}
    this.performance = new PerformanceController(parameters,this.manifest.motions,couplingSettings);
    this.resetPhysics(); this.apply(0);
    this.measureBounds();
    this.ready = true; this.onProgress('模型已就绪', 100);
    this.previous = performance.now(); this.fpsStart = this.previous;
    requestAnimationFrame(this.loop);
    return this.describe();
  }

  private resetPhysics() {
    if (this._physics) CubismPhysics.delete(this._physics);
    this._physics = CubismPhysics.create(this.physicsBytes, this.physicsBytes.byteLength);
    const options = new Options(); options.gravity.x = 0; options.gravity.y = -1; options.wind.x = 0; options.wind.y = 0;
    this._physics.setOptions(options);
    this.control?.parameters.forEach((p, i) => this._model.setParameterValueByIndex(i, p.default));
    this._physics.stabilization(this._model);
    if (this.control) this.control.lastFinal = this.control.parameters.map((_, i) => this._model.getParameterValueByIndex(i));
  }

  private handLandmarks(){
    const m=this._model,parents=m.getPartParentPartIndices(),points:{right:number[];left:number[]}={right:[],left:[]};
    for(let i=0;i<m.getDrawableCount();i++){
      if(m.getDrawableOpacity(i)<.05)continue;let part=m.getDrawableParentPartIndex(i),side:'right'|'left'|undefined;
      for(let j=0;j<20&&part>=0;j++){const id=this.partIds[part];if(id==='Part130'){side='right';break;}if(id==='Part131'){side='left';break;}part=parents[part];}
      if(side){const vertices=m.getDrawableVertexPositions(i);for(let j=1;j<vertices.length;j+=2)points[side].push(vertices[j]);}
    }
    return Object.fromEntries(Object.entries(points).map(([side,ys])=>[side,ys.length?{y:ys.reduce((a,b)=>a+b,0)/ys.length,max_y:Math.max(...ys),vertices:ys.length}:null]));
  }

  private apply(dt: number, updateGeometry = true) {
    const mouth=this.speech.sample();
    if(this.speechMotion&&mouth.started){this.control.time=0;this.control.execute(this.speechMotion.method,this.speechMotion.params);this.speechMotion=null;}
    const { pre, post } = this.control.evaluate(dt,this.speechOwnsMotion&&mouth.motion_time_ms!==null?mouth.motion_time_ms/1000:undefined);
    if(this.speechOwnsMotion&&mouth.mouth!==null&&!mouth.native_motion){
      for(const [id,delta] of Object.entries(speechAccents(mouth.energy,mouth.beat,mouth.bodyBeat))){
        const index=this.control.indices.get(id);if(index===undefined)continue;
        const p=this.control.parameters[index];pre[index]=Math.max(p.min,Math.min(p.max,pre[index]+delta));
      }
    }
    if(mouth.mouth!==null){const index=this.control.indices.get('ParamMouthOpenY');if(index!==undefined)pre[index]=mouth.mouth;}
    const generated=this.performance.tick(dt,this.speech.info(),Object.fromEntries(this.control.parameters.map((p,i)=>[p.id,pre[i]])),new Set(this.control.overrides.keys()));
    for(const [id,value] of Object.entries(generated)){const i=this.control.indices.get(id);if(i!==undefined&&(![...streamChannels,...gestureFingerChannels].includes(id)||!this.control.overrides.has(id))){pre[i]=value;if(this.control.parameters[i].physicsOutput)post[id]=value;}}
    for(const id of ['ParamEyeLOpen','ParamEyeROpen']){const i=this.control.indices.get(id);if(i!==undefined)pre[i]=Math.min(pre[i],this.control.blinkLimit());}
    normalizeEyeParameters(pre, this.control.indices, post);
    pre.forEach((value, i) => this._model.setParameterValueByIndex(i, value));
    this.partDefaults.forEach((value, i) => this._model.setPartOpacityByIndex(i, value));
    if (this.control.physicsEnabled && dt > 0) this._physics.evaluate(this._model, dt);
    if (this.control.physicsEnabled && dt === 0) this.control.parameters.forEach((p, i) => {
      if (p.physicsOutput) this._model.setParameterValueByIndex(i, this.control.lastFinal[i]);
    });
    for (const [id, value] of Object.entries(post)) this._model.setParameterValueByIndex(this.control.indices.get(id)!, value);
    for (const [id, value] of this.control.partOverrides) this._model.setPartOpacityByIndex(this.partIds.indexOf(id), value);
    if(updateGeometry)this._model.update();
    this.control.acceptFinal(this.control.parameters.map((_, i) => this._model.getParameterValueByIndex(i)));
  }

  private measureBounds() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this._model.getDrawableCount(); i++) {
      if (this._model.getDrawableOpacity(i) < 0.01) continue;
      const positions = this._model.getDrawableVertexPositions(i);
      for (let j = 0; j < positions.length; j += 2) {
        minX = Math.min(minX, positions[j]); maxX = Math.max(maxX, positions[j]);
        minY = Math.min(minY, positions[j + 1]); maxY = Math.max(maxY, positions[j + 1]);
      }
    }
    if (Number.isFinite(minX) && maxX > minX && maxY > minY) this.bounds = { minX, maxX, minY, maxY };
  }

  draw() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const b = this.bounds, aspect = width / height;
    const zoom = this.framing === 'portrait' ? 1.8 : 1;
    const scale = Math.min(1.84 / (b.maxY - b.minY), 1.8 * aspect / (b.maxX - b.minX)) * zoom;
    const centerX = (b.maxX + b.minX) / 2;
    const centerY = this.framing === 'portrait' ? b.maxY - 0.94 / scale : (b.maxY + b.minY) / 2;
    const matrix = new CubismMatrix44();
    matrix.setMatrix(new Float32Array([scale / aspect, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, -centerX * scale / aspect, -centerY * scale, 0, 1]));
    this.getRenderer().setMvpMatrix(matrix);
    this.getRenderer().setRenderState(null, [0, 0, width, height]);
    this.getRenderer().drawModel();
  }

  private loop = (now: number) => {
    const delta = Math.min((now - this.previous) / 1000, 0.1); this.previous = now;
    const pending = this.queue.splice(0);
    const results: { entry: typeof pending[number]; value?: any; error?: any }[] = [];
    for (const entry of pending) {
      try { results.push({ entry, value: entry.run?entry.run():this.dispatch(entry.command.method, entry.command.params ?? {}) }); }
      catch (error) { results.push({ entry, error }); }
    }
    if (!this.control.paused) {
      this.accumulator += delta;
      let count = 0;
      while (this.accumulator >= FIXED_DT && count++ < 6) { this.apply(FIXED_DT); this.accumulator -= FIXED_DT; }
    } else this.accumulator = 0;
    if (pending.length) this.apply(0);
    this.draw();
    for (const r of results) {
      if (r.error) r.entry.reject(r.error);
      else r.entry.resolve({ status: 'applied', frame: this.control.frame, time_ms: Math.round(this.control.time * 1000), result: r.value });
    }
    this.fpsFrames++;
    if (now - this.fpsStart >= 1000) { this.fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsStart)); this.fpsFrames = 0; this.fpsStart = now; }
    requestAnimationFrame(this.loop);
  };

  async command(command: any): Promise<any> {
    if (!this.ready) return Promise.reject(new ControlError('runtime_not_ready', '模型尚未就绪'));
    if (!command || typeof command.method !== 'string') return Promise.reject(new ControlError('invalid_command', 'method 必须为字符串'));
    if (this.queue.length >= 256) return Promise.reject(new ControlError('queue_full', '控制队列已满'));
    if(command.method==='speech.unlock')return {status:'applied',result:await this.speech.unlock()};
    if(command.method==='speech.play'){
      if(this.control.recording)throw new ControlError('recording_active','请先保存当前录制，再播放语音');
      if(command.params?.trajectory){
        if(command.params.trajectory.method!=='trajectory.play')throw new ControlError('invalid_speech','语音动作需为模型轨迹');
        new Controller(this.control.parameters,this.manifest,this.partIds).execute('trajectory.play',command.params.trajectory.params);
      }
      const request=++this.speechRequest,prepared=await this.speech.prepare(command.params);
      if(request!==this.speechRequest)throw new ControlError('speech_cancelled','语音播放已取消');
      return new Promise((resolve,reject)=>this.queue.push({command,resolve,reject,run:()=>{
        if(request!==this.speechRequest)throw new ControlError('speech_cancelled','语音播放已取消');
        return this.beginSpeech(prepared);
      }}));
    }
    return new Promise((resolve, reject) => this.queue.push({ command, resolve, reject }));
  }

  speechState(){return this.speech.info();}
  private stopSpeech(){this.speechRequest++;this.speech.stop();this.speechMotion=null;this.speechOwnsMotion=false;}
  private beginSpeech(clip:PreparedSpeech){
    if(this.control.recording)throw new ControlError('recording_active','请先保存当前录制');
    if(!this.speech.info().enabled)throw new ControlError('audio_locked','请重新启用浏览器声音');
    this.speech.stop();
    this.performance.detach();
    if(clip.trajectory){this.control.reset(false,true);this.accumulator=0;this.resetPhysics();}
    this.control.paused=false;this.control.execute('behavior.set',{idle:true,breath:true,blink:true,physicsEnabled:true});
    this.speechOwnsMotion=!!clip.trajectory;this.speechMotion=clip.trajectory??null;
    return this.speech.start(clip);
  }

  private beginSpeechStream(params:any){
    if(this.control.recording)throw new ControlError('recording_active','请先保存当前录制');
    if(params.trajectory){
      if(params.trajectory.method!=='trajectory.play')throw new ControlError('invalid_speech','语音动作需为模型轨迹');
      new Controller(this.control.parameters,this.manifest,this.partIds).execute('trajectory.play',params.trajectory.params);
    }
    if(params.performance_session_id!==undefined)this.performance.require(params.performance_session_id);
    else this.performance.detach();
    const result=this.speech.beginStream(params);this.speechRequest++;
    if(params.trajectory){this.control.reset(false,true);this.accumulator=0;this.resetPhysics();}
    if(!params.performance_session_id)this.control.paused=false;
    else if(this.control.paused)this.speech.pause();
    this.control.execute('behavior.set',{idle:true,breath:true,blink:true,physicsEnabled:true});
    this.speechOwnsMotion=!!params.trajectory;this.speechMotion=params.trajectory??null;return result;
  }

  private dispatch(method: string, params: any) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new ControlError('invalid_argument', 'params 必须为对象');
    switch (method) {
      case 'model.describe': return this.describe();
      case 'state.get': return { ...this.control.state(true), performance:this.performance.state(), speech:this.speech.info(), ...(params.geometry ? { geometry: this.geometryProbe() } : {}),...(params.hand_landmarks?{hand_landmarks:this.handLandmarks()}:{}) };
      case 'capabilities.get': return this.performance.capabilities();
      case 'appearance.get': return this.performance.getAppearance();
      case 'appearance.update': {const result=this.performance.updateAppearance(params);this.performance.appearanceOwned=true;return result;}
      case 'performance.state': return this.performance.state();
      case 'performance.configure': return this.performance.configure(params,this.control.state(true).driver);
      case 'performance.direct': {
        const result=this.performance.direct(params);
        if(params.gesture){this.performance.rememberPose(Object.fromEntries(this.control.parameters.map((p,i)=>[p.id,this.control.lastFinal[i]])));this.control.playbacks.clear();this.control.timeline=null;this.speechOwnsMotion=false;this.speechMotion=null;
          for(const group of this.performance.capabilities().action_groups)for(const id of group.owned_channels)this.control.overrides.delete(id);}
        else if(params.body_motion)for(const body of this.performance.capabilities().body_motions)for(const id of body.owned_channels)this.control.overrides.delete(id);
        return result;
      }
      case 'performance.release': return this.performance.release(params);
      case 'performance.begin': {
        if(this.control.recording)throw new ControlError('recording_active','请先保存当前录制');
        this.performance.validateCoupling(params.motion_coupling??'current');
        this.stopSpeech();this.control.timeline=null;this.control.playbacks.clear();
        for(const id of [...this.performance.capabilities().channels.map(p=>p.id),...gestureFingerChannels])this.control.overrides.delete(id);
        return this.performance.start(params,this.control.state(true).driver);
      }
      case 'performance.segment': return this.performance.segment(params);
      case 'performance.chunk': return this.performance.chunk(params);
      case 'performance.end': {const result=this.performance.cancel(params.session_id);if(result.cancelled)this.stopSpeech();return result;}
      case 'performance.capture': {
        if(this.performance.active||this.speech.info().active||this.control.recording)throw new ControlError('capture_busy','离线采集需要空闲角色');
        const channels=params.channels,frames=params.values;
        if(!Array.isArray(channels)||!Array.isArray(frames)||frames.length>1800||channels.some(id=>!this.control.indices.has(id))||frames.some(row=>!Array.isArray(row)||row.length!==channels.length||row.some(v=>!Number.isFinite(v))))throw new ControlError('invalid_capture','采集轨迹不合法');
        this.performance.reset();this.control.reset(true,false);this.resetPhysics();
        if(params.trajectory)this.control.execute(params.trajectory.method,params.trajectory.params);
        const hz=params.hz??20,imageHz=params.image_hz??10;
        if(![20,60].includes(hz)||![10,20,30,60].includes(imageHz)||imageHz>hz||hz%imageHz)throw new ControlError('invalid_capture','采集帧率不合法');
        const records:any[]=[],images:any[]=[],hands:any[]=[];
        for(let f=0;f<frames.length;f++){
          const values=Object.fromEntries(channels.map((id,i)=>[id,frames[f][i]]));
          if(!params.trajectory){
          for(const [name,key] of Object.entries({黑脸:'key1',流泪:'key2',脸红:'key7',加载:'key8',兔牙:'key9',流冷汗:'key13'})){
            const j=['黑脸','流泪','脸红','加载','兔牙','流冷汗'].indexOf(name);values[key]=params.face?.[f]?.[j]??0;
          }
          for(const [index,key] of ['key5','key3','key4','key6'].entries())values[key]=(Array.isArray(params.eye)?params.eye[f]:params.eye)===index+1?1:0;
          }
          if(params.mouth)values.ParamMouthOpenY=params.mouth[Math.min(params.mouth.length-1,Math.round(f*60/hz))]??0;
          this.control.execute('parameters.set',{values});for(let i=0;i<60/hz;i++)this.apply(FIXED_DT,params.full_update!==false||i===60/hz-1);
          records.push(this.control.lastFinal.map(x=>Math.round(x*100000)/100000));
          if(params.verify_hands)hands.push(this.handLandmarks());
          if(params.images&&f%(hz/imageHz)===0){this.draw();images.push({frame:f,png:this.canvas.toDataURL('image/png').split(',')[1]});}
        }
        return {parameter_ids:this.control.parameters.map(p=>p.id),hz,image_hz:imageHz,actual:records,images,...(params.verify_hands?{hand_landmarks:hands}:{})};
      }
      case 'speech.status':return this.speech.info();
      case 'speech.stream.begin':return this.beginSpeechStream(params);
      case 'speech.stream.append':return this.speech.append(params);
      case 'speech.stream.finish':return this.speech.finish(params);
      case 'speech.stop':{
        if(params.speech_id!==undefined&&params.speech_id!==this.speech.info().speech_id)return {stopped:false};
        const owned=this.speechOwnsMotion;this.performance.cancel();this.stopSpeech();
        if(owned){this.control.reset(false,true);this.accumulator=0;this.resetPhysics();}
        return {stopped:true};
      }
      case 'engine.reset': {
        if (params.paused !== undefined && typeof params.paused !== 'boolean') throw new ControlError('invalid_argument', 'paused 必须为布尔值');
        if (params.preserve_background !== undefined && typeof params.preserve_background !== 'boolean') throw new ControlError('invalid_argument', 'preserve_background 必须为布尔值');
        this.stopSpeech();this.performance.reset();this.control.reset(params.paused ?? false, params.preserve_background ?? false); this.accumulator = 0; this.resetPhysics(); return { reset: true };
      }
      case 'engine.pause': {
        if (typeof params.paused !== 'boolean') throw new ControlError('invalid_argument', 'paused 必须为布尔值');
        this.control.paused = params.paused;params.paused?this.speech.pause():this.speech.resume();return { paused: params.paused };
      }
      case 'engine.step': {
        const frames = params.frames ?? 1;
        if (!this.control.paused) throw new ControlError('not_paused', '请先暂停，再按固定步长前进');
        if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new ControlError('invalid_argument', 'frames 必须为 1～600 的整数');
        for (let i = 0; i < frames; i++) this.apply(FIXED_DT);
        return { advanced: frames, dt: FIXED_DT };
      }
      case 'physics.configure': {
        const keys = ['enabled', 'windX', 'windY', 'gravityX', 'gravityY'];
        if (Object.keys(params).some(k => !keys.includes(k))) throw new ControlError('invalid_argument', '不支持的物理设置');
        for (const [key, value] of Object.entries(params)) {
          if (key === 'enabled' ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10) throw new ControlError('invalid_argument', `不合法的物理设置：${key}`);
        }
        if (params.enabled !== undefined) this.control.physicsEnabled = params.enabled;
        const options = this._physics.getOption();
        for (const [key, target] of [['windX', options.wind], ['windY', options.wind], ['gravityX', options.gravity], ['gravityY', options.gravity]] as const) {
          if (params[key] !== undefined) target[key.endsWith('X') ? 'x' : 'y'] = params[key];
        }
        this._physics.setOptions(options); return { enabled: this.control.physicsEnabled };
      }
      case 'recording.start': {
        if (params.paused !== undefined && typeof params.paused !== 'boolean') throw new ControlError('invalid_argument', 'paused 必须为布尔值');
        if (params.annotation !== undefined && (typeof params.annotation !== 'object' || !params.annotation || JSON.stringify(params.annotation).length > 16000)) throw new ControlError('invalid_argument', 'annotation 必须为不超过 16000 字符的对象');
        this.stopSpeech();this.performance.reset();this.control.reset(params.paused ?? false); this.accumulator = 0; this.resetPhysics();
        this.control.recording = { schema_version: 'live2d_recording.v1', asset_hash: this.manifest.assetHash, runtime: 'CubismSdkForWeb-5-r.4', profile_id: this.manifest.actionProfile?.id, profile_sha256: this.manifest.actionProfile?.sha256, annotation: params.annotation ? structuredClone(params.annotation) : null, initial_state: this.control.state(true), dt: FIXED_DT, parameter_ids: this.control.parameters.map(p => p.id), commands: [], frames: [] };
        return { recording: true, reset_to_defaults: true };
      }
      case 'recording.stop': {
        if (!this.control.recording) throw new ControlError('not_recording', '当前没有录制');
        this.lastRecording = this.control.recording;
        this.lastRecording.duration_ms = this.lastRecording.capture_end_ms ?? this.control.time * 1000;
        this.control.recording = null; return this.lastRecording;
      }
      case 'recording.replay': {
        const recording = params.recording ?? this.lastRecording;
        if (params.paused !== undefined && typeof params.paused !== 'boolean') throw new ControlError('invalid_argument', 'paused 必须为布尔值');
        if (!recording || recording.schema_version !== 'live2d_recording.v1' || recording.asset_hash !== this.manifest.assetHash) throw new ControlError('invalid_recording', '录制版本或模型哈希不匹配');
        // Validate before resetting an otherwise healthy scene.
        const probe = new Controller(this.control.parameters, this.manifest, this.partIds);
        probe.execute('timeline.play', { events: recording.commands, duration_ms: recording.duration_ms });
        this.stopSpeech();this.performance.reset();this.control.reset(params.paused ?? false); this.accumulator = 0; this.resetPhysics();
        this.control.execute('timeline.play', { events: recording.commands, duration_ms: recording.duration_ms });
        return { replaying: true, duration_ms: recording.duration_ms };
      }
      default:
        if(['motions.play','gesture.set','timeline.play','demo.play','expressions.set','expressions.clear','appearance.set'].includes(method)&&(this.performance.id||this.performance.hasActions())){this.performance.detach();this.stopSpeech();}
        return this.control.execute(method, params);
    }
  }

  describe() {
    return {
      name: this.manifest.name, asset_hash: this.manifest.assetHash, sdk: 'Cubism SDK for Web 5 R4 / Core 5.1',
      parameters: this.control.parameters,
      parts: this.partIds.map((id, i) => ({ id, default: this.partDefaults[i], label: this.manifest.display.Parts.find((p: any) => p.Id === id)?.Name ?? id })),
      expressions: this.manifest.expressions.map(e => ({ name: e.name, file: e.file, parameters: e.data.Parameters })),
      motions: this.manifest.motions.map(m => ({ name: m.name, file: m.file, duration: m.data.Meta.Duration, hold: m.hold })),
      physics_groups: this.manifest.physics.PhysicsSettings.length,
      action_profile: this.manifest.actionProfile,
      performance: this.performance.capabilities(),
      drawables: this._model.getDrawableCount(), mask_buffers: this.getRenderer().getRenderTextureCount(),
      methods: ['performance.configure','speech.unlock','speech.play','speech.stop','speech.status','speech.stream.begin','speech.stream.append','speech.stream.finish','trajectory.play', 'model.describe', 'state.get', 'parameters.set', 'parameters.release', 'expressions.set', 'expressions.clear', 'appearance.set', 'gesture.set', 'motions.play', 'motions.stop', 'timeline.play', 'timeline.cancel', 'behavior.set', 'parts.set', 'physics.configure', 'engine.reset', 'engine.pause', 'engine.step', 'recording.start', 'recording.stop', 'recording.replay', 'demo.play'],
      limits: { recording_frames: 3000, recording_sample_hz: 10, timeline_events: 2000, fixed_dt: FIXED_DT },
    };
  }
  geometryProbe() {
    let x = 0, y = 0, opacity = 0, vertices = 0;
    for (let i = 0; i < this._model.getDrawableCount(); i++) {
      const alpha = this._model.getDrawableOpacity(i); opacity += alpha;
      const points = this._model.getDrawableVertexPositions(i);
      for (let j = 0; j < points.length; j += 14) { x += points[j] * alpha * (i + 1); y += points[j + 1] * alpha * (i + 1); vertices++; }
    }
    return { weighted_x: x, weighted_y: y, opacity_sum: opacity, sampled_vertices: vertices };
  }
}
