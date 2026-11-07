/** The model's black-face texture is a discrete authored drawing. The other
 * overlays (blush, tears, sweat) may still vary continuously in visibility. */
export function normalizeFaceOverlays(values:number[],indices:ReadonlyMap<string,number>,post:Record<string,number>={}){
 const i=indices.get('key1');if(i===undefined)return;
 values[i]=(post.key1??values[i])>=.5?1:0;
 if(Object.hasOwn(post,'key1'))post.key1=values[i];
}
