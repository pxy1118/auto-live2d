import { CubismFramework, Option, LogLevel } from '../vendor/cubism/Framework/src/live2dcubismframework';
import { CubismUserModel } from '../vendor/cubism/Framework/src/model/cubismusermodel';
import { CubismMatrix44 } from '../vendor/cubism/Framework/src/math/cubismmatrix44';
import { CubismPhysics, Options } from '../vendor/cubism/Framework/src/physics/cubismphysics';
import { Controller, ControlError, type Manifest, type Parameter } from './controller';

const FIXED_DT = 1 / 60;
const bytes = (value: any) => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;

export class Live2DEngine extends CubismUserModel {
  control!: Controller;
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
  private queue: { command: any; resolve: (value: any) => void; reject: (value: any) => void }[] = [];
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

  private apply(dt: number) {
    const { pre, post } = this.control.evaluate(dt);
    pre.forEach((value, i) => this._model.setParameterValueByIndex(i, value));
    this.partDefaults.forEach((value, i) => this._model.setPartOpacityByIndex(i, value));
    if (this.control.physicsEnabled && dt > 0) this._physics.evaluate(this._model, dt);
    if (this.control.physicsEnabled && dt === 0) this.control.parameters.forEach((p, i) => {
      if (p.physicsOutput) this._model.setParameterValueByIndex(i, this.control.lastFinal[i]);
    });
    for (const [id, value] of Object.entries(post)) this._model.setParameterValueByIndex(this.control.indices.get(id)!, value);
    for (const [id, value] of this.control.partOverrides) this._model.setPartOpacityByIndex(this.partIds.indexOf(id), value);
    this._model.update();
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
      try { results.push({ entry, value: this.dispatch(entry.command.method, entry.command.params ?? {}) }); }
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

  command(command: any): Promise<any> {
    if (!this.ready) return Promise.reject(new ControlError('runtime_not_ready', '模型尚未就绪'));
    if (!command || typeof command.method !== 'string') return Promise.reject(new ControlError('invalid_command', 'method 必须为字符串'));
    if (this.queue.length >= 256) return Promise.reject(new ControlError('queue_full', '控制队列已满'));
    return new Promise((resolve, reject) => this.queue.push({ command, resolve, reject }));
  }

  private dispatch(method: string, params: any) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new ControlError('invalid_argument', 'params 必须为对象');
    switch (method) {
      case 'model.describe': return this.describe();
      case 'state.get': return { ...this.control.state(true), ...(params.geometry ? { geometry: this.geometryProbe() } : {}) };
      case 'engine.reset': {
        if (params.paused !== undefined && typeof params.paused !== 'boolean') throw new ControlError('invalid_argument', 'paused 必须为布尔值');
        if (params.preserve_background !== undefined && typeof params.preserve_background !== 'boolean') throw new ControlError('invalid_argument', 'preserve_background 必须为布尔值');
        this.control.reset(params.paused ?? false, params.preserve_background ?? false); this.accumulator = 0; this.resetPhysics(); return { reset: true };
      }
      case 'engine.pause': {
        if (typeof params.paused !== 'boolean') throw new ControlError('invalid_argument', 'paused 必须为布尔值');
        this.control.paused = params.paused; return { paused: params.paused };
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
        this.control.reset(params.paused ?? false); this.accumulator = 0; this.resetPhysics();
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
        this.control.reset(params.paused ?? false); this.accumulator = 0; this.resetPhysics();
        this.control.execute('timeline.play', { events: recording.commands, duration_ms: recording.duration_ms });
        return { replaying: true, duration_ms: recording.duration_ms };
      }
      default: return this.control.execute(method, params);
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
      drawables: this._model.getDrawableCount(), mask_buffers: this.getRenderer().getRenderTextureCount(),
      methods: ['trajectory.play', 'model.describe', 'state.get', 'parameters.set', 'parameters.release', 'expressions.set', 'expressions.clear', 'appearance.set', 'gesture.set', 'motions.play', 'motions.stop', 'timeline.play', 'timeline.cancel', 'behavior.set', 'parts.set', 'physics.configure', 'engine.reset', 'engine.pause', 'engine.step', 'recording.start', 'recording.stop', 'recording.replay', 'demo.play'],
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
