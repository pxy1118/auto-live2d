import {Live2DEngine} from '../../src/engine';
const engine=new Live2DEngine(document.querySelector('canvas')!,message=>document.getElementById('progress')!.textContent=message);
await engine.initialize();
await engine.command({method:'engine.pause',params:{paused:true}});
document.getElementById('progress')!.remove();
// Deliberately no control WebSocket: capture never claims the user's live actor.
(window as any).prosodyCapture={ready:true,engine};
