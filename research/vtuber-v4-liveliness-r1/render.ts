import {Live2DEngine} from './frozen/src/engine';
const engine = new Live2DEngine(document.querySelector('canvas')!, message => document.querySelector('p')!.textContent = message);
await engine.initialize();
await engine.command({method: 'engine.pause', params: {paused: true}});
document.querySelector('p')!.remove();
// No actor-control socket; uses the frozen pre-coupling execution code.
let capture: any = null, cursor = 0;
const faceKeys = ['key1', 'key2', 'key7', 'key8', 'key9', 'key13'];
(window as any).livelinessCapture = {engine, ready: true,
  begin(params: any) {
    engine.performance.reset(); engine.control.reset(true, false); (engine as any).resetPhysics();
    capture = params; cursor = 0;
  },
  batch(start: number, count: number) {
    if (!capture || start !== cursor || count > 90) throw Error('Capture batch order/size invalid');
    const actual: number[][] = [], images: {frame: number; png: string}[] = [];
    for (let f = start; f < Math.min(start + count, capture.values.length); f++) {
      const values = Object.fromEntries(capture.channels.map((id: string, j: number) => [id, capture.values[f][j]]));
      faceKeys.forEach((key, j) => values[key] = capture.face?.[f]?.[j] ?? 0);
      ['key5', 'key3', 'key4', 'key6'].forEach((key, j) => values[key] = (Array.isArray(capture.eye) ? capture.eye[f] : capture.eye) === j + 1 ? 1 : 0);
      values.ParamMouthOpenY = capture.mouth?.[f] ?? 0;
      engine.control.execute('parameters.set', {values}); (engine as any).apply(1 / 60, true);
      actual.push(engine.control.lastFinal.map(v => Math.round(v * 100000) / 100000));
      if (capture.images) { (engine as any).draw(); images.push({frame: f, png: engine.canvas.toDataURL('image/png').split(',')[1]}); }
      cursor++;
    }
    return {actual, images, parameter_ids: engine.control.parameters.map(p => p.id), cursor};
  }
};
