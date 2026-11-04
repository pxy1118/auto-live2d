import assert from 'node:assert/strict';
import test from 'node:test';
import {PerformanceService} from '../server/performance-service';

test('default session reads readiness and actor state together, then begins atomically',async()=>{
 let releaseStatus!:()=>void,releaseState!:()=>void;
 const statusGate=new Promise<void>(r=>releaseStatus=r),stateGate=new Promise<void>(r=>releaseState=r);
 let statusStarted=false,stateStarted=false,begins=0;
 const service=new PerformanceService(async command=>{
  if(command.method==='state.get'){stateStarted=true;await stateGate;return {result:{speech:{enabled:true},recording:false}};}
  if(command.method==='performance.begin'){begins++;return {result:{}};}
  if(command.method==='performance.end')return {result:{cancelled:true}};
  throw Error('Unexpected renderer mutation: '+command.method);
 });
 service.status=async()=>{statusStarted=true;await statusGate;return {ready:true,promoted:true,experimental:false,run:{eligibility:{}}};};
 const pending=service.command({method:'performance.start',params:{},request_id:'default-start'});
 try{
  await new Promise(r=>setImmediate(r));assert.ok(statusStarted&&stateStarted);assert.equal(begins,0);
  releaseState();await new Promise(r=>setImmediate(r));assert.equal(begins,0);
  releaseStatus();const response:any=await pending;assert.equal(response.result.promoted,true);assert.equal(response.result.experimental,false);assert.equal(begins,1);
 }finally{
  releaseStatus();releaseState();const response:any=await pending;
  await service.command({method:'performance.cancel',params:{session_id:response.result.session_id},request_id:'default-stop'});
 }
});
