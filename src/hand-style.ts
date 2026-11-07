/** These inputs select alternative arm/hand drawings, not motion amplitude.
 * Fractional values expose two poses at once. The two right-arm alternatives
 * are mutually exclusive; the left raised arm is independent. */
export const handDrawingSwitches=['Movement1','Movement2','Movement3'] as const;
export function normalizeHandParameters(values:number[],indices:ReadonlyMap<string,number>,post:Record<string,number>={}){
 const value=(id:string)=>{const i=indices.get(id);return i===undefined?0:post[id]??values[i];};
 const grass=value('Movement1'),point=value('Movement3');
 const right=grass>=.5&&grass>=point?'Movement1':point>=.5?'Movement3':null;
 for(const id of handDrawingSwitches){
  const i=indices.get(id);if(i===undefined)continue;
  values[i]=id==='Movement2'?(value(id)>=.5?1:0):id===right?1:0;
  if(Object.hasOwn(post,id))post[id]=values[i];
 }
}
